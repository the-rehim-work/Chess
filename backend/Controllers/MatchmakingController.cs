using backend;
using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/matchmaking")]
    [Authorize]
    public sealed class MatchmakingController : ControllerBase
    {
        private readonly AppDb _db;
        private readonly UserManager<ApplicationUser> _users;
        private readonly IHubContext<ChatHub> _chatHub;

        public MatchmakingController(AppDb db, UserManager<ApplicationUser> users, IHubContext<ChatHub> chatHub)
        {
            _db = db;
            _users = users;
            _chatHub = chatHub;
        }

        [HttpPost("queue")]
        public async Task<IActionResult> Queue([FromBody] QueueDto? dto)
        {
            var userId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

            var pending = await _db.MatchResults.FirstOrDefaultAsync(r => r.UserId == userId && !r.Consumed);
            if (pending != null)
            {
                pending.Consumed = true;
                await _db.SaveChangesAsync();
                return Ok(new { status = "matched", gameId = pending.GameId });
            }

            var existing = await _db.MatchmakingQueue.FirstOrDefaultAsync(x => x.UserId == userId);
            if (existing != null)
            {
                var matched = await TryMatch(existing);
                if (matched.HasValue) return Ok(new { status = "matched", gameId = matched.Value });
                return Ok(new { status = "already_queued" });
            }

            var rating = await _db.PlayerRatings.FirstOrDefaultAsync(r => r.UserId == userId);
            if (rating == null)
            {
                rating = new PlayerRating { UserId = userId };
                _db.PlayerRatings.Add(rating);
                await _db.SaveChangesAsync();
            }

            var entry = new MatchmakingEntry
            {
                UserId = userId,
                Elo = rating.Elo,
                PreferredColor = dto?.preferredColor is "w" or "b" ? dto.preferredColor : null
            };
            _db.MatchmakingQueue.Add(entry);
            await _db.SaveChangesAsync();

            var result = await TryMatch(entry);
            if (result.HasValue) return Ok(new { status = "matched", gameId = result.Value });
            return Ok(new { status = "queued" });
        }

        [HttpDelete("queue")]
        public async Task<IActionResult> Cancel()
        {
            var userId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var entry = await _db.MatchmakingQueue.FirstOrDefaultAsync(x => x.UserId == userId);
            if (entry != null)
            {
                _db.MatchmakingQueue.Remove(entry);
                await _db.SaveChangesAsync();
            }
            return Ok(new { status = "cancelled" });
        }

        [HttpGet("status")]
        public async Task<IActionResult> Status()
        {
            var userId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

            var pending = await _db.MatchResults.FirstOrDefaultAsync(r => r.UserId == userId && !r.Consumed);
            if (pending != null)
            {
                pending.Consumed = true;
                await _db.SaveChangesAsync();
                return Ok(new { status = "matched", gameId = pending.GameId });
            }

            var entry = await _db.MatchmakingQueue.FirstOrDefaultAsync(x => x.UserId == userId);
            if (entry == null) return Ok(new { status = "idle" });

            var matched = await TryMatch(entry);
            if (matched.HasValue) return Ok(new { status = "matched", gameId = matched.Value });

            return Ok(new { status = "queued", waitSeconds = Math.Max(0, (int)(DateTime.UtcNow - entry.QueuedAt).TotalSeconds) });
        }

        private async Task<Guid?> TryMatch(MatchmakingEntry self)
        {
            var cutoff = DateTime.UtcNow.AddMinutes(-5);
            var stale = await _db.MatchmakingQueue.Where(x => x.QueuedAt < cutoff).ToListAsync();
            if (stale.Count > 0) { _db.MatchmakingQueue.RemoveRange(stale); await _db.SaveChangesAsync(); }

            var candidates = await _db.MatchmakingQueue
                .Where(x => x.UserId != self.UserId)
                .OrderBy(x => x.QueuedAt)
                .ToListAsync();

            var now = DateTime.UtcNow;
            var selfWait = (now - self.QueuedAt).TotalSeconds;

            foreach (var c in candidates)
            {
                var diff = Math.Abs(self.Elo - c.Elo);
                var cWait = (now - c.QueuedAt).TotalSeconds;
                var range = Math.Min(800, 100 + (int)(Math.Max(selfWait, cWait) * 5));
                if (diff > range) continue;

                var selfEntry = await _db.MatchmakingQueue.FirstOrDefaultAsync(x => x.UserId == self.UserId);
                var cEntry = await _db.MatchmakingQueue.FirstOrDefaultAsync(x => x.UserId == c.UserId);
                if (selfEntry == null || cEntry == null) return null;

                var (colorA, colorB) = ResolveColors(selfEntry.PreferredColor, cEntry.PreferredColor);

                var game = new Game { Code = ShortCode(), Status = "active", IsRanked = true };
                _db.Games.Add(game);
                _db.GameParticipants.Add(new GameParticipant { Game = game, UserId = selfEntry.UserId, Color = colorA });
                _db.GameParticipants.Add(new GameParticipant { Game = game, UserId = cEntry.UserId, Color = colorB });

                _db.MatchResults.Add(new MatchResult { UserId = selfEntry.UserId, GameId = game.Id });
                _db.MatchResults.Add(new MatchResult { UserId = cEntry.UserId, GameId = game.Id });

                _db.MatchmakingQueue.Remove(selfEntry);
                _db.MatchmakingQueue.Remove(cEntry);
                await _db.SaveChangesAsync();

                await _chatHub.Clients.Group($"u:{selfEntry.UserId}").SendAsync("chat:update", new { type = "matchmaking:found", gameId = game.Id });
                await _chatHub.Clients.Group($"u:{cEntry.UserId}").SendAsync("chat:update", new { type = "matchmaking:found", gameId = game.Id });

                return game.Id;
            }
            return null;
        }

        private static (string, string) ResolveColors(string? a, string? b)
        {
            if (a is "w" or "b" && b is "w" or "b" && a != b) return (a, b);
            if (a is "w" or "b" && b is null) return (a, a == "w" ? "b" : "w");
            if (b is "w" or "b" && a is null) return (b == "w" ? "b" : "w", b);
            return Random.Shared.Next(2) == 0 ? ("w", "b") : ("b", "w");
        }

        private static string ShortCode() =>
            Convert.ToBase64String(Guid.NewGuid().ToByteArray()).Replace("+", "").Replace("/", "").Replace("=", "")[..6];

        public sealed record QueueDto(string? preferredColor);
    }
}
