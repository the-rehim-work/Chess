using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/bot")]
    public sealed class BotController : ControllerBase
    {
        private readonly AppDb _db;
        private readonly UserManager<ApplicationUser> _users;

        public BotController(AppDb db, UserManager<ApplicationUser> users)
        {
            _db = db;
            _users = users;
        }

        [HttpPost("play")]
        [Authorize]
        public async Task<IActionResult> Play([FromBody] BotPlayDto dto)
        {
            var me = await _users.GetUserAsync(User);
            if (me is null) return Unauthorized();
            var difficulty = (dto.difficulty ?? string.Empty).Trim().ToLowerInvariant();
            if (difficulty is not ("easy" or "medium" or "hard" or "expert")) return BadRequest(new { message = "Invalid difficulty." });
            var botUser = await _users.Users.FirstOrDefaultAsync(u => u.UserName == $"bot_{difficulty}" && u.IsBot);
            if (botUser is null) return NotFound(new { message = "Bot user not found." });

            var preferred = dto.preferredColor is "w" or "b" ? dto.preferredColor : null;
            var humanColor = preferred ?? (Random.Shared.Next(2) == 0 ? "w" : "b");
            var botColor = humanColor == "w" ? "b" : "w";

            var game = new Game
            {
                Code = ShortCode(),
                Status = "active",
                IsBotGame = true,
                BotDifficulty = difficulty,
                IsRanked = true
            };
            _db.Games.Add(game);
            _db.GameParticipants.Add(new GameParticipant { Game = game, UserId = me.Id, Color = humanColor });
            _db.GameParticipants.Add(new GameParticipant { Game = game, UserId = botUser.Id, Color = botColor });
            await _db.SaveChangesAsync();

            return Ok(new { gameId = game.Id, botColor, botDisplayName = botUser.DisplayName });
        }

        private static string ShortCode()
            => Convert.ToBase64String(Guid.NewGuid().ToByteArray()).Replace("+", "").Replace("/", "").Replace("=", "").Substring(0, 6);

        public sealed record BotPlayDto(string difficulty, string? preferredColor);
    }
}
