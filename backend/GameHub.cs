using Microsoft.AspNetCore.SignalR;

namespace backend
{
    public sealed class GameHub : Hub
    {
        // Called by client after connecting to associate with game room
        public async Task JoinGame(string gameId)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, gameId);
        }

        // Optional leave (called on disconnect automatically, but explicit is fine)
        public async Task LeaveGame(string gameId)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, gameId);
        }

        // Server -> clients: push updates when move/resign/undo happens
        public async Task BroadcastGame(string gameId, object payload)
        {
            await Clients.Group(gameId).SendAsync("game:update", payload);
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            // optional: track connected users per game if needed
            await base.OnDisconnectedAsync(exception);
        }
    }
}
