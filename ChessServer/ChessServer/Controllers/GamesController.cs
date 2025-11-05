using ChessServer.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChessServer.Controllers
{
    [ApiController]
    [Route("api")]
    public sealed class GamesController : ControllerBase
    {
        private readonly AppDb _db;
        private readonly IHubContext<GameHub> _hub;
        private readonly UserManager<ApplicationUser> _users;

        public GamesController(AppDb db, IHubContext<GameHub> hub, UserManager<ApplicationUser> users)
        {
            _db = db;
            _hub = hub;
            _users = users;
        }

        // POST: /api/games
        [HttpPost("games")]
        [Authorize]
        public async Task<IActionResult> CreateGame([FromBody] CreateGameDto? dto)
        {
            var code = ShortCode();
            var game = new Game
            {
                Code = code,
                Fen = string.IsNullOrWhiteSpace(dto?.Fen)
                    ? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                    : dto!.Fen,
                Status = "waiting"
            };

            _db.Games.Add(game);
            await _db.SaveChangesAsync();

            return Ok(new { game.Id, game.Code, game.Fen, game.Status });
        }

        // GET: /api/games/{id}
        [HttpGet("games/{id:guid}")]
        [AllowAnonymous]
        public async Task<IActionResult> GetGame(Guid id)
        {
            var g = await _db.Games
                .Include(x => x.Participants).ThenInclude(p => p.User)
                .Include(x => x.History)
                .FirstOrDefaultAsync(x => x.Id == id);

            if (g is null) return NotFound();

            var dto = new
            {
                g.Id,
                g.Code,
                g.Fen,
                g.Status,
                g.CreatedAt,
                g.Outcome,
                g.Reason,
                Participants = g.Participants
                    .Select(p => new { p.User.DisplayName, p.Color })
                    .ToList(),
                History = g.History
                    .OrderBy(m => m.Index)
                    .Select(m => new
                    {
                        m.Index,
                        m.From,
                        m.To,
                        m.Flags,
                        m.Promotion,
                        m.FenAfter,
                        m.Outcome,
                        m.Reason
                    })
                    .ToList()
            };

            return Ok(dto);
        }

        // GET: /api/games/by-code/{code}
        [HttpGet("games/by-code/{code}")]
        [AllowAnonymous]
        public async Task<IActionResult> GetGameByCode(string code)
        {
            var g = await _db.Games.FirstOrDefaultAsync(x => x.Code == code);
            if (g is null) return NotFound();
            return Ok(new { g.Id, g.Code, g.Fen, g.Status });
        }

        // GET: /api/games/waiting
        [HttpGet("games/waiting")]
        [Authorize]
        public async Task<IActionResult> GetWaitingGames()
        {
            var user = await _users.GetUserAsync(User);
            if (user is null) return Unauthorized();

            var games = await _db.Games
                .Where(x => x.Status == "waiting"
                            || (x.Status == "active" && x.Participants.Any(p => p.UserId == user.Id))
                            || (x.Status == "finished" && x.Participants.Any(p => p.UserId == user.Id)))
                .Include(x => x.Participants).ThenInclude(p => p.User)
                .Select(x => new
                {
                    x.Id,
                    x.Code,
                    x.CreatedAt,
                    x.Status,
                    x.Fen,
                    x.Outcome,
                    x.Reason,
                    Participants = x.Participants.Select(p => new
                    {
                        p.User.DisplayName,
                        p.Color
                    }).ToList()
                })
                .ToListAsync();

            return Ok(games);
        }

        // POST: /api/games/{id}/join?color=w|b
        [HttpPost("games/{id:guid}/join")]
        [Authorize]
        public async Task<IActionResult> JoinGame(Guid id, [FromQuery] string color = "w")
        {
            color = (color == "b") ? "b" : "w";

            var g = await _db.Games
                .Include(x => x.Participants)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (g is null) return NotFound();

            var user = await _users.GetUserAsync(User);
            if (user is null) return Unauthorized();

            // Already in game?
            var existing = g.Participants.FirstOrDefault(p => p.UserId == user.Id);
            if (existing != null)
            {
                if (existing.Color == color)
                    return Ok(new { g.Id, g.Code, color = existing.Color, g.Status });

                return Conflict(new { message = "You already joined this game with the other color." });
            }

            // Color taken?
            if (g.Participants.Any(p => p.Color == color))
                return Conflict(new { message = $"Color '{color}' already taken." });

            // Max players guard
            if (g.Participants.Count >= 2)
                return Conflict(new { message = "Game already has two players." });

            var gp = new GameParticipant { GameId = g.Id, UserId = user.Id, Color = color };
            _db.GameParticipants.Add(gp);

            // Activate when both colors present
            if (g.Participants.Any(p => p.Color == "w") && color == "b"
                || g.Participants.Any(p => p.Color == "b") && color == "w")
            {
                g.Status = "active";
            }

            await _db.SaveChangesAsync();

            await _hub.Clients.Group(g.Id.ToString()).SendAsync("game:update", new
            {
                type = "join",
                gameId = g.Id,
                player = user.DisplayName ?? user.UserName,
                color,
                status = g.Status
            });

            return Ok(new { g.Id, g.Code, color, g.Status });
        }

        // GamesController.cs — inside the controller
        [HttpPost("games/{id:guid}/move")]
        [Authorize]
        public async Task<IActionResult> PostMove(Guid id, [FromBody] MoveDto dto)
        {
            var g = await _db.Games
                .Include(x => x.Participants)
                .Include(x => x.History)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (g is null) return NotFound();
            if (g.Status != "active") return BadRequest(new { message = "Game is not active." });

            // Identify caller + their color
            var user = await _users.GetUserAsync(User);
            if (user is null) return Unauthorized();
            var gp = g.Participants.FirstOrDefault(p => p.UserId == user.Id);
            if (gp is null) return Forbid();

            var sideToMove = ActiveColorFromFen(g.Fen); // 'w' or 'b'
            if (!string.Equals(gp.Color, sideToMove, StringComparison.OrdinalIgnoreCase))
                return Forbid(); // not your move

            // (Optional) verify dto flags/promotion etc. Here we trust client move legality.

            var nextIdx = g.History.Count;

            var move = new Move
            {
                GameId = g.Id,
                Index = nextIdx,
                From = dto.from,
                To = dto.to,
                Flags = dto.flags,
                Promotion = dto.promotion,
                FenAfter = dto.fen,
                Outcome = dto.outcome,
                Reason = dto.reason
            };
            _db.Moves.Add(move);

            g.Fen = dto.fen;
            g.Outcome = dto.outcome;
            g.Reason = dto.reason;
            if (!string.IsNullOrEmpty(dto.outcome)) g.Status = "finished";

            await _db.SaveChangesAsync();

            await _hub.Clients.Group(g.Id.ToString()).SendAsync("game:update", new
            {
                type = "move",
                gameId = g.Id,
                move = new
                {
                    from = dto.from,
                    to = dto.to,
                    flags = dto.flags,
                    promotion = dto.promotion,
                    fen = dto.fen,
                    outcome = dto.outcome,
                    reason = dto.reason,
                    index = nextIdx
                },
                fen = g.Fen,
                outcome = g.Outcome,
                reason = g.Reason,
                status = g.Status
            });

            return Ok(new { fen = g.Fen, g.Outcome, g.Reason });
        }

        private static string ActiveColorFromFen(string fen)
        {
            // FEN: "pieces side ..."; side is 'w' or 'b'
            var parts = fen.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            return (parts.Length >= 2 ? parts[1] : "w").ToLowerInvariant();
        }

        // POST: /api/games/{id}/resign?color=w|b
        [HttpPost("games/{id:guid}/resign")]
        [Authorize]
        public async Task<IActionResult> Resign(Guid id, [FromQuery] string color = "w")
        {
            color = (color == "b") ? "b" : "w";
            var g = await _db.Games.FindAsync(id);
            if (g is null) return NotFound();

            g.Outcome = "resign";
            g.Reason = color == "w" ? "Black wins" : "White wins";
            g.Status = "finished";

            await _db.SaveChangesAsync();

            await _hub.Clients.Group(g.Id.ToString()).SendAsync("game:update", new
            {
                type = "resign",
                gameId = g.Id,
                outcome = g.Outcome,
                reason = g.Reason,
                resignedColor = color,
                status = g.Status
            });

            return Ok(new { g.Outcome, g.Reason, g.Status });
        }

        // POST: /api/games/{id}/undo
        [HttpPost("games/{id:guid}/undo")]
        [Authorize]
        public async Task<IActionResult> Undo(Guid id)
        {
            var g = await _db.Games.Include(x => x.History).FirstOrDefaultAsync(x => x.Id == id);
            if (g is null) return NotFound();

            var last = g.History.OrderByDescending(m => m.Index).FirstOrDefault();
            if (last is null) return NoContent();

            _db.Moves.Remove(last);
            await _db.SaveChangesAsync();

            var newLast = await _db.Moves.Where(m => m.GameId == g.Id).OrderBy(m => m.Index).LastOrDefaultAsync();
            g.Fen = newLast?.FenAfter ?? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
            g.Outcome = null;
            g.Reason = null;

            await _db.SaveChangesAsync();

            await _hub.Clients.Group(g.Id.ToString()).SendAsync("game:update", new
            {
                type = "undo",
                gameId = g.Id,
                fen = g.Fen,
                undoneMove = last
            });

            return Ok(new { fen = g.Fen });
        }

        // Optional helper: tells client hub route/group model
        [HttpPost("games/{id:guid}/connect")]
        [AllowAnonymous]
        public IActionResult GetHubRoute(Guid id)
        {
            return Ok(new { hub = "/hubs/game", gameId = id.ToString() });
        }

        private static string? ComputeOutcome(string fen)
        {
            // TODO: Implement server-side legality/outcome if you want hard authority here.
            return null;
        }

        private static string ShortCode()
            => Convert.ToBase64String(Guid.NewGuid().ToByteArray())
               .Replace("+", "").Replace("/", "").Replace("=", "")
               .Substring(0, 6);

        // DTOs
        public sealed record CreateGameDto(string? Fen);
        public sealed record MoveDto(int from, int to, string? flags, string? promotion, string fen, string? outcome, string? reason);
    }
}
