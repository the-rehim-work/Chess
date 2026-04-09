using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace backend.Controllers
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

        // ─────────────────────────────────────────────────────────────────────────
        // CREATE
        // ─────────────────────────────────────────────────────────────────────────
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

        // ─────────────────────────────────────────────────────────────────────────
        // READ (single)
        // ─────────────────────────────────────────────────────────────────────────
        [HttpGet("games/{id:guid}")]
        [AllowAnonymous]
        public async Task<IActionResult> GetGame(Guid id)
        {
            var g = await _db.Games
                .Include(x => x.Participants).ThenInclude(p => p.User)
                .Include(x => x.History)
                .FirstOrDefaultAsync(x => x.Id == id);

            if (g is null) return NotFound();

            ApplicationUser? me = null;
            if (User?.Identity?.IsAuthenticated == true)
                me = await _users.GetUserAsync(User);

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
                    .ToList(),
                Perspective = me == null ? null : new
                {
                    IsParticipant = g.Participants.Any(p => p.UserId == me.Id),
                    MyColor = g.Participants.Where(p => p.UserId == me.Id).Select(p => p.Color).FirstOrDefault()
                }
            };

            return Ok(dto);
        }

        // Optional: explicit read-only fetch (kept for compatibility)
        [HttpGet("games/{id:guid}/spectate")]
        [AllowAnonymous]
        public async Task<IActionResult> Spectate(Guid id)
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
                    .ToList(),
                IsReadOnly = true
            };

            return Ok(dto);
        }

        [HttpGet("games/by-code/{code}")]
        [AllowAnonymous]
        public async Task<IActionResult> GetGameByCode(string code)
        {
            var g = await _db.Games.FirstOrDefaultAsync(x => x.Code == code);
            if (g is null) return NotFound();
            return Ok(new { g.Id, g.Code, g.Fen, g.Status });
        }

        // ─────────────────────────────────────────────────────────────────────────
        // READ (list): unified endpoint with filters
        // ─────────────────────────────────────────────────────────────────────────
        // status: all | waiting | active | finished
        // onlyMine: true/false
        // q: search in code or displayName
        [HttpGet("games")]
        [Authorize]
        public async Task<IActionResult> GetGames(
            [FromQuery] string status = "all",
            [FromQuery] bool onlyMine = false,
            [FromQuery] string? q = null)
        {
            var me = await _users.GetUserAsync(User);

            IQueryable<Game> query = _db.Games
                .Include(x => x.Participants).ThenInclude(p => p.User);

            if (status is "waiting" or "active" or "finished")
                query = query.Where(x => x.Status == status);

            if (onlyMine)
                query = query.Where(x => x.Participants.Any(p => p.UserId == me.Id));

            if (!string.IsNullOrWhiteSpace(q))
            {
                var ql = q.ToLower();
                query = query.Where(x =>
                    x.Code.ToLower().Contains(ql) ||
                    x.Participants.Any(p => (p.User.DisplayName ?? p.User.UserName).ToLower().Contains(ql)));
            }

            var rows = await query
                .OrderByDescending(x => x.CreatedAt)
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
                    }).ToList(),
                    Perspective = new
                    {
                        IsParticipant = x.Participants.Any(p => p.UserId == me.Id),
                        MyColor = x.Participants.Where(p => p.UserId == me.Id).Select(p => p.Color).FirstOrDefault(),
                        CanJoinWhite = !x.Participants.Any(p => p.Color == "w") && x.Status == "waiting",
                        CanJoinBlack = !x.Participants.Any(p => p.Color == "b") && x.Status == "waiting",
                        IsFull = x.Participants.Count >= 2
                    }
                })
                .ToListAsync();

            return Ok(rows);
        }

        // ─────────────────────────────────────────────────────────────────────────
        // JOIN: auto-assign seats; if full → spectator
        // ─────────────────────────────────────────────────────────────────────────
        [HttpPost("games/{id:guid}/join")]
        [Authorize]
        public async Task<IActionResult> JoinGame(Guid id, [FromQuery] string color = "auto")
        {
            color = color?.ToLowerInvariant() switch { "w" => "w", "b" => "b", _ => "auto" };

            var g = await _db.Games
                .Include(x => x.Participants)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (g is null) return NotFound();

            var user = await _users.GetUserAsync(User);
            if (user is null) return Unauthorized();

            var me = g.Participants.FirstOrDefault(p => p.UserId == user.Id);
            var whiteTaken = g.Participants.Any(p => p.Color == "w");
            var blackTaken = g.Participants.Any(p => p.Color == "b");
            var full = g.Participants.Count >= 2;

            // Already in → idempotent response
            if (me != null)
                return Ok(new { g.Id, g.Code, role = me.Color, g.Status });

            // Full → spectator
            if (full)
                return Ok(new { g.Id, g.Code, role = "spectator", g.Status, message = "Both seats taken. Entered as spectator." });

            // Only waiting games accept new players
            if (g.Status != "waiting")
                return BadRequest(new { message = "Cannot join as player; game is not in 'waiting' state." });

            // Seat selection
            string chosen = color switch
            {
                "w" when !whiteTaken => "w",
                "b" when !blackTaken => "b",
                "auto" => !whiteTaken ? "w" : "b",
                _ => null!
            };
            if (chosen is null)
                return Conflict(new { message = $"Requested color '{color}' unavailable." });

            var gp = new GameParticipant { GameId = g.Id, UserId = user.Id, Color = chosen };
            _db.GameParticipants.Add(gp);

            // Activate if we just completed the pair
            if ((chosen == "w" && blackTaken) || (chosen == "b" && whiteTaken))
                g.Status = "active";

            await _db.SaveChangesAsync();

            await _hub.Clients.Group(g.Id.ToString()).SendAsync("game:update", new
            {
                type = "join",
                gameId = g.Id,
                player = user.DisplayName ?? user.UserName,
                color = chosen,
                status = g.Status
            });

            return Ok(new { g.Id, g.Code, role = chosen, g.Status });
        }

        // ─────────────────────────────────────────────────────────────────────────
        // MOVE
        // ─────────────────────────────────────────────────────────────────────────
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

            var user = await _users.GetUserAsync(User);
            if (user is null) return Unauthorized();

            var gp = g.Participants.FirstOrDefault(p => p.UserId == user.Id);
            if (gp is null) return Forbid();

            var sideToMove = ActiveColorFromFen(g.Fen);
            if (!string.Equals(gp.Color, sideToMove, StringComparison.OrdinalIgnoreCase))
                return Forbid();

            var nextSide = ActiveColorFromFen(dto.fen);
            if (string.Equals(nextSide, gp.Color, StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { message = "Post-move FEN indicates same side to move; illegal transition." });

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

        // ─────────────────────────────────────────────────────────────────────────
        // RESIGN
        // ─────────────────────────────────────────────────────────────────────────
        [HttpPost("games/{id:guid}/resign")]
        [Authorize]
        public async Task<IActionResult> Resign(Guid id)
        {
            var g = await _db.Games
                .Include(x => x.Participants)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (g is null) return NotFound();
            if (g.Status != "active") return BadRequest(new { message = "Game is not active." });

            var user = await _users.GetUserAsync(User);
            if (user is null) return Unauthorized();

            var gp = g.Participants.FirstOrDefault(p => p.UserId == user.Id);
            if (gp is null) return Forbid();

            var callerColor = gp.Color == "b" ? "b" : "w";

            g.Outcome = "resign";
            g.Reason = callerColor == "w" ? "Black wins" : "White wins";
            g.Status = "finished";

            await _db.SaveChangesAsync();

            await _hub.Clients.Group(g.Id.ToString()).SendAsync("game:update", new
            {
                type = "resign",
                gameId = g.Id,
                outcome = g.Outcome,
                reason = g.Reason,
                resignedColor = callerColor,
                status = g.Status
            });

            return Ok(new { g.Outcome, g.Reason, g.Status });
        }

        // ─────────────────────────────────────────────────────────────────────────
        // UNDO (one ply)
        // ─────────────────────────────────────────────────────────────────────────
        [HttpPost("games/{id:guid}/undo")]
        [Authorize]
        public async Task<IActionResult> Undo(Guid id)
        {
            var g = await _db.Games
                .Include(x => x.Participants)
                .Include(x => x.History)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (g is null) return NotFound();

            var user = await _users.GetUserAsync(User);
            if (user is null) return Unauthorized();
            var gp = g.Participants.FirstOrDefault(p => p.UserId == user.Id);
            if (gp is null) return Forbid();

            var last = g.History.OrderByDescending(m => m.Index).FirstOrDefault();
            if (last is null) return NoContent();

            _db.Moves.Remove(last);
            await _db.SaveChangesAsync();

            var newLast = await _db.Moves
                .Where(m => m.GameId == g.Id)
                .OrderBy(m => m.Index)
                .LastOrDefaultAsync();

            g.Fen = newLast?.FenAfter ?? "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
            g.Outcome = null;
            g.Reason = null;

            await _db.SaveChangesAsync();

            await _hub.Clients.Group(g.Id.ToString()).SendAsync("game:update", new
            {
                type = "undo",
                gameId = g.Id,
                fen = g.Fen,
                undoneMove = new { last.Index, last.From, last.To, last.Flags, last.Promotion }
            });

            return Ok(new { fen = g.Fen });
        }

        // ─────────────────────────────────────────────────────────────────────────
        // HUB ROUTE
        // ─────────────────────────────────────────────────────────────────────────
        [HttpPost("games/{id:guid}/connect")]
        [AllowAnonymous]
        public IActionResult GetHubRoute(Guid id)
        {
            return Ok(new { hub = "/hubs/game", gameId = id.ToString() });
        }

        // ─────────────────────────────────────────────────────────────────────────
        // HELPERS
        // ─────────────────────────────────────────────────────────────────────────
        private static string ActiveColorFromFen(string fen)
        {
            var parts = fen.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            return (parts.Length >= 2 ? parts[1] : "w").ToLowerInvariant();
        }

        private static string ShortCode()
            => Convert.ToBase64String(Guid.NewGuid().ToByteArray())
               .Replace("+", "").Replace("/", "").Replace("=", "")
               .Substring(0, 6);

        public sealed record CreateGameDto(string? Fen);
        public sealed record MoveDto(int from, int to, string? flags, string? promotion, string fen, string? outcome, string? reason);
    }
}
