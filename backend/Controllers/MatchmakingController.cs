using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/matchmaking")]
    public sealed class MatchmakingController : ControllerBase
    {
        private readonly AppDb _db;
        private readonly UserManager<ApplicationUser> _users;
        private readonly IHubContext<GameHub> _hub;

        public MatchmakingController(AppDb db, UserManager<ApplicationUser> users, IHubContext<GameHub> hub)
        {
            _db = db;
            _users = users;
            _hub = hub;
        }

        [HttpPost("queue")]
        [Authorize]
        public async Task<IActionResult> Queue([FromBody] QueueDto? dto)
        {
            var user = await _users.GetUserAsync(User);
            if (user is null) return Unauthorized();
            var existing = await _db.MatchmakingQueue.FirstOrDefaultAsync(x => x.UserId == user.Id);
            if (existing is not null)
            {
                var alreadyMatched = await TryMatch(existing);
                return Ok(alreadyMatched.HasValue
                    ? new { status = "matched", gameId = alreadyMatched.Value }
                    : new { status = "already_queued" });
            }

            var rating = await _db.PlayerRatings.FirstOrDefaultAsync(r => r.UserId == user.Id);
            if (rating is null)
            {
                rating = new PlayerRating { UserId = user.Id };
                _db.PlayerRatings.Add(rating);
                await _db.SaveChangesAsync();
            }

            var entry = new MatchmakingEntry
            {
                UserId = user.Id,
                Elo = rating.Elo,
                PreferredColor = dto?.preferredColor is "w" or "b" ? dto.preferredColor : null
            };
            _db.MatchmakingQueue.Add(entry);
            await _db.SaveChangesAsync();
            var matched = await TryMatch(entry);
            return Ok(matched.HasValue ? new { status = "matched", gameId = matched.Value } : new { status = "queued" });
        }

        [HttpDelete("queue")]
        [Authorize]
        public async Task<IActionResult> Cancel()
        {
            var user = await _users.GetUserAsync(User);
            if (user is null) return Unauthorized();
            var existing = await _db.MatchmakingQueue.FirstOrDefaultAsync(x => x.UserId == user.Id);
            if (existing is not null)
            {
                _db.MatchmakingQueue.Remove(existing);
                await _db.SaveChangesAsync();
            }
            return Ok(new { status = "cancelled" });
        }

        [HttpGet("status")]
        [Authorize]
        public async Task<IActionResult> Status()
        {
            var user = await _users.GetUserAsync(User);
            if (user is null) return Unauthorized();
            var entry = await _db.MatchmakingQueue.FirstOrDefaultAsync(x => x.UserId == user.Id);
            if (entry is null) return Ok(new { status = "idle" });
            var matched = await TryMatch(entry);
            if (matched.HasValue) return Ok(new { status = "matched", gameId = matched.Value });
            return Ok(new { status = "queued", waitSeconds = Math.Max(0, (int)(DateTime.UtcNow - entry.QueuedAt).TotalSeconds) });
        }

        private async Task<Guid?> TryMatch(MatchmakingEntry self)
        {
            var staleBefore = DateTime.UtcNow.AddMinutes(-5);
            var stale = await _db.MatchmakingQueue.Where(x => x.QueuedAt < staleBefore).ToListAsync();
            if (stale.Count > 0)
            {
                _db.MatchmakingQueue.RemoveRange(stale);
                await _db.SaveChangesAsync();
            }

            var candidates = await _db.MatchmakingQueue
                .Include(x => x.User)
                .Where(x => x.UserId != self.UserId)
                .OrderBy(x => x.QueuedAt)
                .ToListAsync();
            var now = DateTime.UtcNow;
            foreach (var candidate in candidates)
            {
                var eloDiff = Math.Abs(self.Elo - candidate.Elo);
                var waitSeconds = (now - candidate.QueuedAt).TotalSeconds;
                var acceptableRange = Math.Min(800, 100 + (int)(waitSeconds * 5));
                if (eloDiff > acceptableRange) continue;

                var selfFresh = await _db.MatchmakingQueue.FirstOrDefaultAsync(x => x.UserId == self.UserId);
                var candidateFresh = await _db.MatchmakingQueue.FirstOrDefaultAsync(x => x.UserId == candidate.UserId);
                if (selfFresh is null || candidateFresh is null) return null;

                var (selfColor, candidateColor) = ResolveColors(selfFresh.PreferredColor, candidateFresh.PreferredColor);
                var game = new Game { Code = ShortCode(), Status = "active" };
                _db.Games.Add(game);
                _db.GameParticipants.Add(new GameParticipant { Game = game, UserId = selfFresh.UserId, Color = selfColor });
                _db.GameParticipants.Add(new GameParticipant { Game = game, UserId = candidateFresh.UserId, Color = candidateColor });
                _db.MatchmakingQueue.Remove(selfFresh);
                _db.MatchmakingQueue.Remove(candidateFresh);
                await _db.SaveChangesAsync();

                var selfUser = await _users.FindByIdAsync(selfFresh.UserId.ToString());
                var candidateUser = await _users.FindByIdAsync(candidateFresh.UserId.ToString());
                if (selfUser is not null && candidateUser is not null)
                {
                    await _hub.Clients.User(selfFresh.UserId.ToString()).SendAsync("game:update", new { type = "matchmaking:found", gameId = game.Id, opponentName = candidateUser.DisplayName });
                    await _hub.Clients.User(candidateFresh.UserId.ToString()).SendAsync("game:update", new { type = "matchmaking:found", gameId = game.Id, opponentName = selfUser.DisplayName });
                }
                return game.Id;
            }
            return null;
        }

        private static (string firstColor, string secondColor) ResolveColors(string? firstPref, string? secondPref)
        {
            if (firstPref is "w" or "b" && secondPref is "w" or "b" && firstPref != secondPref)
                return (firstPref, secondPref);
            if (firstPref is "w" or "b" && secondPref is null)
                return (firstPref, firstPref == "w" ? "b" : "w");
            if (secondPref is "w" or "b" && firstPref is null)
                return (secondPref == "w" ? "b" : "w", secondPref);
            var whiteFirst = Random.Shared.Next(2) == 0;
            return whiteFirst ? ("w", "b") : ("b", "w");
        }

        private static string ShortCode()
            => Convert.ToBase64String(Guid.NewGuid().ToByteArray()).Replace("+", "").Replace("/", "").Replace("=", "").Substring(0, 6);

        public sealed record QueueDto(string? preferredColor);
    }
}
