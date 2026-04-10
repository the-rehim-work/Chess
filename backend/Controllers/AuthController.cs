using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;
using System.Text.RegularExpressions;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/auth")]
    public sealed class AuthController : ControllerBase
    {
        private readonly UserManager<ApplicationUser> _users;
        private readonly SignInManager<ApplicationUser> _signIn;
        private readonly IConfiguration _cfg;
        private readonly AppDb _db;

        public AuthController(UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn, IConfiguration cfg, AppDb db)
        { _users = users; _signIn = signIn; _cfg = cfg; _db = db; }

        private static readonly Regex UserNameRule = new(@"^[a-zA-Z0-9_.-]{3,32}$", RegexOptions.Compiled);

        [HttpPost("register")]
        [AllowAnonymous]
        public async Task<IActionResult> Register([FromBody] RegisterDto dto)
        {
            if (string.IsNullOrWhiteSpace(dto.UserName) || !UserNameRule.IsMatch(dto.UserName) || dto.UserName.Contains('@'))
                return BadRequest(new { message = "Invalid username. 3–32 chars, [a-zA-Z0-9_.-], no '@'." });

            if (await _users.FindByNameAsync(dto.UserName) is not null)
                return Conflict(new { message = "Username already taken." });

            var u = new ApplicationUser
            {
                UserName = dto.UserName,
                Email = string.IsNullOrWhiteSpace(dto.Email) ? null : dto.Email,
                DisplayName = string.IsNullOrWhiteSpace(dto.DisplayName) ? dto.UserName : dto.DisplayName
            };

            var res = await _users.CreateAsync(u, dto.Password);
            if (!res.Succeeded) return BadRequest(res.Errors);

            await _users.AddToRoleAsync(u, "Player");
            _db.PlayerRatings.Add(new PlayerRating { UserId = u.Id });
            await _db.SaveChangesAsync();
            return Ok(new { u.Id, u.UserName, u.Email, u.DisplayName });
        }

        [HttpPost("login")]
        [AllowAnonymous]
        public async Task<IActionResult> Login([FromBody] LoginDto dto)
        {
            var u = await _users.FindByNameAsync(dto.UserOrEmail)
                 ?? await _users.FindByEmailAsync(dto.UserOrEmail);
            if (u is null) return Unauthorized();

            var pass = await _signIn.CheckPasswordSignInAsync(u, dto.Password, false);
            if (!pass.Succeeded) return Unauthorized();

            var token = GenerateJwt(u);
            return Ok(new { token, user = new { u.Id, u.UserName, u.Email, u.DisplayName } });
        }

        [HttpGet("me")]
        [Authorize]
        public async Task<IActionResult> Me()
        {
            var u = await _users.GetUserAsync(User);
            if (u is null) return Unauthorized();
            var roles = await _users.GetRolesAsync(u);
            return Ok(new { u.Id, u.UserName, u.Email, u.DisplayName, Roles = roles });
        }

        [HttpGet("usernames/check")]
        [AllowAnonymous]
        public async Task<IActionResult> CheckUserName([FromQuery] string name)
        {
            if (string.IsNullOrWhiteSpace(name) || !UserNameRule.IsMatch(name) || name.Contains('@'))
                return Ok(new { available = false });
            var exists = await _users.FindByNameAsync(name);
            return Ok(new { available = exists is null });
        }

        private string GenerateJwt(ApplicationUser user)
        {
            var key = _cfg["Jwt:Key"] ?? throw new InvalidOperationException("Jwt:Key missing");
            var issuer = _cfg["Jwt:Issuer"];
            var audience = _cfg["Jwt:Audience"];

            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, user.UserName ?? user.Id.ToString()),
                new Claim("uname", user.UserName ?? string.Empty),
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Email, user.Email ?? string.Empty),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
            };

            var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256);
            var jwt = new JwtSecurityToken(
                issuer: string.IsNullOrWhiteSpace(issuer) ? null : issuer,
                audience: string.IsNullOrWhiteSpace(audience) ? null : audience,
                claims: claims,
                notBefore: DateTime.UtcNow,
                expires: DateTime.UtcNow.AddDays(7),
                signingCredentials: creds
            );
            return new JwtSecurityTokenHandler().WriteToken(jwt);
        }

        public sealed record RegisterDto(string UserName, string Password, string? Email, string? DisplayName);
        public sealed record LoginDto(string UserOrEmail, string Password);
    }
}
