using System.Collections.Concurrent;

namespace backend.Services
{
    public sealed class PresenceTracker
    {
        private readonly ConcurrentDictionary<Guid, int> _connections = new();

        public void Connect(Guid userId)
        {
            _connections.AddOrUpdate(userId, 1, (_, c) => c + 1);
        }

        public void Disconnect(Guid userId)
        {
            if (_connections.TryGetValue(userId, out var c))
            {
                if (c <= 1) _connections.TryRemove(userId, out _);
                else _connections.TryUpdate(userId, c - 1, c);
            }
        }

        public int Count => _connections.Count;
    }
}
