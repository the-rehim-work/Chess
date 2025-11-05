import { useEffect, useState } from 'react';
import { connectHub } from '../api/server';

type WaitingRoomProps = {
  gameId: string;
  gameCode: string;
  userColor: 'w' | 'b';
  onGameStart: () => void;
};

export default function WaitingRoom({ gameId, gameCode, userColor, onGameStart }: WaitingRoomProps) {
  const [opponentJoined, setOpponentJoined] = useState(false);

  useEffect(() => {
    const hub = connectHub(gameId, (payload: any) => {
      if (payload.type === 'join') {
        setOpponentJoined(true);
        setTimeout(onGameStart, 800);
      }
    });
    return () => { hub?.stop?.(); };
  }, [gameId, onGameStart]);

  const shareUrl = `${window.location.origin}?code=${gameCode}`;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <h1 className="text-3xl font-bold">Waiting for Opponent</h1>

        <div className="bg-slate-800 p-6 rounded-xl space-y-4">
          <div>
            <p className="text-lg">Game Code:</p>
            <p className="text-2xl font-mono font-bold text-blue-400">{gameCode}</p>
          </div>

          <div>
            <p className="text-sm text-slate-400 mb-2">Share this link:</p>
            <input
              type="text"
              value={shareUrl}
              readOnly
              className="w-full bg-slate-700 px-3 py-2 rounded text-sm font-mono"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
          </div>

          <div className="text-sm">
            <p>You are playing as <span className="font-semibold">{userColor === 'w' ? 'White' : 'Black'}</span></p>
          </div>

          {opponentJoined ? (
            <div className="text-green-400 font-semibold">Opponent joined! Starting…</div>
          ) : (
            <div className="text-yellow-400">Waiting for another player to join…</div>
          )}
        </div>
      </div>
    </div>
  );
}
