using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace ChessServer.Data
{
    public sealed class AppDbFactory : IDesignTimeDbContextFactory<AppDb>
    {
        public AppDb CreateDbContext(string[] args)
        {
            var env = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Development";
            var basePath = Directory.GetCurrentDirectory();

            var config = new ConfigurationBuilder()
                .SetBasePath(basePath)
                .AddJsonFile("appsettings.json", optional: false)
                .AddJsonFile($"appsettings.{env}.json", optional: true)
                .AddEnvironmentVariables()
                .Build();

            var conn = config.GetConnectionString("Default")
                ?? "Server=555-PTS;Database=Chess;User Id=dbuser;Password=Admin123@;TrustServerCertificate=True;";

            var options = new DbContextOptionsBuilder<AppDb>()
                .UseSqlServer(conn, sql => sql.MigrationsAssembly(typeof(AppDb).Assembly.FullName))
                .Options;

            return new AppDb(options);
        }
    }
}
