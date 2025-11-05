import { useEffect, useState } from 'react';
import { getUserGames } from '../api/server';
import { useAuth } from '../auth/AuthContext';

type Game = {
  id: string; code: string; fen: string;
  participants: { userId: string; color: 'w' | 'b' }[];
  createdAt: string;
};

export default function GameSelector({ onSelectGame }: { onSelectGame: (gameId: string, color: 'w' | 'b') => void }) {
  const { logout } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  async function createNewGame() {
    try {
      const { createGame, joinGame } = await import('../api/server');
      const newGame = await createGame();
      await joinGame(newGame.id || newGame.Id, 'w');
      onSelectGame(newGame.id || newGame.Id, 'w');
    } catch (e: any) {
      if (e?.status === 401) logout();
      console.error('Failed to create new game:', e);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const userGames = await getUserGames();
        setGames(userGames);
      } catch (e: any) {
        if (e?.status === 401) logout();
        console.error('Failed to fetch games:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [logout]);

  if (loading) return <div className="text-center py-8">Loading games...</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Select a Game</h2>
      <div className="text-center py-4 text-yellow-400 font-semibold">
        Games waiting for another user. Create a new game.
      </div>
      <div className="text-center">
        <button
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
          onClick={createNewGame}
        >
          Create New Game
        </button>
      </div>
      {games.length === 0 ? (
        <div className="text-center py-8 text-slate-400">No games available. Create a new one!</div>
      ) : (
        <div className="space-y-2">
          {games.map((game) => {
            const whiteTaken = game.participants.some(p => p.color === 'w');
            const blackTaken = game.participants.some(p => p.color === 'b');
            return (
              <div key={game.id} className="bg-slate-800 p-4 rounded-xl">
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold">Game {game.code}</span>
                  <span className="text-xs text-slate-400">{new Date(game.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex gap-2">
                  {!whiteTaken && (
                    <button
                      className="px-4 py-2 bg-white text-black rounded-lg font-semibold"
                      onClick={() => onSelectGame(game.id, 'w')}
                    >
                      Play as White
                    </button>
                  )}
                  {!blackTaken && (
                    <button
                      className="px-4 py-2 bg-black text-white rounded-lg font-semibold"
                      onClick={() => onSelectGame(game.id, 'b')}
                    >
                      Play as Black
                    </button>
                  )}
                  {whiteTaken && blackTaken && (
                    <span className="text-slate-400">Game full</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
