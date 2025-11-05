/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-empty */
import { useEffect, useMemo, useState } from 'react';
import Board from './components/Board';
import MoveList from './components/MoveList';
import Controls from './components/Controls';
import PromotionModal from './components/PromotionModal';
import AuthPanel from './components/AuthPanel';
import Lobby from './components/Lobby';
import WaitingRoom from './components/WaitingRoom';
import { useAuth } from './auth/AuthContext';
import { useGameUrl } from './hooks/useGameUrl';
import {
  initialFEN, parseFEN, boardToFEN, getLegalMoves, makeMove,
  inCheck, detectOutcome, timeForfeitOutcome, positionKey
} from './chess/logic';
import {
  connectHub, createGame, getGame, getGameByCode, joinGame,
  postMove as apiPostMove, resign as apiResign, undo as apiUndo
} from './api/server';

export type MoveRecord = {
  from: number; to: number;
  piece?: any; captured?: any | null; san?: string;
  flags?: string; promotion?: string | null;
  fen: string; outcome?: string | null; reason?: string | null; index?: number;
};

type GameSummary = { id: string; code: string; status: 'waiting'|'active'|'finished'; fen: string };
type UserInfo = { id: string; userName: string; email: string; displayName: string };

export default function App() {
  const { user, loading } = useAuth();
  const { code: codeInUrl, setCode, clearCode } = useGameUrl();

  // ---- state ----
  const [gameId, setGameId] = useState<string | null>(null);
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [userColor, setUserColor] = useState<'w' | 'b' | null>(null);
  const [gameStatus, setGameStatus] = useState<'waiting' | 'active' | 'finished' | null>(null);

  const [board, setBoard] = useState<any[]>([]);
  const [state, setState] = useState<any | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [legalForSelected, setLegalForSelected] = useState<any[]>([]);
  const [moves, setMoves] = useState<MoveRecord[]>([]);
  const [showPromo, setShowPromo] = useState<{ from: number; to: number; color: 'w' | 'b' } | null>(null);
  const [opponentPresent, setOpponentPresent] = useState<boolean>(false);
  const [rep, setRep] = useState<Record<string, number>>({});
  const [hub, setHub] = useState<any>(null);

  const TIME = { initialMs: 5 * 60_000, incrementMs: 3_000 };
  const [wTime, setWTime] = useState<number>(TIME.initialMs);
  const [bTime, setBTime] = useState<number>(TIME.initialMs);
  const [running, setRunning] = useState<boolean>(true);

  // ────────────────────────────────────────────────────────────────────────────
  // Bootstrap on mount/user change
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (!user) {
        // not logged in → you’re in auth → no code in URL
        clearCode();
        return;
      }

      let g: any = null;

      // If URL has ?code, try fetch by code. If not, do nothing here; Lobby handles creation.
      if (codeInUrl) {
        try { g = await getGameByCode(codeInUrl); } catch {}
        if (g) {
          setGameId((g.id ?? g.Id)?.toString());
          setGameCode((g.code ?? g.Code)?.toString());
          setGameStatus(((g.status ?? g.Status) as any) || 'waiting');

          const fen = (g.fen ?? g.Fen) || initialFEN;
          const { board: b, state: s } = parseFEN(fen);
          setBoard(b); setState(s);
          setMoves([]);

          try {
            const full = await getGame((g.id ?? g.Id)?.toString());
            setOpponentPresent((full.participants || []).length >= 2);

            if (full.history?.length) {
              const reconstructed: MoveRecord[] = full.history.map((m: any, idx: number) => ({
                from: m.from, to: m.to, flags: m.flags, promotion: m.promotion,
                fen: m.fenAfter, outcome: m.outcome, reason: m.reason, index: idx
              }));
              setMoves(reconstructed);

              const newRep: Record<string, number> = {};
              for (const mv of reconstructed) {
                const p = parseFEN(mv.fen);
                const key = positionKey(p.board, p.state);
                newRep[key] = (newRep[key] || 0) + 1;
              }
              setRep(newRep);
            }
          } catch {}
        } else {
          // bad code → purge it
          clearCode();
        }
      } else {
        // No code in URL → neutral. Lobby will drive creation once color is picked.
      }
    })();
  }, [user, codeInUrl, clearCode]);

  // ────────────────────────────────────────────────────────────────────────────
  // Hub attach only when active
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId || gameStatus !== 'active') return;
    const c = connectHub(gameId, (payload: any) => {
      const fenNext = payload?.fen || payload?.Fen || payload?.move?.fen;
      if (fenNext) {
        const parsed = parseFEN(fenNext);
        setBoard(parsed.board);
        setState(parsed.state);
      }

      if (payload.type === 'move') {
        const parsed = parseFEN(payload.move.fen);
        const key = positionKey(parsed.board, parsed.state);
        setRep((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));

        setMoves((prev) => [...prev, {
          from: payload.move.from,
          to: payload.move.to,
          flags: payload.move.flags,
          promotion: payload.move.promotion,
          fen: payload.move.fen,
          outcome: payload.move.outcome,
          reason: payload.move.reason,
          index: payload.move.index
        }]);
      } else if (payload.type === 'undo') {
        setMoves((p) => p.slice(0, -1));
      } else if (payload.type === 'resign') {
        setGameStatus('finished');
      } else if (payload.type === 'join') {
        setOpponentPresent(true);
      }
    });

    setHub(c);
    return () => { c?.stop?.(); };
  }, [gameId, gameStatus]);

  // ────────────────────────────────────────────────────────────────────────────
  // Clocks
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!state || !running || !opponentPresent) return;
    const t = setInterval(() => {
      if (state.turn === 'w') setWTime((x) => Math.max(0, x - 200));
      else setBTime((x) => Math.max(0, x - 200));
    }, 200);
    return () => clearInterval(t);
  }, [state, running, opponentPresent]);

  useEffect(() => {
    if (!state) return;
    if (wTime === 0 && state.turn === 'w') { timeForfeitOutcome(board, 'w'); setRunning(false); }
    if (bTime === 0 && state.turn === 'b') { timeForfeitOutcome(board, 'b'); setRunning(false); }
  }, [wTime, bTime, state, board]);

  // ────────────────────────────────────────────────────────────────────────────
  // Legal set for selected square (user’s own side only)
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (selected == null || !state || !userColor) { setLegalForSelected([]); return; }
    if (state.turn !== userColor) { setLegalForSelected([]); return; }

    const piece = board[selected];
    if (!piece || piece.color !== userColor) { setLegalForSelected([]); return; }

    setLegalForSelected(getLegalMoves(board, state, selected));
  }, [selected, board, state, userColor]);

  // ────────────────────────────────────────────────────────────────────────────
  // URL Discipline (single source of truth)
  // Add ?code= only while in game; clear it when in lobby/auth/finished/exit.
  // ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // not logged in → never show code
    if (!user) { clearCode(); return; }

    // no color chosen → you’re in Lobby → clear
    if (!userColor) { clearCode(); return; }

    // game not active yet but you own a pending game → keep code so opponent can join
    if (gameStatus === 'waiting' && gameCode) { setCode(gameCode); return; }

    // active → keep code
    if (gameStatus === 'active' && gameCode) { setCode(gameCode); return; }

    // finished or unknown → clear
    if (gameStatus === 'finished' || !gameStatus) { clearCode(); return; }
  }, [user, userColor, gameStatus, gameCode, setCode, clearCode]);

  // ────────────────────────────────────────────────────────────────────────────
  // Status banner
  // ────────────────────────────────────────────────────────────────────────────
  const statusText = useMemo(() => {
    if (!state) return '';
    if (gameStatus === 'finished') {
      const { outcome, reason } = detectOutcome(board, state, rep);
      if (outcome) return `${String(outcome).toUpperCase()} by ${reason}`;
    }
    if (gameStatus === 'waiting') return 'Waiting for opponent to join...';
    if (gameStatus === 'active') {
      const side = state.turn === 'w' ? 'White' : 'Black';
      const check = inCheck(board, state, state.turn) ? ' — CHECK' : '';
      return `${side} to move${check}`;
    }
    return '';
  }, [board, state, rep, gameStatus]);

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────
  function bumpRepetition(nextBoard: any[], nextState: any) {
    const key = positionKey(nextBoard, nextState);
    setRep((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
  }

  function onSquareClick(idx: number) {
    if (gameStatus !== 'active' || !state) return;

    // hard gate: must be your turn
    if (!userColor || state.turn !== userColor) return;

    const piece = board[idx];

    if (selected == null) {
      if (piece && piece.color === userColor) setSelected(idx);
      return;
    }

    if (piece && piece.color === userColor && idx !== selected) {
      setSelected(idx);
      return;
    }

    const target = legalForSelected.find((m: any) => m.to === idx);
    if (!target) { setSelected(null); setLegalForSelected([]); return; }

    if (target.flags?.includes('promo')) {
      setShowPromo({ from: target.from, to: target.to, color: state.turn });
      return;
    }
    commitMove(target, null);
  }

  async function postMoveToServer(moveRecord: MoveRecord) {
    if (!gameId) return;
    try {
      await apiPostMove(gameId, {
        from: moveRecord.from, to: moveRecord.to,
        flags: moveRecord.flags ?? null, promotion: moveRecord.promotion ?? null,
        fen: moveRecord.fen, outcome: moveRecord.outcome ?? null, reason: moveRecord.reason ?? null
      });
    } catch {}
  }

  function commitMove(m: any, promotionChoice: string | null) {
    if (!state) return;

    if (state.turn === 'w') setWTime((t) => t + TIME.incrementMs);
    else setBTime((t) => t + TIME.incrementMs);

    const applied = makeMove(board, state, { ...m, promotion: promotionChoice });
    const nextFen = boardToFEN(applied.board, applied.state);
    const { outcome, reason } = detectOutcome(applied.board, applied.state, rep);

    const moveRecord: MoveRecord = {
      from: m.from, to: m.to, piece: board[m.from], captured: m.captured || null,
      san: m.san || '', flags: m.flags || '', promotion: promotionChoice || null,
      fen: nextFen, outcome: outcome || null, reason: reason || null,
    };

    setBoard(applied.board);
    setState(applied.state);
    setMoves((prev) => [...prev, moveRecord]);
    bumpRepetition(applied.board, applied.state);
    setSelected(null);
    setShowPromo(null);
    postMoveToServer(moveRecord);
  }

  function onPromotionSelect(pieceCode: string) {
    if (!showPromo || !state) return;
    const legal = getLegalMoves(board, state, showPromo.from);
    const target = legal.find((m: any) => m.to === showPromo.to);
    if (!target) { setShowPromo(null); return; }
    commitMove(target, pieceCode);
  }

  async function onNewGame() {
    // If you’re in Lobby, URL is clear; when the game is created and you pick color in Lobby,
    // we’ll set the code there. This path is for in-game “New Game” button.
    const g = await createGame();
    const id = (g.id ?? g.Id)?.toString();
    const codeStr = (g.code ?? g.Code)?.toString();
    const status = (g.status ?? g.Status)?.toString() as 'waiting' | 'active' | 'finished';
    setGameId(id);
    setGameCode(codeStr);
    setGameStatus(status);

    const fen = (g.fen ?? g.Fen) || initialFEN;
    const parsed = parseFEN(fen);
    setBoard(parsed.board);
    setState(parsed.state);
    setMoves([]);
    setOpponentPresent(false);

    try { await joinGame(id, 'w'); } catch {}
    // in waiting: reflect code in URL
    setCode(codeStr || '');
  }

  async function onUndo() {
    if (!gameId) return;
    try { await apiUndo(gameId); } catch {}
    setMoves((prev) => prev.slice(0, -1));
  }

  async function onResign(color: 'w' | 'b') {
    if (!gameId) return;
    try { await apiResign(gameId, color); } catch {}
    setGameStatus('finished');
    // finishing clears URL (handled by URL discipline effect)
  }

  function onDeleteGame(_: string) {
    // When you wire real delete → also clear state and URL:
    setGameId(null);
    setGameCode(null);
    setGameStatus(null);
    setBoard([]); setState(null);
    setMoves([]); setSelected(null);
    clearCode();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Renders
  // ────────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <AuthPanel />
        </div>
      </div>
    );
  }

  if (!userColor) {
    // LOBBY: URL must be clean.
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 p-4">
        <div className="max-w-2xl mx-auto">
          <Lobby onGameStart={(gid, color) => {
            setUserColor(color);
            setGameId(gid);
            setGameStatus('waiting');
            (async () => {
              try {
                const g = await getGame(gid);
                const fen = (g.fen ?? g.Fen) || initialFEN;
                const { board: b, state: s } = parseFEN(fen);
                const status = (g.status ?? g.Status)?.toString() as 'waiting' | 'active' | 'finished';
                setBoard(b); setState(s);
                setOpponentPresent((g.participants || []).length >= 2);
                setGameStatus(status);
                const codeStr = (g.code ?? g.Code)?.toString();
                setGameCode(codeStr);
                // entering waiting/active → set URL code
                setCode(codeStr || '');
              } catch (e) { console.error('Failed to load game after creation:', e); }
            })();
          }} />
        </div>
      </div>
    );
  }

  if (gameStatus === 'waiting') {
    return (
      <WaitingRoom
        gameId={gameId!}
        gameCode={gameCode!}
        userColor={userColor}
        onGameStart={() => setGameStatus('active')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4">
      <div className="max-w-6xl mx-auto space-y-3">
        <AuthPanel />
        <div className="grid md:grid-cols-[minmax(0,520px)_1fr] gap-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-xl font-bold">React Chess (Server)</h1>
              <span className="text-xs opacity-70">Game Code: {gameCode}</span>
            </div>
            <div className="rounded-2xl p-3 bg-slate-800 shadow">
              <Board
                board={board}
                selected={selected}
                legalTargets={legalForSelected}
                onSquareClick={onSquareClick}
                flip={userColor === 'b'}
              />
            </div>
            <div className="mt-3 text-sm text-slate-300">{statusText}</div>
            <Controls
              games={[]}
              activeGame={gameId ? { id: gameId } : null}
              onNewGame={onNewGame}
              onUndo={onUndo}
              onResign={onResign}
              onLoadGame={() => {}}
              onDeleteGame={onDeleteGame}
            />
            {!opponentPresent && gameStatus === 'active' && (
              <div className="mt-2 text-sm text-yellow-400">Waiting for opponent to join...</div>
            )}
          </div>
          <div><MoveList moves={moves} /></div>
        </div>
      </div>
      {showPromo && (
        <PromotionModal
          color={showPromo.color}
          onSelect={onPromotionSelect}
          onCancel={() => setShowPromo(null)}
        />
      )}
    </div>
  );
}
