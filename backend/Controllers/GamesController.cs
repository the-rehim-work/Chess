using backend.Data;
using backend.Services;
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
        private readonly EloService _eloService;

        public GamesController(AppDb db, IHubContext<GameHub> hub, UserManager<ApplicationUser> users, EloService eloService)
        {
            _db = db;
            _hub = hub;
            _users = users;
            _eloService = eloService;
        }

        // ─────────────────────────────────────────────────────────────────────────
        // CREATE
        // ─────────────────────────────────────────────────────────────────────────
        [HttpPost("games")]
        [Authorize]
        public async Task<IActionResult> CreateGame([FromBody] CreateGameDto? dto)
        {
            var user = await _users.GetUserAsync(User);
            if (user is null) return Unauthorized();

            var defaultFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
            var fen = string.IsNullOrWhiteSpace(dto?.Fen) ? defaultFen : dto!.Fen;
            var isCustom = !string.Equals(fen, defaultFen, StringComparison.Ordinal);

            string creatorColor;
            if (dto?.PreferredColor == "w") creatorColor = "w";
            else if (dto?.PreferredColor == "b") creatorColor = "b";
            else creatorColor = Random.Shared.Next(2) == 0 ? "w" : "b";

            var game = new Game
            {
                Code = ShortCode(),
                Fen = fen,
                Status = "waiting",
                IsRanked = !isCustom
            };
            _db.Games.Add(game);
            _db.GameParticipants.Add(new GameParticipant { Game = game, UserId = user.Id, Color = creatorColor });
            await _db.SaveChangesAsync();

            return Ok(new { game.Id, game.Code, game.Fen, game.Status, myColor = creatorColor });
        }

        // ─────────────────────────────────────────────────────────────────────────
        // READ (single)
        // ─────────────────────────────────────────────────────────────────────────
        [HttpGet("games/{id:guid}")]
        [AllowAnonymous]
        public async Task<IActionResult> GetGame(Guid id)
        {
            var g = await _db.Games
                .Include(x => x.Participants).ThenInclude(p => p.User).ThenInclude(u => u.Rating)
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
                g.IsRanked,
                g.IsBotGame,
                g.BotDifficulty,
                Participants = g.Participants
                    .Select(p => new
                    {
                        p.User.DisplayName,
                        p.Color,
                        p.User.IsBot,
                        Elo = p.User.Rating != null ? p.User.Rating.Elo : 1200,
                        League = p.User.Rating != null ? p.User.Rating.League : "Bronze IV"
                    })
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
                .Include(x => x.Participants).ThenInclude(p => p.User).ThenInclude(u => u.Rating)
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
                g.IsRanked,
                g.IsBotGame,
                g.BotDifficulty,
                Participants = g.Participants
                    .Select(p => new
                    {
                        p.User.DisplayName,
                        p.Color,
                        p.User.IsBot,
                        Elo = p.User.Rating != null ? p.User.Rating.Elo : 1200,
                        League = p.User.Rating != null ? p.User.Rating.League : "Bronze IV"
                    })
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
            if (me is null) return Unauthorized();

            var meId = me.Id;

            IQueryable<Game> query = _db.Games
                .Include(x => x.Participants).ThenInclude(p => p.User).ThenInclude(u => u.Rating);

            if (status is "waiting" or "active" or "finished")
                query = query.Where(x => x.Status == status);

            if (onlyMine)
                query = query.Where(x => x.Participants.Any(p => p.UserId == meId));

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
                    x.IsRanked,
                    x.IsBotGame,
                    x.BotDifficulty,
                    Participants = x.Participants.Select(p => new
                    {
                        p.User.DisplayName,
                        p.Color,
                        p.User.IsBot,
                        Elo = p.User.Rating != null ? p.User.Rating.Elo : 1200,
                        League = p.User.Rating != null ? p.User.Rating.League : "Bronze IV"
                    }).ToList(),
                    Perspective = new
                    {
                        IsParticipant = x.Participants.Any(p => p.UserId == meId),
                        MyColor = x.Participants.Where(p => p.UserId == meId).Select(p => p.Color).FirstOrDefault(),
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

            object? eloChange = null;
            if (g.Status == "finished")
                eloChange = await ApplyRatingsForFinishedGame(g, dto.outcome, dto.reason, null);

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
                status = g.Status,
                eloChange
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
            var eloChange = await ApplyRatingsForFinishedGame(g, g.Outcome, g.Reason, callerColor);

            await _db.SaveChangesAsync();

            await _hub.Clients.Group(g.Id.ToString()).SendAsync("game:update", new
            {
                type = "resign",
                gameId = g.Id,
                outcome = g.Outcome,
                reason = g.Reason,
                resignedColor = callerColor,
                status = g.Status,
                eloChange
            });

            return Ok(new { g.Outcome, g.Reason, g.Status });
        }

        [HttpPost("games/{id:guid}/bot-move")]
        [Authorize]
        public async Task<IActionResult> PostBotMove(Guid id, [FromBody] MoveDto dto)
        {
            var g = await _db.Games
                .Include(x => x.Participants).ThenInclude(p => p.User)
                .Include(x => x.History)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (g is null) return NotFound();
            if (g.Status != "active") return BadRequest(new { message = "Game is not active." });
            var caller = await _users.GetUserAsync(User);
            if (caller is null) return Unauthorized();
            if (!g.Participants.Any(p => p.UserId == caller.Id)) return Forbid();

            var botParticipant = g.Participants.FirstOrDefault(p => p.User.IsBot);
            if (botParticipant is null) return BadRequest(new { message = "Game has no bot participant." });
            var sideToMove = ActiveColorFromFen(g.Fen);
            if (!string.Equals(botParticipant.Color, sideToMove, StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { message = "It's not bot's turn." });

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
            object? eloChange = null;
            if (g.Status == "finished")
                eloChange = await ApplyRatingsForFinishedGame(g, dto.outcome, dto.reason, null);
            await _db.SaveChangesAsync();
            await _hub.Clients.Group(g.Id.ToString()).SendAsync("game:update", new
            {
                type = "move",
                gameId = g.Id,
                fen = g.Fen,
                outcome = g.Outcome,
                reason = g.Reason,
                status = g.Status,
                eloChange
            });
            return Ok(new { fen = g.Fen, g.Outcome, g.Reason });
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

        private async Task<object?> ApplyRatingsForFinishedGame(Game g, string? outcome, string? reason, string? resignedColor)
        {
            if (!g.IsRanked) return null;
            var participants = await _db.GameParticipants
                .Include(p => p.User)
                .Where(p => p.GameId == g.Id)
                .ToListAsync();
            var white = participants.FirstOrDefault(p => p.Color == "w");
            var black = participants.FirstOrDefault(p => p.Color == "b");
            if (white is null || black is null) return null;

            var result = ResolveResult(outcome, reason, resignedColor);
            if (result is null) return null;

            var whiteRating = await EnsureRating(white.UserId);
            var blackRating = await EnsureRating(black.UserId);
            var oldWhite = whiteRating.Elo;
            var oldBlack = blackRating.Elo;
            var (newWhite, newBlack) = _eloService.Calculate(oldWhite, oldBlack, result, whiteRating.GamesPlayed, blackRating.GamesPlayed);

            if (white.User.IsBot && !black.User.IsBot)
                newWhite = oldWhite;
            if (black.User.IsBot && !white.User.IsBot)
                newBlack = oldBlack;

            UpdateRatingStats(whiteRating, oldWhite, newWhite, result == "w", result == "draw", white.User.IsBot);
            UpdateRatingStats(blackRating, oldBlack, newBlack, result == "b", result == "draw", black.User.IsBot);

            return new
            {
                white = new { oldElo = oldWhite, newElo = newWhite, league = whiteRating.League },
                black = new { oldElo = oldBlack, newElo = newBlack, league = blackRating.League }
            };
        }

        private async Task<PlayerRating> EnsureRating(Guid userId)
        {
            var rating = await _db.PlayerRatings.FirstOrDefaultAsync(x => x.UserId == userId);
            if (rating != null) return rating;
            rating = new PlayerRating { UserId = userId, League = EloService.GetLeague(1200) };
            _db.PlayerRatings.Add(rating);
            return rating;
        }

        private static string? ResolveResult(string? outcome, string? reason, string? resignedColor)
        {
            if (string.Equals(outcome, "draw", StringComparison.OrdinalIgnoreCase)) return "draw";
            if (string.Equals(outcome, "resign", StringComparison.OrdinalIgnoreCase))
                return resignedColor == "w" ? "b" : "w";
            var normalizedReason = (reason ?? string.Empty).ToLowerInvariant();
            if (normalizedReason.Contains("white wins")) return "w";
            if (normalizedReason.Contains("black wins")) return "b";
            return null;
        }

        private static void UpdateRatingStats(PlayerRating rating, int oldElo, int newElo, bool win, bool draw, bool isBot)
        {
            if (isBot) return;
            rating.Elo = newElo;
            rating.GamesPlayed += 1;
            if (draw)
            {
                rating.Draws += 1;
                rating.WinStreak = 0;
            }
            else if (win)
            {
                rating.Wins += 1;
                rating.WinStreak += 1;
                rating.BestWinStreak = Math.Max(rating.BestWinStreak, rating.WinStreak);
            }
            else
            {
                rating.Losses += 1;
                rating.WinStreak = 0;
            }
            rating.PeakElo = Math.Max(rating.PeakElo, newElo);
            rating.League = EloService.GetLeague(newElo);
            rating.UpdatedAt = DateTime.UtcNow;
        }

        public sealed record CreateGameDto(string? Fen, string? PreferredColor);
        public sealed record MoveDto(int from, int to, string? flags, string? promotion, string fen, string? outcome, string? reason);
    }
}
