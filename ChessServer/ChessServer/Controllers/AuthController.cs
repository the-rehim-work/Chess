using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using ChessServer.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;

namespace ChessServer.Controllers
{
    [ApiController]
    [Route("api/auth")]
    public sealed class AuthController : ControllerBase
    {
        private readonly UserManager<ApplicationUser> _users;
        private readonly SignInManager<ApplicationUser> _signIn;
        private readonly IConfiguration _cfg;

        public AuthController(
            UserManager<ApplicationUser> users,
            SignInManager<ApplicationUser> signIn,
            IConfiguration cfg)
        {
            _users = users;
            _signIn = signIn;
            _cfg = cfg;
        }

        [HttpPost("register")]
        [AllowAnonymous]
        public async Task<IActionResult> Register([FromBody] RegisterDto dto)
        {
            var u = new ApplicationUser
            {
                UserName = dto.Email,
                Email = dto.Email,
                DisplayName = dto.DisplayName ?? dto.Email
            };

            var res = await _users.CreateAsync(u, dto.Password);
            if (!res.Succeeded) return BadRequest(res.Errors);

            await _users.AddToRoleAsync(u, "Player");
            return Ok(new { u.Id, u.UserName, u.Email, u.DisplayName });
        }

        [HttpPost("login")]
        [AllowAnonymous]
        public async Task<IActionResult> Login([FromBody] LoginDto dto)
        {
            var u = await _users.FindByEmailAsync(dto.Email)
                    ?? await _users.FindByNameAsync(dto.Email);
            if (u is null) return Unauthorized();

            var pass = await _signIn.CheckPasswordSignInAsync(u, dto.Password, lockoutOnFailure: false);
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

        private string GenerateJwt(ApplicationUser user)
        {
            var key = _cfg["Jwt:Key"] ?? throw new InvalidOperationException("Jwt:Key missing");
            var issuer = _cfg["Jwt:Issuer"];
            var audience = _cfg["Jwt:Audience"];

            // All claim values MUST be strings.
            var claims = new List<Claim>
            {
                // Identity claims (used by UserManager.GetUserAsync(User))
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, (user.UserName ?? user.Email ?? user.Id.ToString())!),

                // Standard JWT claims
                new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Email, user.Email ?? string.Empty),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
            };

            var creds = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
                SecurityAlgorithms.HmacSha256);

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

        public sealed record RegisterDto(string Email, string Password, string? DisplayName);
        public sealed record LoginDto(string Email, string Password);
    }
}
