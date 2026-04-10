using System.Text;
using backend;
using backend.Data;
using backend.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ??
              new[] { "http://localhost:5173", "http://127.0.0.1:5173" };

var jwtKey = builder.Configuration["Jwt:Key"] ?? throw new InvalidOperationException("Jwt:Key missing");
var jwtIssuer = builder.Configuration["Jwt:Issuer"];
var jwtAudience = builder.Configuration["Jwt:Audience"];

builder.Services.AddDbContext<AppDb>(opt =>
    opt.UseSqlServer(builder.Configuration.GetConnectionString("Default"))
       .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.RelationalEventId.PendingModelChangesWarning)));

builder.Services
    .AddIdentityCore<ApplicationUser>(opt =>
    {
        opt.User.RequireUniqueEmail = false;
        opt.Password.RequireDigit = false;
        opt.Password.RequireNonAlphanumeric = false;
        opt.Password.RequireUppercase = false;
        opt.Password.RequireLowercase = false;
        opt.Password.RequiredLength = 6;
    })
    .AddRoles<ApplicationRole>()
    .AddEntityFrameworkStores<AppDb>()
    .AddDefaultTokenProviders()
    .AddSignInManager();

builder.Services.AddAuthentication(options =>
    {
        options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultScheme = JwtBearerDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(o =>
    {
        o.RequireHttpsMetadata = false;
        o.SaveToken = true;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ValidateIssuer = !string.IsNullOrWhiteSpace(jwtIssuer),
            ValidIssuer = jwtIssuer,
            ValidateAudience = !string.IsNullOrWhiteSpace(jwtAudience),
            ValidAudience = jwtAudience,
            ValidateLifetime = true
        };
        o.Events = new JwtBearerEvents
        {
            OnChallenge = ctx =>
            {
                ctx.HandleResponse();
                ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return Task.CompletedTask;
            },
            OnMessageReceived = context =>
            {
                var accessToken = context.Request.Query["access_token"];
                var path = context.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && (path.StartsWithSegments("/hubs/game") || path.StartsWithSegments("/hubs/chat")))
                    context.Token = accessToken;
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

builder.Services.AddSignalR();
builder.Services.AddSingleton<EloService>();
builder.Services.AddSingleton<BotEngine>();
builder.Services.AddControllers().AddJsonOptions(o =>
    o.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddOpenApi();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    var db = scope.ServiceProvider.GetRequiredService<backend.Data.AppDb>();

    try
    {
        logger.LogInformation("Applying EF Core migrations...");
        await db.Database.MigrateAsync();
        logger.LogInformation("EF Core migrations applied.");
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Database migration failed. Check connection string and permissions.");
        throw;
    }

    // Minimal seed (roles/admin). Keep it lightweight; heavy seeding belongs in migrations.
    var roleMgr = scope.ServiceProvider.GetRequiredService<RoleManager<backend.Data.ApplicationRole>>();
    var userMgr = scope.ServiceProvider.GetRequiredService<UserManager<backend.Data.ApplicationUser>>();

    foreach (var role in new[] { "Admin", "Player" })
        if (!await roleMgr.RoleExistsAsync(role))
            await roleMgr.CreateAsync(new backend.Data.ApplicationRole { Name = role });

    var adminUserName = builder.Configuration["Seed:Admin:UserName"] ?? "admin";
    var adminEmail    = builder.Configuration["Seed:Admin:Email"]    ?? "admin@chess.local";
    var adminPass     = builder.Configuration["Seed:Admin:Pass"]     ?? "Admin!123";

    var admin = await userMgr.FindByNameAsync(adminUserName);
    if (admin is null)
    {
        admin = new backend.Data.ApplicationUser
        {
            UserName = adminUserName,
            Email = adminEmail,
            DisplayName = "Admin"
        };
        var create = await userMgr.CreateAsync(admin, adminPass);
        if (create.Succeeded) await userMgr.AddToRoleAsync(admin, "Admin");
    }

    if (admin is not null)
    {
        if (!await userMgr.IsInRoleAsync(admin, "Player"))
            await userMgr.AddToRoleAsync(admin, "Player");
        if (!await db.PlayerRatings.AnyAsync(x => x.UserId == admin.Id))
            db.PlayerRatings.Add(new PlayerRating { UserId = admin.Id });
    }

    var botSeeds = new[]
    {
        new { UserName = "bot_easy", DisplayName = "Easy Bot", Elo = 600 },
        new { UserName = "bot_medium", DisplayName = "Medium Bot", Elo = 1000 },
        new { UserName = "bot_hard", DisplayName = "Hard Bot", Elo = 1500 },
        new { UserName = "bot_expert", DisplayName = "Expert Bot", Elo = 2000 }
    };
    foreach (var botSeed in botSeeds)
    {
        var bot = await userMgr.FindByNameAsync(botSeed.UserName);
        if (bot is null)
        {
            bot = new ApplicationUser
            {
                UserName = botSeed.UserName,
                DisplayName = botSeed.DisplayName,
                Email = $"{botSeed.UserName}@chess.local",
                IsBot = true
            };
            var created = await userMgr.CreateAsync(bot, Guid.NewGuid().ToString("N") + "!");
            if (!created.Succeeded) continue;
        }
        if (!bot.IsBot)
        {
            bot.IsBot = true;
            await userMgr.UpdateAsync(bot);
        }
        if (!await userMgr.IsInRoleAsync(bot, "Player"))
            await userMgr.AddToRoleAsync(bot, "Player");

        var botRating = await db.PlayerRatings.FirstOrDefaultAsync(x => x.UserId == bot.Id);
        if (botRating is null)
        {
            db.PlayerRatings.Add(new PlayerRating
            {
                UserId = bot.Id,
                Elo = botSeed.Elo,
                PeakElo = botSeed.Elo,
                League = EloService.GetLeague(botSeed.Elo)
            });
        }
        else
        {
            botRating.Elo = botSeed.Elo;
            botRating.PeakElo = botSeed.Elo;
            botRating.League = EloService.GetLeague(botSeed.Elo);
            botRating.UpdatedAt = DateTime.UtcNow;
        }
    }

    await db.SaveChangesAsync();
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.UseCors();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapHub<GameHub>("/hubs/game");
app.MapHub<ChatHub>("/hubs/chat");
app.MapControllers();

app.Run();
