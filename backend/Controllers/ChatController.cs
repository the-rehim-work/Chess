using backend.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace backend.Controllers
{
    [ApiController]
    [Route("api/chat")]
    [Authorize]
    public sealed class ChatController : ControllerBase
    {
        private readonly AppDb _db;
        public ChatController(AppDb db) { _db = db; }

        [HttpGet("threads/{withUserName}")]
        public async Task<IActionResult> GetThreadWith(string withUserName, int take = 50, int skip = 0)
        {
            var meId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var other = await _db.Users.FirstOrDefaultAsync(u => u.UserName == withUserName);
            if (other is null) return NotFound();

            var thread = await _db.DirectThreads
                .Include(t => t.Members)
                .FirstOrDefaultAsync(t => t.Members.Count == 2 &&
                                          t.Members.Any(m => m.UserId == meId) &&
                                          t.Members.Any(m => m.UserId == other.Id));
            if (thread is null)
                return Ok(new { threadId = (Guid?)null, items = Array.Empty<object>() });

            var items = await _db.DirectMessages
                .Where(m => m.ThreadId == thread.Id)
                .OrderByDescending(m => m.SentAt)
                .Skip(skip).Take(take)
                .Select(m => new
                {
                    m.Id,
                    m.SenderId,
                    m.KeyId,
                    m.NonceB64,
                    m.MacB64,
                    m.CiphertextB64,
                    m.BodyHashHex,
                    m.SentAt
                })
                .ToListAsync();

            return Ok(new { threadId = thread.Id, items = items.OrderBy(x => x.SentAt) });
        }

        [HttpGet("threads")]
        public async Task<IActionResult> ListThreads()
        {
            var meId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

            // find all direct threads with me
            var threads = await _db.DirectThreads
                .Include(t => t.Members).ThenInclude(m => m.User)
                .Include(t => t.Messages)
                .Where(t => t.Members.Any(m => m.UserId == meId))
                .Select(t => new
                {
                    t.Id,
                    WithUser = t.Members.Where(m => m.UserId != meId).Select(m => m.User.UserName).FirstOrDefault(),
                    Last = t.Messages.OrderByDescending(m => m.SentAt).FirstOrDefault(),
                    Unread = t.Messages.Count(m => m.SenderId != meId && m.ReadAt == null),
                    UpdatedAt = t.Messages.Max(m => (DateTime?)m.SentAt)
                })
                .ToListAsync();

            var dto = threads.Select(x => new
            {
                id = x.Id,
                withUser = x.WithUser ?? "(unknown)",
                lastMessage = x.Last == null ? null : "[encrypted]", // opaque on server; optional: show nothing
                unread = x.Unread,
                updatedAt = x.UpdatedAt?.ToString("o")
            });

            return Ok(dto);
        }

        [HttpPost("start")]
        public async Task<IActionResult> EnsureThread([FromBody] StartDto dto)
        {
            if (string.IsNullOrWhiteSpace(dto.WithUserName)) return BadRequest();
            var meId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var other = await _db.Users.FirstOrDefaultAsync(u => u.UserName == dto.WithUserName);
            if (other is null) return NotFound();

            var thread = await _db.DirectThreads
                .Include(t => t.Members)
                .FirstOrDefaultAsync(t => t.Members.Count == 2 &&
                                            t.Members.Any(m => m.UserId == meId) &&
                                            t.Members.Any(m => m.UserId == other.Id));
            if (thread is null)
            {
                thread = new DirectThread();
                _db.DirectThreads.Add(thread);
                _db.DirectThreadMembers.Add(new DirectThreadMember { Thread = thread, UserId = meId });
                _db.DirectThreadMembers.Add(new DirectThreadMember { Thread = thread, UserId = other.Id });
                await _db.SaveChangesAsync();
            }

            return Ok(new { threadId = thread.Id });
        }

        [HttpPost("mark-read/{withUserName}")]
        public async Task<IActionResult> MarkRead(string withUserName)
        {
            var meId = Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
            var other = await _db.Users.FirstOrDefaultAsync(u => u.UserName == withUserName);
            if (other is null) return NotFound();

            var thread = await _db.DirectThreads
                .Include(t => t.Members)
                .FirstOrDefaultAsync(t => t.Members.Count == 2 &&
                                            t.Members.Any(m => m.UserId == meId) &&
                                            t.Members.Any(m => m.UserId == other.Id));
            if (thread is null) return NoContent();

            var unread = await _db.DirectMessages
                .Where(m => m.ThreadId == thread.Id && m.SenderId == other.Id && m.ReadAt == null)
                .ToListAsync();

            foreach (var m in unread) m.ReadAt = DateTime.UtcNow;
            if (unread.Count > 0) await _db.SaveChangesAsync();

            return Ok(new { count = unread.Count });
        }

        [HttpGet("/api/users/search")]
        [AllowAnonymous]
        public async Task<IActionResult> SearchUsers([FromQuery] string q)
        {
            q = (q ?? "").Trim();
            if (q.Length < 2) return Ok(Array.Empty<object>());
            var results = await _db.Users
                .Where(u => u.UserName != null && u.UserName.Contains(q))
                .OrderBy(u => u.UserName)
                .Take(20)
                .Select(u => new { u.UserName })
                .ToListAsync();
            return Ok(results);
        }
        public sealed record StartDto(string WithUserName);
    }
}