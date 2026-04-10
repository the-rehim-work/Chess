using backend.Data;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace backend
{
    [Authorize]
    public sealed class ChatHub : Hub
    {
        private readonly AppDb _db;
        private readonly PresenceTracker _presence;

        public ChatHub(AppDb db, PresenceTracker presence) { _db = db; _presence = presence; }

        public override async Task OnConnectedAsync()
        {
            var uid = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
            if (Guid.TryParse(uid, out var userId))
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"u:{userId}");
                _presence.Connect(userId);
            }
            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? ex)
        {
            var uid = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);
            if (Guid.TryParse(uid, out var userId))
            {
                await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"u:{userId}");
                _presence.Disconnect(userId);
            }
            await base.OnDisconnectedAsync(ex);
        }

        public async Task SendEnvelope(EnvelopeSendDto dto)
        {
            var senderIdStr = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new HubException("unauthorized");
            var senderId = Guid.Parse(senderIdStr);

            var to = await _db.Users.FirstOrDefaultAsync(u => u.UserName == dto.ToUserName);
            if (to is null) throw new HubException("user_not_found");

            var thread = await FindOrCreateDirectThread(senderId, to.Id, dto.ThreadKeyId);

            var msg = new DirectMessage
            {
                ThreadId = thread.Id,
                SenderId = senderId,
                KeyId = dto.KeyId,
                NonceB64 = dto.NonceB64,
                MacB64 = dto.MacB64,
                CiphertextB64 = dto.CiphertextB64,
                BodyHashHex = dto.BodyHashHex,
                SentAt = DateTime.UtcNow
            };
            _db.DirectMessages.Add(msg);
            await _db.SaveChangesAsync();

            var payload = new
            {
                type = "chat:message",
                threadId = thread.Id,
                fromUserId = senderId,
                toUserId = to.Id,
                envelope = new { msg.Id, msg.KeyId, msg.NonceB64, msg.MacB64, msg.CiphertextB64, msg.BodyHashHex, msg.SentAt }
            };

            await Clients.Group($"u:{to.Id}").SendAsync("chat:update", payload);
            await Clients.Group($"u:{senderId}").SendAsync("chat:update", payload);
        }

        private async Task<DirectThread> FindOrCreateDirectThread(Guid a, Guid b, string? suggestedKeyId)
        {
            var t = await _db.DirectThreads
                .Include(x => x.Members)
                .Where(x => x.Members.Count == 2 &&
                            x.Members.Any(m => m.UserId == a) &&
                            x.Members.Any(m => m.UserId == b))
                .FirstOrDefaultAsync();

            if (t != null) return t;

            t = new DirectThread { ThreadKeyId = suggestedKeyId };
            _db.DirectThreads.Add(t);
            _db.DirectThreadMembers.Add(new DirectThreadMember { Thread = t, UserId = a });
            _db.DirectThreadMembers.Add(new DirectThreadMember { Thread = t, UserId = b });
            await _db.SaveChangesAsync();
            return t;
        }

        public sealed record EnvelopeSendDto(
            string ToUserName,
            string? ThreadKeyId,
            string? KeyId,
            string? NonceB64,
            string? MacB64,
            string CiphertextB64,
            string BodyHashHex
        );
    }
}
