/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  useState,
  useEffect,
  useMemo,
  useRef,
  startTransition,
} from 'react';
import { X } from 'lucide-react';
import ChatDock from './chat/chatDock.tsx';
import { Chess, type Square, Move as ChessMove } from 'chess.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════
interface Piece {
  color: 'w' | 'b';
  type: 'p' | 'r' | 'n' | 'b' | 'q' | 'k';
}

interface GameState {
  turn: 'w' | 'b';
  castling: string;
  ep: number | null;
  halfmove: number;
  fullmove: number;
}

interface Move {
  from: number;
  to: number;
  captured?: Piece;
  flags?: string;
  promotion?: string;
}

interface Game {
  id: string;
  code: string;
  fen: string;
  status: string;
  outcome: string | null;
  reason: string | null;
  participants: Array<{
    displayName: string;
    color: 'w' | 'b';
  }>;
  history: Array<{
    index: number;
    from: number;
    to: number;
    flags?: string;
    promotion?: string;
  }>;
}

interface User {
  id: string;
  userName: string;
  email: string;
  displayName: string;
}

interface ChatThread {
  id: string;
  withUser: string;
  lastMessage?: string;
  unread: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
const API_BASE = 'http://172.22.111.136:7000/api';

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const ROOK_DIR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIR = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
const QUEEN_DIR = [...ROOK_DIR, ...BISHOP_DIR];

// ═══════════════════════════════════════════════════════════════════════════════
// CHESS ENGINE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════
function idx(r: number, f: number) { return r * 8 + f; }
function rank(i: number) { return Math.floor(i / 8); }
function file(i: number) { return i % 8; }
function colorOpp(c: 'w' | 'b'): 'w' | 'b' { return c === 'w' ? 'b' : 'w'; }
function algebraic(i: number) { return 'abcdefgh'[file(i)] + (8 - rank(i)); }

function normalizeGame(row: any): Game {
  return {
    id: row.id,
    code: row.code,
    fen: row.fen,
    status: row.status,
    outcome: row.outcome ?? null,
    reason: row.reason ?? null,
    participants: (row.participants ?? row.Participants ?? []).map((p: any) => ({
      displayName: p.displayName ?? p.DisplayName,
      color: p.color,
    })),
    history: (row.history ?? row.History ?? []).map((m: any) => ({
      index: m.index,
      from: m.from,
      to: m.to,
      flags: m.flags,
      promotion: m.promotion,
    })),
  };
}
// ═══════════════════════════════════════════════════════════════════════════════
// AUTH COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
function Auth({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [mode, setMode] = useState('login');
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const body = mode === 'login'
        ? { userOrEmail: userName, password }
        : { userName, password, displayName: displayName || userName, email: email || undefined };

      const res = await fetch(API_BASE + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Auth failed');
      }

      const data = await res.json();
      if (mode === 'register') {
        setMode('login');
        setError('Registration successful! Please login.');
      } else {
        onLogin(data.token, data.user);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-emerald-900 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-lg shadow-2xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-white mb-6 text-center">♟️ Chess Game</h1>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-2 rounded ${mode === 'login' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'}`}
          >
            Login
          </button>
          <button
            onClick={() => setMode('register')}
            className={`flex-1 py-2 rounded ${mode === 'register' ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'}`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <>
              <input
                type="text"
                placeholder="Display Name (optional)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
              />
              <input
                type="email"
                placeholder="Email (optional)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
              />
            </>
          )}
          <input
            type="text"
            placeholder={mode === 'login' ? 'Username or Email' : 'Username'}
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
            required
          />
          {error && <p className={`text-sm ${error.includes('successful') ? 'text-green-400' : 'text-red-400'}`}>{error}</p>}
          <button
            type="submit"
            className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-3 rounded transition"
          >
            {mode === 'login' ? 'Login' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Lobby({ token, user, onGameSelect }: { token: string; user: User; onGameSelect: (id: string, spectate?: boolean) => void }) {
  const [games, setGames] = useState<Game[]>([]);
  const [creating, setCreating] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const [statusFilter, setStatusFilter] = useState<'all' | 'waiting' | 'active' | 'finished'>('waiting');
  const [myColorFilter, setMyColorFilter] = useState<'all' | 'w' | 'b' | 'spectating'>('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState('');

  function resetSearch() {
    setSearch('');
    setStatusFilter('all');
    setMyColorFilter('all');
    setOnlyMine(false);
  }

  const loadGames = async () => {
    const params = new URLSearchParams();
    params.set('status', statusFilter);
    if (onlyMine) params.set('onlyMine', 'true');
    if (search.trim()) params.set('q', search.trim());

    const res = await fetch(`${API_BASE}/games?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;

    const rows = await res.json();
    setGames(rows.map((r: any) => normalizeGame(r)));
  };

  useEffect(() => {
    let alive = true;
    const tick = async () => { if (alive) await loadGames(); };
    tick();
    const i = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(i); };
  }, [token, statusFilter, onlyMine, search]);

  const createGame = async () => {
    setCreating(true);
    try {
      const res = await fetch(API_BASE + '/games', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      if (res.ok) {
        const game = await res.json();
        onGameSelect(game.id);
      }
    } finally {
      setCreating(false);
    }
  };

  const joinByCode = async () => {
    if (!joinCode.trim()) return;
    try {
      const res = await fetch(API_BASE + `/games/by-code/${joinCode.trim()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const game = await res.json();
        onGameSelect(game.id);
      }
    } catch (err) {
      console.error('Join failed:', err);
    }
  };

  // ── Helper: detect winner string for finished games
  const winnerOf = (g: Game): string | null => {
    if (!g.outcome) return null;
    // Prefer backend reason if it says "White wins"/"Black wins"
    const reason = (g.reason || '').toLowerCase();
    if (reason.includes('white wins')) return 'White';
    if (reason.includes('black wins')) return 'Black';
    // Fallback: null (draw or unspecified)
    return null;
  };

  // ── Derived: filtered + sorted games (newest first if id is time-ordered; otherwise keep as-is)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return games
      .filter(g => {
        const me = g.participants.find(p => p.displayName === user.displayName);
        const myColor = me?.color;

        // status filter
        if (statusFilter === 'waiting' && g.status !== 'waiting') return false;
        if (statusFilter === 'active' && g.status !== 'active') return false;
        if (statusFilter === 'finished' && !g.outcome) return false;
        if (statusFilter === 'all') {
          // no-op
        }

        // my color filter
        if (myColorFilter === 'w' && myColor !== 'w') return false;
        if (myColorFilter === 'b' && myColor !== 'b') return false;
        if (myColorFilter === 'spectating' && !!myColor) return false;

        // mine-only
        if (onlyMine && !me) return false;

        // search: by code or participant display names
        if (q.length) {
          const codeHit = (g.code || '').toLowerCase().includes(q);
          const namesHit = g.participants.some(p => (p.displayName || '').toLowerCase().includes(q));
          if (!codeHit && !namesHit) return false;
        }

        return true;
      })
      .sort((a, b) => (b.code || '').localeCompare(a.code || '')); // cheap sort by code descending
  }, [games, search, statusFilter, myColorFilter, onlyMine, user.displayName]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-emerald-900 to-slate-900 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Chess Lobby</h1>
            <p className="text-slate-100 text-lg">
              Welcome,
              <span className="ml-2 font-semibold text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.35)]">
                {user.displayName || user.email}
              </span>
            </p>
          </div>
          <button
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded"
          >
            Logout
          </button>
        </div>

        {/* ── NEW: Filters */}
        <div className="bg-slate-800 rounded-lg p-4 mb-4 shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-slate-300 text-xs mb-1">Search</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Code or Player"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
                />
                <button
                  onClick={() => resetSearch()}
                  className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-200"
                  title="Clear"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-slate-300 text-xs mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
              >
                <option value="all">All</option>
                <option value="waiting">Waiting</option>
                <option value="active">Active</option>
                <option value="finished">Finished</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 text-xs mb-1">My Color</label>
              <select
                value={myColorFilter}
                onChange={(e) => setMyColorFilter(e.target.value as any)}
                className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
              >
                <option value="all">All</option>
                <option value="w">White</option>
                <option value="b">Black</option>
                <option value="spectating">Spectating</option>
              </select>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={onlyMine}
                  onChange={(e) => setOnlyMine(e.target.checked)}
                  className="accent-emerald-600"
                />
                Only my games
              </label>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-slate-800 rounded-lg p-6 mb-6 shadow-xl">
          <h2 className="text-xl font-semibold text-white mb-4">Quick Actions</h2>
          <div className="flex flex-col md:flex-row gap-4">
            <button
              onClick={createGame}
              disabled={creating}
              className="flex-1 bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-800 text-white font-semibold py-3 rounded transition"
            >
              {creating ? 'Creating...' : 'Create New Game'}
            </button>
            <div className="flex gap-2 flex-1">
              <input
                type="text"
                placeholder="Game Code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="flex-1 p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
              />
              <button
                onClick={joinByCode}
                className="px-6 bg-green-600 hover:bg-green-700 text-white font-semibold rounded transition"
              >
                Join
              </button>
            </div>
          </div>
        </div>

        {/* Cards */}
        <div className="bg-slate-800 rounded-lg p-6 shadow-xl">
          <h2 className="text-xl font-semibold text-white mb-4">Available Games</h2>

          {filtered.map(g => {
            const me = g.participants.find(p => p.displayName === user.displayName);
            const myColor = me?.color;
            const finished = !!g.outcome;
            const waiting = g.status === 'waiting' || g.participants.length < 2;
            const winner = winnerOf(g);
            const iWon = winner === "White" && myColor === "w" || winner === "Black" && myColor === "b";
            const iLost = finished && myColor && !iWon && winner;

            const subline = finished
              ? (winner ? `Finished • Winner: ${winner}` : 'Finished • Draw')
              : `${g.status} • ${g.participants.length}/2 players`;

            const statusColorClass = finished
              ? 'text-purple-400'
              : waiting
                ? 'text-green-400'
                : 'text-cyan-400';

            const myColorClass = iWon
              ? 'text-green-400'
              : iLost
                ? 'text-red-400'
                : 'text-cyan-400';

            const iAmIn = !!myColor;
            const isFull = g.participants.length >= 2;

            let actionLabel: string;
            let buttonClass: string;

            if (finished) {
              actionLabel = 'View';
              buttonClass = 'bg-purple-600 hover:bg-purple-700';
            } else if (iAmIn) {
              actionLabel = 'Resume';
              buttonClass = waiting ? 'bg-green-600 hover:bg-green-700' : 'bg-cyan-600 hover:bg-cyan-700';
            } else if (isFull) {
              actionLabel = 'Spectate';
              buttonClass = 'bg-slate-600 hover:bg-slate-500';
            } else {
              actionLabel = 'Join';
              buttonClass = 'bg-green-600 hover:bg-green-700';
            }

            return (
              <div
                key={g.id}
                className="bg-slate-700 rounded p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 hover:bg-slate-600 transition mb-4"
              >
                <div>
                  <p className="text-white font-semibold">Game {g.code}</p>
                  <p className={`text-sm ${statusColorClass}`}>
                    {subline}
                    {g.participants.length > 0 && !finished && (
                      <> • {g.participants.map(p => p.displayName).join(', ')}</>
                    )}
                    {finished && g.reason && <>, {g.reason}</>}
                  </p>
                  {myColor && (
                    <p className={`text-xs mt-1 ${myColorClass}`}>
                      You are {myColor === 'w' ? 'White' : 'Black'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (!iAmIn && isFull) {
                        onGameSelect(g.id, true);
                      } else {
                        onGameSelect(g.id);
                      }
                    }}
                    className={`px-4 py-2 text-white rounded transition ${buttonClass}`}
                  >
                    {actionLabel}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ChessGame({ token, user, gameId, onBack, spectatorMode = false }: { token: string; user: User; gameId: string; onBack: () => void, spectatorMode: boolean }) {
  const [chess] = useState(() => new Chess());
  const [board, setBoard] = useState<(Piece | null)[]>([]);
  const [game, setGame] = useState<Game | null>(null);
  const [myColor, setMyColor] = useState<'w' | 'b' | null>(null);
  const [legalMoves, setLegalMoves] = useState<Square[]>([]);
  const [promoting, setPromoting] = useState<{ from: Square; to: Square } | null>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [lastMove, setLastMove] = useState<{ from: number; to: number } | null>(null);

  const isSpectating = useMemo(() => {
    if (!game) return false;
    if (spectatorMode) return true;
    if (game.status === 'waiting') return false;
    const isParticipant = game.participants.some(p => p.displayName === user.displayName);
    return !isParticipant;
  }, [game, user.displayName, spectatorMode]);

  const chessBoardToArray = (chessInstance: Chess): (Piece | null)[] => {
    const result: (Piece | null)[] = [];
    const boardArray = chessInstance.board();

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const square = boardArray[rank][file];
        if (square) {
          result.push({
            color: square.color,
            type: square.type
          });
        } else {
          result.push(null);
        }
      }
    }
    return result;
  };

  const indexToAlgebraic = (i: number): Square => {
    const rank = Math.floor(i / 8);
    const file = i % 8;
    return ('abcdefgh'[file] + (8 - rank)) as Square; // Add 'as Square' cast
  };

  const lastAppliedRef = useRef<number>(0);

  const isFlipped = myColor === 'b';

  useEffect(() => {
    const colors: Array<'w' | 'b'> = ['w', 'b'];
    const types: Piece['type'][] = ['p', 'r', 'n', 'b', 'q', 'k'];
    const typeNames: Record<Piece['type'], string> = { p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king' };
    const imgs: HTMLImageElement[] = [];
    for (const c of colors) for (const t of types) {
      const img = new Image();
      img.src = `/icons/${typeNames[t]}_${c}.svg`;
      imgs.push(img);
    }
    return () => { imgs.splice(0, imgs.length); };
  }, []);

  const getPieceImage = (piece: Piece) => {
    const typeNames: Record<Piece['type'], string> = {
      p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king'
    };
    const color = piece.color === 'w' ? 'w' : 'b';
    return `/icons/${typeNames[piece.type]}_${color}.svg`;
  };

  const algebraicToIndex = (sq: string): number => {
    const file = 'abcdefgh'.indexOf(sq[0]);
    const rank = 8 - parseInt(sq[1]);
    return rank * 8 + file;
  };

  const loadGameFull = async () => {
    const res = await fetch(`${API_BASE}/games/${gameId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const g: Game = await res.json();
    setGame(g);

    if (g.history && g.history.length > 0) {
      const last = g.history[g.history.length - 1];
      setLastMove({ from: last.from, to: last.to });
    } else {
      setLastMove(null);
    }

    chess.load(g.fen);
    setBoard(chessBoardToArray(chess));

    lastAppliedRef.current = g.history?.length ?? 0;
  };

  useEffect(() => {
    lastAppliedRef.current = 0;
    setSelected(null);
    setLegalMoves([]);
    loadGameFull();
  }, [gameId]);

  useEffect(() => {
    if (!game) return;
    const me = game.participants.find((p: { displayName: string }) => p.displayName === user.displayName);
    if (me) setMyColor(me.color as 'w' | 'b');
    else setMyColor(null);
  }, [game, user.displayName]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/games/${gameId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const g: Game = await res.json();
        if (!alive) return;

        const currentLen = lastAppliedRef.current;
        const newLen = g.history?.length ?? 0;

        if (newLen !== currentLen || !board.length) {
          chess.load(g.fen);
          startTransition(() => {
            setBoard(chessBoardToArray(chess));
          });
          lastAppliedRef.current = newLen;
        }

        setGame(g);
      } catch { /* network hiccup ignored */ }
    };

    const i = setInterval(tick, 1200);
    tick();
    return () => { alive = false; clearInterval(i); };
  }, [gameId, token]);

  const joinGame = async (color: string) => {
    const res = await fetch(`${API_BASE}/games/${gameId}/join?color=${color}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;

    const data = await res.json();
    if (data.role && data.role !== 'spectator') setMyColor(data.role);
    await loadGameFull();
  };

  const handleSquareClick = (i: number) => {
    if (isSpectating || !myColor) return;
    if (!chess || game?.status !== 'active') return;
    if (chess.turn() !== myColor) return;

    const square = indexToAlgebraic(i);

    if (selected === null) {
      const piece = chess.get(square);
      if (piece && piece.color === myColor) {
        setSelected(square);
        const moves = chess.moves({ square: square, verbose: true }) as ChessMove[];
        setLegalMoves(moves.map(m => m.to));
      }
    } else {
      if (legalMoves.includes(square)) {
        const moves = chess.moves({ square: selected, verbose: true }) as ChessMove[];
        const move = moves.find(m => m.to === square);

        if (move && move.promotion) {
          setPromoting({ from: selected, to: square });
        } else {
          executeMove(selected, square);
        }
      }
      setSelected(null);
      setLegalMoves([]);
    }
  };

  const executeMove = async (from: Square, to: Square, promotion?: string) => {
    try {
      const moveObj: any = { from, to };
      if (promotion) moveObj.promotion = promotion;

      const result = chess.move(moveObj);
      if (!result) throw new Error('Invalid move');

      const newFen = chess.fen();
      const isCheckmate = chess.isCheckmate();
      const isDraw = chess.isDraw();
      const isStalemate = chess.isStalemate();

      let outcome = null;
      let reason = null;

      if (isCheckmate) {
        outcome = 'checkmate';
        reason = chess.turn() === 'w' ? 'Black wins' : 'White wins';
      } else if (isStalemate) {
        outcome = 'draw';
        reason = 'stalemate';
      } else if (isDraw) {
        outcome = 'draw';
        reason = 'draw';
      }

      startTransition(() => {
        setBoard(chessBoardToArray(chess));
      });
      lastAppliedRef.current += 1;
      setLastMove({ from: algebraicToIndex(from), to: algebraicToIndex(to) });

      const fromIdx = algebraicToIndex(from);
      const toIdx = algebraicToIndex(to);

      const res = await fetch(`${API_BASE}/games/${gameId}/move`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromIdx,
          to: toIdx,
          flags: result.flags,
          promotion: promotion || null,
          fen: newFen,
          outcome,
          reason
        })
      });

      if (!res.ok) throw new Error('Move rejected');
    } catch (err) {
      await loadGameFull();
    }
  };

  const handlePromotion = (type: string) => {
    if (!promoting) return;
    executeMove(promoting.from, promoting.to, type);
    setPromoting(null);
  };

  const resign = async () => {
    if (!myColor) return;
    const res = await fetch(`${API_BASE}/games/${gameId}/resign?color=${myColor}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) loadGameFull();
  };

  const whiteInCheck = useMemo(() => {
    if (!chess) return false;
    const currentTurn = chess.turn();
    return currentTurn === 'w' && chess.inCheck();
  }, [chess, board]);

  const blackInCheck = useMemo(() => {
    if (!chess) return false;
    const currentTurn = chess.turn();
    return currentTurn === 'b' && chess.inCheck();
  }, [chess, board]);

  if (!game) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-emerald-900 to-slate-900 flex items-center justify-center">
        <p className="text-white text-2xl">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-emerald-900 to-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <button
            onClick={onBack}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded"
          >
            ← Back to Lobby
          </button>
          <div className="bg-slate-800 rounded-lg px-6 py-3 text-center">
            <h2 className="text-2xl font-bold text-white">Game {game.code}</h2>
            {(() => {
              const finished = !!game.outcome;
              const waiting = game.status === 'waiting' || game.participants.length < 2;
              const statusClass = finished ? 'text-purple-400' : waiting ? 'text-green-400' : 'text-cyan-400';
              return <p className={`text-sm ${statusClass}`}>Status: {game.status}</p>;
            })()}
          </div>
          <div className="w-[88px]">
            {game.status === 'active' && myColor && !isSpectating && (
              <button
                onClick={resign}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded"
              >
                Resign
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {game.status === 'waiting' && !myColor && !isSpectating && (
              <div className="bg-slate-800 rounded-lg p-6 mb-4">
                <h3 className="text-white text-xl font-semibold mb-4">Choose Your Color</h3>
                <div className="flex gap-4">
                  {!game.participants.some((p: { color: string }) => p.color === 'w') && (
                    <button
                      onClick={() => joinGame('w')}
                      className="flex-1 bg-white hover:bg-gray-200 text-black font-semibold py-3 rounded transition"
                    >
                      Play as White
                    </button>
                  )}
                  {isSpectating && (
                    <div className="bg-slate-700 rounded-lg p-4 mb-4 text-center">
                      <p className="text-slate-300">👁️ Spectator Mode</p>
                      <p className="text-xs text-slate-400 mt-1">Watching the game</p>
                    </div>
                  )}
                  {!game.participants.some((p: { color: string }) => p.color === 'b') && (
                    <button
                      onClick={() => joinGame('b')}
                      className="flex-1 bg-slate-900 hover:bg-black text-white font-semibold py-3 rounded transition"
                    >
                      Play as Black
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="bg-slate-800 rounded-lg p-6 inline-block">
              <div className="relative">
                <div className={`grid grid-cols-8 gap-0 border-4 border-slate-600 ${isFlipped ? 'rotate-180' : ''}`}>
                  {board.map((piece, i) => {
                    const square = indexToAlgebraic(i);
                    const r = Math.floor(i / 8);
                    const f = i % 8;
                    const isLight = (r + f) % 2 === 0;
                    const isSelected = selected === square;
                    const isLegalMove = legalMoves.includes(square);
                    const isCheck = piece && piece.type === 'k' &&
                      ((piece.color === 'w' && whiteInCheck) ||
                        (piece.color === 'b' && blackInCheck));
                    return (
                      <div
                        key={i}
                        onClick={() => handleSquareClick(i)}
                        className={`w-16 h-16 flex items-center justify-center cursor-pointer relative
              ${isLight ? 'bg-amber-100' : 'bg-amber-800'}
              ${isSelected ? 'ring-4 ring-yellow-400' : ''}
              ${isCheck ? 'bg-red-500' : ''}
              hover:opacity-80 transition`}
                      >
                        {piece && (
                          <img
                            src={getPieceImage(piece)}
                            alt={`${piece.color} ${piece.type}`}
                            className={`w-12 h-12 ${isFlipped ? 'rotate-180' : ''}`}
                          />
                        )}
                        {isLegalMove && (
                          <div
                            className={`absolute w-4 h-4 rounded-full ${isFlipped ? 'rotate-180' : ''} ${piece ? 'border-4 border-green-500' : 'bg-green-500 opacity-50'}`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {lastMove && (() => {
                  const fromX = file(lastMove.from) * 64 + 32 + 4;
                  const fromY = rank(lastMove.from) * 64 + 32 + 4;
                  const toX = file(lastMove.to) * 64 + 32 + 4;
                  const toY = rank(lastMove.to) * 64 + 32 + 4;

                  const dx = toX - fromX;
                  const dy = toY - fromY;
                  const distance = Math.sqrt(dx * dx + dy * dy);

                  const minMarker = 4;
                  const maxMarker = 12;
                  const markerSize = Math.min(maxMarker, Math.max(minMarker, distance / 15));

                  return (
                    <svg
                      className={`absolute inset-0 pointer-events-none ${isFlipped ? 'rotate-180' : ''}`}
                      viewBox="0 0 520 520"
                      style={{ width: '100%', height: '100%' }}
                    >
                      <defs>
                        <marker
                          id="arrowhead"
                          markerWidth={markerSize}
                          markerHeight={markerSize * 0.7}
                          refX={markerSize - 1}
                          refY={markerSize * 0.35}
                          orient="auto"
                        >
                          <polygon
                            points={`0 0, ${markerSize} ${markerSize * 0.35}, 0 ${markerSize * 0.7}`}
                            fill="rgba(34, 197, 94, 0.8)"
                          />
                        </marker>
                      </defs>
                      <line
                        x1={fromX}
                        y1={fromY}
                        x2={toX}
                        y2={toY}
                        stroke="rgba(34, 197, 94, 0.8)"
                        strokeWidth={6}
                        strokeLinecap="round"
                        markerEnd="url(#arrowhead)"
                      />
                    </svg>
                  );
                })()}
              </div>
            </div>

            {promoting && (
              <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
                <div className="bg-slate-800 rounded-lg p-8">
                  <h3 className="text-white text-2xl font-bold mb-6 text-center">Promote Pawn</h3>
                  <div className="flex gap-4">
                    {(['q', 'r', 'b', 'n'] as Piece['type'][]).map(type => (
                      <button
                        key={type}
                        onClick={() => handlePromotion(type)}
                        className="bg-slate-700 hover:bg-slate-600 p-4 rounded transition"
                      >
                        <img
                          src={getPieceImage({ color: myColor!, type })}
                          alt={type}
                          className={`w-16 h-16 ${isFlipped ? 'rotate-180' : ''}`}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-white text-xl font-semibold mb-4">Game Info</h3>
              <div className="space-y-2 text-slate-300">
                <p>
                  <strong>Turn:</strong>{' '}
                  <span className={chess?.turn() === myColor ? 'text-green-400' : 'text-white'}>
                    {chess?.turn() === 'w' ? 'White' : 'Black'}
                  </span>
                </p>
                <p><strong>Your Color:</strong> {myColor ? (myColor === 'w' ? 'White' : 'Black') : 'Spectating'}</p>
                <p><strong>Move:</strong> {chess?.moveNumber() || 1}</p>
                {game.outcome && (() => {
                  const winner = game.reason?.toLowerCase().includes('white wins') ? 'White'
                    : game.reason?.toLowerCase().includes('black wins') ? 'Black'
                      : null;
                  const iWon = (winner === 'White' && myColor === 'w') || (winner === 'Black' && myColor === 'b');
                  const iLost = myColor && winner && !iWon;
                  const resultClass = iWon ? 'bg-green-600' : iLost ? 'bg-red-600' : 'bg-purple-600';

                  return (
                    <div className={`mt-4 p-4 rounded ${resultClass}`}>
                      <p className="font-bold text-white">Game Over!</p>
                      <p className="text-white">{game.reason}</p>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-white text-xl font-semibold mb-4">Players</h3>
              <div className="space-y-2">
                {game.participants.map((p) => (
                  <div key={p.color} className="flex items-center justify-between text-slate-300">
                    <span className="font-semibold">{p.displayName}</span>
                    <span className={`px-3 py-1 rounded ${p.color === 'w' ? 'bg-white text-black' : 'bg-slate-900 text-white'}`}>
                      {p.color === 'w' ? 'White' : 'Black'}
                    </span>
                  </div>
                ))}
                {game.participants.length < 2 && (
                  <p className="text-slate-400 italic">Waiting for opponent...</p>
                )}
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-white text-xl font-semibold mb-4">Move History</h3>
              <div className="max-h-64 overflow-y-auto space-y-1 text-slate-300">
                {game.history.length === 0 ? (
                  <p className="text-slate-400 italic">No moves yet</p>
                ) : (
                  game.history.map((m, i) => (
                    <div key={i}>
                      {Math.floor(Number(i) / 2) + 1}. {algebraic(m.from)} → {algebraic(m.to)}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) as User : null;
  });
  const [gameId, setGameId] = useState<string | null>(() => {
    return localStorage.getItem('lastGameId');
  });

  const [spectatorMode, setSpectatorMode] = useState(false);

  const handleGameSelect = (id: string, spectate = false) => {
    setGameId(id);
    setSpectatorMode(spectate);
  };

  useEffect(() => {
    if (gameId) localStorage.setItem('lastGameId', gameId);
    else localStorage.removeItem('lastGameId');
  }, [gameId]);

  const handleLogin = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setGameId(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('lastGameId');
  };

  if (!token || !user) {
    return <Auth onLogin={handleLogin} />;
  }

  return (
    <>
      {gameId ? (
        <ChessGame
          token={token}
          user={user}
          gameId={gameId}
          onBack={() => { setGameId(null); setSpectatorMode(false); }}
          spectatorMode={spectatorMode}
        />
      ) : (
        <Lobby
          token={token}
          user={user}
          onGameSelect={handleGameSelect}
        />
      )}

      <ChatDock token={token} user={user} onLogout={handleLogout} />
    </>
  );
}