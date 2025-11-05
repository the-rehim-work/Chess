/* eslint-disable no-empty */
import { useEffect, useState } from 'react';
import { getWaitingGames, createGame, joinGame } from '../api/server';
import { useAuth } from '../auth/AuthContext';

type WaitingGame = {
  id: string;
  code: string;
  createdAt: string;
  status: string;
  fen?: string;
  outcome?: string;
  reason?: string;
  participants: { displayName: string; color: 'w' | 'b' }[];
};

export default function Lobby({ onGameStart }: { onGameStart: (gameId: string, color: 'w' | 'b') => void }) {
  const { user, logout } = useAuth();
  const [waitingGames, setWaitingGames] = useState<WaitingGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let stop = false;
    const tick = async () => {
      try {
        const games = await getWaitingGames();
        if (!stop) { setWaitingGames(games); setLoading(false); }
      } catch (e: any) {
        if (e?.status === 401) { logout(); return; }
        console.error('Failed to fetch waiting games:', e);
        if (!stop) setLoading(false);
      }
    };
    tick();
    const h = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(h); };
  }, [user, logout]);

  async function handleCreateGame() {
    setCreating(true);
    try {
      const newGame = await createGame();
      const gameId = newGame.id || newGame.Id;
      await joinGame(gameId, 'w');
      onGameStart(gameId, 'w');
    } catch (e: any) {
      if (e?.status === 401) logout();
      console.error('Failed to create game:', e);
      setCreating(false);
    }
  }

  async function handleJoinGame(gameId: string, color: 'w' | 'b') {
    try {
      await joinGame(gameId, color);
      onGameStart(gameId, color);
    } catch (e: any) {
      if (e?.status === 401) logout();
      console.error('Failed to join game:', e);
      try { const games = await getWaitingGames(); setWaitingGames(games); } catch {}
    }
  }

  if (loading) return <div className="text-center py-8">Loading lobby...</div>;

  const getTurnFromFen = (fen: string): 'w' | 'b' => (fen.split(' ')[1] === 'w' ? 'w' : 'b');

  const isUserTurn = (game: WaitingGame): boolean => {
    if (!user || game.status !== 'active' || !game.fen) return false;
    const turn = getTurnFromFen(game.fen);
    const me = game.participants.find(p => p.displayName === user.displayName);
    return me?.color === turn;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Chess Lobby</h2>
        <button className="px-3 py-1 bg-slate-700 rounded" onClick={logout}>Logout</button>
      </div>

      <div className="text-center">
        <button
          className="px-8 py-4 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50"
          onClick={handleCreateGame}
          disabled={creating}
        >
          {creating ? 'Creating Game...' : 'Create New Game'}
        </button>
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-semibold">Available Games</h3>
        {waitingGames.length === 0 ? (
          <div className="text-center py-8 text-slate-400">No games available</div>
        ) : (
          <div className="space-y-3">
            {waitingGames.map((game) => {
              const whiteTaken = game.participants.some(p => p.color === 'w');
              const blackTaken = game.participants.some(p => p.color === 'b');
              const me = user ? game.participants.find(p => p.displayName === user.displayName) : undefined;
              const isOngoing = game.status === 'active';
              const isFinished = game.status === 'finished';
              const userTurn = isUserTurn(game);

              // **Block double-join**: if I'm already in this game, I can only rejoin with my existing color
              const canJoinWhite = !isOngoing && !isFinished && !whiteTaken && (!me || me.color === 'w');
              const canJoinBlack = !isOngoing && !isFinished && !blackTaken && (!me || me.color === 'b');

              return (
                <div key={game.id} className="bg-slate-800 p-4 rounded-xl">
                  <div className="flex justify-between items-center mb-3">
                    <span className="font-semibold">
                      Game {game.code}
                      {isOngoing && (
                        <span className="ml-2 text-sm text-yellow-400">
                          (Ongoing - {userTurn ? 'Your turn!' : "Opponent's turn"})
                        </span>
                      )}
                      {isFinished && (
                        <span className="ml-2 text-sm text-red-400">
                          (Finished - {game.outcome}: {game.reason})
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(game.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mb-2 text-sm text-slate-300">
                    Players: {game.participants.map(p => `${p.displayName} (${p.color === 'w' ? 'White' : 'Black'})`).join(', ')}
                  </div>
                  <div className="flex gap-2">
                    {canJoinWhite && (
                      <button
                        className="px-4 py-2 bg-white text-black rounded-lg font-semibold hover:bg-gray-200"
                        onClick={() => handleJoinGame(game.id, 'w')}
                      >
                        Join as White
                      </button>
                    )}
                    {canJoinBlack && (
                      <button
                        className="px-4 py-2 bg-black text-white rounded-lg font-semibold hover:bg-gray-800"
                        onClick={() => handleJoinGame(game.id, 'b')}
                      >
                        Join as Black
                      </button>
                    )}

                    {isOngoing && me && (
                      <button
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
                        onClick={() => onGameStart(game.id, me.color)}
                      >
                        Rejoin Game
                      </button>
                    )}

                    {isFinished && me && (
                      <button
                        className="px-4 py-2 bg-gray-600 text-white rounded-lg font-semibold hover:bg-gray-700"
                        onClick={() => onGameStart(game.id, me.color)}
                      >
                        View Game
                      </button>
                    )}

                    {!isOngoing && !isFinished && whiteTaken && blackTaken && (
                      <span className="text-slate-400">Game full</span>
                    )}

                    {/* If I'm already in, hide the opposite color join button entirely */}
                    {me && !isOngoing && !isFinished && (
                      <span className="text-xs text-slate-400 ml-auto">You joined as {me.color === 'w' ? 'White' : 'Black'}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
