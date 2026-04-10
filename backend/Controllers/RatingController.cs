using backend.Data;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/ratings")]
    public sealed class RatingController : ControllerBase
    {
        private readonly AppDb _db;
        private readonly UserManager<ApplicationUser> _users;

        public RatingController(AppDb db, UserManager<ApplicationUser> users)
        {
            _db = db;
            _users = users;
        }

        [HttpGet("me")]
        [Authorize]
        public async Task<IActionResult> Me()
        {
            var user = await _users.GetUserAsync(User);
            if (user is null) return Unauthorized();
            var rating = await EnsureRating(user.Id);
            return Ok(ToDto(rating, user));
        }

        [HttpGet("leaderboard")]
        [AllowAnonymous]
        public async Task<IActionResult> Leaderboard([FromQuery] int take = 50, [FromQuery] int skip = 0)
        {
            take = Math.Clamp(take, 1, 200);
            skip = Math.Max(0, skip);
            var rows = await _db.PlayerRatings
                .Include(r => r.User)
                .Where(r => !r.User.IsBot)
                .OrderByDescending(r => r.Elo)
                .ThenBy(r => r.User.DisplayName)
                .Skip(skip)
                .Take(take)
                .Select(r => new
                {
                    userName = r.User.UserName,
                    displayName = r.User.DisplayName,
                    elo = r.Elo,
                    league = r.League,
                    gamesPlayed = r.GamesPlayed,
                    wins = r.Wins,
                    losses = r.Losses,
                    draws = r.Draws,
                    winStreak = r.WinStreak
                })
                .ToListAsync();
            return Ok(rows);
        }

        [HttpGet("{userName}")]
        [AllowAnonymous]
        public async Task<IActionResult> ByUser(string userName)
        {
            var user = await _users.FindByNameAsync(userName);
            if (user is null) return NotFound();
            var rating = await EnsureRating(user.Id);
            return Ok(ToDto(rating, user));
        }

        private async Task<PlayerRating> EnsureRating(Guid userId)
        {
            var rating = await _db.PlayerRatings.FirstOrDefaultAsync(r => r.UserId == userId);
            if (rating != null) return rating;
            rating = new PlayerRating { UserId = userId, League = EloService.GetLeague(1200) };
            _db.PlayerRatings.Add(rating);
            await _db.SaveChangesAsync();
            return rating;
        }

        private static object ToDto(PlayerRating rating, ApplicationUser user) => new
        {
            userName = user.UserName,
            displayName = user.DisplayName,
            elo = rating.Elo,
            league = rating.League,
            gamesPlayed = rating.GamesPlayed,
            wins = rating.Wins,
            losses = rating.Losses,
            draws = rating.Draws,
            winStreak = rating.WinStreak,
            peakElo = rating.PeakElo,
            bestWinStreak = rating.BestWinStreak,
            updatedAt = rating.UpdatedAt
        };
    }
}
