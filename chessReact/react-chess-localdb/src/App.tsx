/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  useState,
  useEffect,
  useMemo,
  useRef,
  startTransition,
  type Key,
} from 'react';
import { MessageCircle, X, Send, Filter, Search } from 'lucide-react';
import ChatDock from './chat/chatDock.tsx';

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
function onBoard(r: number, f: number) { return r >= 0 && r < 8 && f >= 0 && f < 8; }
function idx(r: number, f: number) { return r * 8 + f; }
function rank(i: number) { return Math.floor(i / 8); }
function file(i: number) { return i % 8; }
function colorOpp(c: 'w' | 'b'): 'w' | 'b' { return c === 'w' ? 'b' : 'w'; }
function algebraic(i: number) { return 'abcdefgh'[file(i)] + (8 - rank(i)); }

function parseFEN(fen: string): { board: (Piece | null)[]; state: GameState } {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const rows = placement.split('/');
  const board = [];
  for (const row of rows) {
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) board.push(null);
      } else {
        board.push({
          color: (ch === ch.toUpperCase() ? 'w' : 'b') as 'w' | 'b',
          type: ch.toLowerCase() as Piece['type']
        });
      }
    }
  }
  return {
    board,
    state: {
      turn: (turn || 'w') as 'w' | 'b',
      castling: castling === '-' ? '' : castling,
      ep: ep === '-' ? null : ('abcdefgh'.indexOf(ep[0]) + (8 - Number(ep[1])) * 8),
      halfmove: Number(half) || 0,
      fullmove: Number(full) || 1
    }
  };
}

function boardToFEN(board: (Piece | null)[], s: GameState): string {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let empty = 0, row = '';
    for (let f = 0; f < 8; f++) {
      const p = board[idx(r, f)];
      if (!p) empty++;
      else {
        if (empty) { row += empty; empty = 0; }
        row += p.color === 'w' ? p.type.toUpperCase() : p.type;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const cast = s.castling || '-';
  const epStr = s.ep == null ? '-' : algebraic(s.ep);
  return `${rows.join('/')} ${s.turn} ${cast} ${epStr} ${s.halfmove} ${s.fullmove}`;
}

function squareAttackedBy(board: (Piece | null)[], sq: number, attacker: 'w' | 'b'): boolean {
  for (const [dr, df] of KNIGHT) {
    const r = rank(sq) + dr, f = file(sq) + df;
    if (!onBoard(r, f)) continue;
    const p = board[idx(r, f)];
    if (p && p.color === attacker && p.type === 'n') return true;
  }
  for (const [dr, df] of KING) {
    const r = rank(sq) + dr, f = file(sq) + df;
    if (!onBoard(r, f)) continue;
    const p = board[idx(r, f)];
    if (p && p.color === attacker && p.type === 'k') return true;
  }
  for (const [dr, df] of ROOK_DIR) {
    let r = rank(sq) + dr, f = file(sq) + df;
    while (onBoard(r, f)) {
      const p = board[idx(r, f)];
      if (p) {
        if (p.color === attacker && (p.type === 'r' || p.type === 'q')) return true;
        break;
      }
      r += dr; f += df;
    }
  }
  for (const [dr, df] of BISHOP_DIR) {
    let r = rank(sq) + dr, f = file(sq) + df;
    while (onBoard(r, f)) {
      const p = board[idx(r, f)];
      if (p) {
        if (p.color === attacker && (p.type === 'b' || p.type === 'q')) return true;
        break;
      }
      r += dr; f += df;
    }
  }
  const dir = attacker === 'w' ? -1 : 1;
  for (const df of [-1, 1]) {
    const r = rank(sq) + dir, f = file(sq) + df;
    if (!onBoard(r, f)) continue;
    const p = board[idx(r, f)];
    if (p && p.color === attacker && p.type === 'p') return true;
  }
  return false;
}

function inCheck(board: (Piece | null)[], color: 'w' | 'b'): boolean {
  let kingSq = -1;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.color === color && p.type === 'k') { kingSq = i; break; }
  }
  if (kingSq === -1) return false;
  return squareAttackedBy(board, kingSq, colorOpp(color));
}

function slide(board: (Piece | null)[], from: number, color: 'w' | 'b', dirs: number[][]): Move[] {
  const r0 = rank(from), f0 = file(from);
  const res = [];
  for (const [dr, df] of dirs) {
    let r = r0 + dr, f = f0 + df;
    while (onBoard(r, f)) {
      const i = idx(r, f);
      const t = board[i];
      if (!t) {
        res.push({ from, to: i });
      } else {
        if (t.color !== color && t.type !== 'k') res.push({ from, to: i, captured: t });
        break;
      }
      r += dr; f += df;
    }
  }
  return res;
}

function getPseudoLegalMoves(board: (Piece | null)[], s: GameState, index: number): Move[] {
  const p = board[index];
  if (!p || p.color !== s.turn) return [];
  const r = rank(index), f = file(index);
  const moves = [];

  if (p.type === 'p') {
    const dir = p.color === 'w' ? -1 : 1;
    const startRank = p.color === 'w' ? 6 : 1;
    const lastRank = p.color === 'w' ? 0 : 7;
    const r1 = r + dir;
    if (onBoard(r1, f) && !board[idx(r1, f)]) {
      const to = idx(r1, f);
      const m: Move = { from: index, to };
      if (r1 === lastRank) m.flags = 'promo';
      moves.push(m);
      if (r === startRank) {
        const r2 = r + 2 * dir;
        if (onBoard(r2, f) && !board[idx(r2, f)]) moves.push({ from: index, to: idx(r2, f) });
      }
    }
    for (const df of [-1, 1]) {
      const rc = r + dir, fc = f + df;
      if (!onBoard(rc, fc)) continue;
      const ti = idx(rc, fc);
      const t = board[ti];
      if (t && t.color !== p.color && t.type !== 'k') {
        const m: Move = { from: index, to: ti, captured: t };
        if (rc === lastRank) m.flags = 'promo';
        moves.push(m);
      }
    }
    if (s.ep != null) {
      const er = rank(s.ep), ef = file(s.ep);
      if (er === r + dir && Math.abs(ef - f) === 1) {
        moves.push({
          from: index,
          to: s.ep,
          flags: 'ep',
          captured: { color: colorOpp(p.color) as 'w' | 'b', type: 'p' as const }
        } satisfies Move);
      }
    }
  } else if (p.type === 'n') {
    for (const [dr, df] of KNIGHT) {
      const nr = r + dr, nf = f + df;
      if (!onBoard(nr, nf)) continue;
      const t = board[idx(nr, nf)];
      if (!t || (t.color !== p.color && t.type !== 'k')) moves.push({ from: index, to: idx(nr, nf), captured: t || undefined });
    }
  } else if (p.type === 'b') {
    moves.push(...slide(board, index, p.color, BISHOP_DIR));
  } else if (p.type === 'r') {
    moves.push(...slide(board, index, p.color, ROOK_DIR));
  } else if (p.type === 'q') {
    moves.push(...slide(board, index, p.color, QUEEN_DIR));
  } else if (p.type === 'k') {
    for (const [dr, df] of KING) {
      const nr = r + dr, nf = f + df;
      if (!onBoard(nr, nf)) continue;
      const t = board[idx(nr, nf)];
      if (!t || (t.color !== p.color && t.type !== 'k')) moves.push({ from: index, to: idx(nr, nf), captured: t || undefined });
    }
    if (p.color === 'w' && r === 7 && f === 4) {
      if (s.castling.includes('K') && !board[idx(7, 5)] && !board[idx(7, 6)]) {
        if (!inCheck(board, 'w') && !squareAttackedBy(board, idx(7, 5), 'b') && !squareAttackedBy(board, idx(7, 6), 'b')) {
          moves.push({ from: index, to: idx(7, 6), flags: 'castle-k' });
        }
      }
      if (s.castling.includes('Q') && !board[idx(7, 3)] && !board[idx(7, 2)] && !board[idx(7, 1)]) {
        if (!inCheck(board, 'w') && !squareAttackedBy(board, idx(7, 3), 'b') && !squareAttackedBy(board, idx(7, 2), 'b')) {
          moves.push({ from: index, to: idx(7, 2), flags: 'castle-q' });
        }
      }
    }
    if (p.color === 'b' && r === 0 && f === 4) {
      if (s.castling.includes('k') && !board[idx(0, 5)] && !board[idx(0, 6)]) {
        if (!inCheck(board, 'b') && !squareAttackedBy(board, idx(0, 5), 'w') && !squareAttackedBy(board, idx(0, 6), 'w')) {
          moves.push({ from: index, to: idx(0, 6), flags: 'castle-k' });
        }
      }
      if (s.castling.includes('q') && !board[idx(0, 3)] && !board[idx(0, 2)] && !board[idx(0, 1)]) {
        if (!inCheck(board, 'b') && !squareAttackedBy(board, idx(0, 3), 'w') && !squareAttackedBy(board, idx(0, 2), 'w')) {
          moves.push({ from: index, to: idx(0, 2), flags: 'castle-q' });
        }
      }
    }
  }
  return moves;
}

function makeMove(board: (Piece | null)[], state: GameState, move: Move, skipCheck?: boolean): { board: (Piece | null)[]; state: GameState } {
  const b = board.slice();
  const s = { ...state };
  const moving = b[move.from];
  if (!moving) return { board, state };

  s.ep = null;
  const isPawnMove = moving.type === 'p';
  const isCapture = !!move.captured || move.flags === 'ep';
  s.halfmove = (isPawnMove || isCapture) ? 0 : s.halfmove + 1;

  b[move.to] = { ...moving };
  b[move.from] = null;

  if (move.promotion) b[move.to] = {
    color: moving.color,
    type: move.promotion as Piece['type']
  };

  if (move.flags === 'ep') {
    const dir = moving.color === 'w' ? 1 : -1;
    b[move.to + dir * 8] = null;
  }

  if (moving.type === 'p' && Math.abs(move.to - move.from) === 16) {
    s.ep = (move.to + move.from) / 2;
  }

  const fromR = rank(move.from), fromF = file(move.from);
  const toR = rank(move.to), toF = file(move.to);

  if (moving.type === 'k') {
    if (moving.color === 'w') {
      s.castling = s.castling.replace('K', '').replace('Q', '');
    } else {
      s.castling = s.castling.replace('k', '').replace('q', '');
    }
    if (move.flags === 'castle-k') {
      if (moving.color === 'w') { b[idx(7, 5)] = b[idx(7, 7)]; b[idx(7, 7)] = null; }
      else { b[idx(0, 5)] = b[idx(0, 7)]; b[idx(0, 7)] = null; }
    }
    if (move.flags === 'castle-q') {
      if (moving.color === 'w') { b[idx(7, 3)] = b[idx(7, 0)]; b[idx(7, 0)] = null; }
      else { b[idx(0, 3)] = b[idx(0, 0)]; b[idx(0, 0)] = null; }
    }
  }

  if (moving.type === 'r') {
    if (fromR === 7 && fromF === 0) s.castling = s.castling.replace('Q', '');
    if (fromR === 7 && fromF === 7) s.castling = s.castling.replace('K', '');
    if (fromR === 0 && fromF === 0) s.castling = s.castling.replace('q', '');
    if (fromR === 0 && fromF === 7) s.castling = s.castling.replace('k', '');
  }

  if (isCapture) {
    if (toR === 7 && toF === 0) s.castling = s.castling.replace('Q', '');
    if (toR === 7 && toF === 7) s.castling = s.castling.replace('K', '');
    if (toR === 0 && toF === 0) s.castling = s.castling.replace('q', '');
    if (toR === 0 && toF === 7) s.castling = s.castling.replace('k', '');
  }

  s.turn = colorOpp(s.turn);
  if (s.turn === 'w') s.fullmove += 1;

  if (!skipCheck && inCheck(b, colorOpp(s.turn))) return { board, state };

  return { board: b, state: s };
}

function getLegalMoves(board: (Piece | null)[], s: GameState, index: number): Move[] {
  const pseudo = getPseudoLegalMoves(board, s, index);
  const res = [];
  for (const m of pseudo) {
    const { board: nb, state: ns } = makeMove(board, s, m, true);
    if (inCheck(nb, s.turn)) continue;
    const hasOppKing = nb.some((p) => p !== null && p.color === ns.turn && p.type === 'k');
    if (!hasOppKing) continue;
    res.push(m);
  }
  return res;
}

function hasLegalMove(board: (Piece | null)[], s: GameState): boolean {
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p || p.color !== s.turn) continue;
    if (getLegalMoves(board, s, i).length) return true;
  }
  return false;
}

function detectOutcome(board: (Piece | null)[], s: GameState) {
  const side = s.turn;
  const legal = hasLegalMove(board, s);
  const check = inCheck(board, side);
  if (!legal) {
    if (check) return { outcome: 'checkmate', reason: side === 'w' ? 'Black wins' : 'White wins' };
    return { outcome: 'draw', reason: 'stalemate' };
  }
  if (s.halfmove >= 100) return { outcome: 'draw', reason: '50-move rule' };
  return { outcome: null, reason: null };
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-lg shadow-2xl p-8 w-full max-w-md">
        <h1 className="text-3xl font-bold text-white mb-6 text-center">♟️ Chess Game</h1>

        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-2 rounded ${mode === 'login' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300'}`}
          >
            Login
          </button>
          <button
            onClick={() => setMode('register')}
            className={`flex-1 py-2 rounded ${mode === 'register' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300'}`}
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
                className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-purple-500 outline-none"
              />
              <input
                type="email"
                placeholder="Email (optional)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-purple-500 outline-none"
              />
            </>
          )}
          <input
            type="text"
            placeholder={mode === 'login' ? 'Username or Email' : 'Username'}
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-purple-500 outline-none"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-purple-500 outline-none"
            required
          />
          {error && <p className={`text-sm ${error.includes('successful') ? 'text-green-400' : 'text-red-400'}`}>{error}</p>}
          <button
            type="submit"
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded transition"
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

  const [statusFilter, setStatusFilter] = useState<'all' | 'waiting' | 'active' | 'finished'>('all');
  const [myColorFilter, setMyColorFilter] = useState<'all' | 'w' | 'b' | 'spectating'>('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState('');

  const loadGames = async () => {
    const res = await fetch(API_BASE + '/games/waiting', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setGames(await res.json());
  };

  useEffect(() => {
    loadGames();
    const i = setInterval(loadGames, 3000);
    return () => clearInterval(i);
  }, [token]);

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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Chess Lobby</h1>
            <p className="text-slate-300">Welcome, {user.displayName || user.email}</p>
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
              <label className="block text-slate-300 text-xs mb-1">Search (code or player)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="e.g. ABC123 or Rahim"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-purple-500 outline-none"
                />
                <button
                  onClick={() => setSearch('')}
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
                className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-purple-500 outline-none"
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
                className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-purple-500 outline-none"
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
                  className="accent-purple-600"
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
              className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 text-white font-semibold py-3 rounded transition"
            >
              {creating ? 'Creating...' : 'Create New Game'}
            </button>
            <div className="flex gap-2 flex-1">
              <input
                type="text"
                placeholder="Game Code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="flex-1 p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-purple-500 outline-none"
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

          {filtered.length === 0 ? (
            <p className="text-slate-400 text-center py-8">No games match your filters. Create one or loosen the filters.</p>
          ) : (
            <div className="space-y-3">
              {filtered.map(g => {
                const me = g.participants.find(p => p.displayName === user.displayName);
                const myColor = me?.color;
                const finished = !!g.outcome;
                const winner = winnerOf(g);
                const subline = finished
                  ? (winner ? `Finished • Winner: ${winner}` : 'Finished • Draw')
                  : `${g.status} • ${g.participants.length}/2 players`;

                const actionLabel =
                  finished ? 'View' :
                    myColor ? 'Resume' : 'Join';

                return (
                  <div
                    key={g.id}
                    className={`bg-slate-700 rounded p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 hover:bg-slate-600 transition`}
                  >
                    <div>
                      <p className="text-white font-semibold">Game {g.code}</p>
                      <p className="text-slate-300 text-sm">
                        {subline}
                        {g.participants.length > 0 && !finished && (
                          <> • {g.participants.map(p => p.displayName).join(', ')}</>
                        )}
                        {finished && g.reason && <>, {g.reason}</>}
                      </p>
                      {myColor && (
                        <p className="text-xs text-slate-400 mt-1">You are {myColor === 'w' ? 'White' : 'Black'}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const iAmIn = g.participants.some(p => p.displayName === user.displayName);
                          const isFull = g.participants.length >= 2;
                          
                          if (!iAmIn && isFull) {
                            onGameSelect(g.id, true);
                          } else {
                            onGameSelect(g.id);
                          }
                        }}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded transition"
                      >
                        {finished 
                          ? 'View' 
                          : myColor 
                            ? 'Resume' 
                            : (g.participants.length >= 2 ? 'Spectate' : 'Join')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChessGame({ token, user, gameId, onBack, spectatorMode = false }: { token: string; user: User; gameId: string; onBack: () => void, spectatorMode: boolean }) {
  const [board, setBoard] = useState<(Piece | null)[]>([]);
  const [state, setState] = useState<GameState | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);
  const [myColor, setMyColor] = useState<'w' | 'b' | null>(null);
  const [promoting, setPromoting] = useState<{ from: number; to: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const isSpectating = useMemo(() => {
    if (spectatorMode) return true;
    if (!game) return false;
    const participant = game.participants.find(p => p.displayName === user.displayName);
    return !participant;
  }, [game, user.displayName, spectatorMode]);

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

  // ── First load: hydrate full game & baseline FEN
  const loadGameFull = async () => {
    const res = await fetch(`${API_BASE}/games/${gameId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const g: Game = await res.json();
    setGame(g);
    const { board: b, state: s } = parseFEN(g.fen);
    setBoard(b);
    setState(s);
    lastAppliedRef.current = g.history?.length ?? 0;
  };

  useEffect(() => {
    lastAppliedRef.current = 0;
    setSelected(null);
    setLegalMoves([]);
    loadGameFull();
  }, [gameId]);

  // ── Track my color once we know the game roster
  useEffect(() => {
    if (!game) return;
    const me = game.participants.find((p: { displayName: string }) => p.displayName === user.displayName);
    if (me) setMyColor(me.color as 'w' | 'b');
    else setMyColor(null);
  }, [game, user.displayName]);

  // ── Delta polling: fetch lightweight game and reconcile by history growth
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

        // If we don't have a baseline, just hydrate
        if (!state || !board || lastAppliedRef.current === 0) {
          setGame(g);
          const { board: b, state: s } = parseFEN(g.fen);
          setBoard(b);
          setState(s);
          lastAppliedRef.current = g.history?.length ?? 0;
          return;
        }

        // Apply only new moves
        const currentLen = lastAppliedRef.current;
        const newLen = g.history?.length ?? 0;

        if (newLen > currentLen && board && state) {
          let nb = board;
          let ns = state;
          for (let k = currentLen; k < newLen; k++) {
            const mv = g.history[k];
            const resMove = makeMove(nb, ns, { from: mv.from, to: mv.to, flags: mv.flags, promotion: mv.promotion } as Move, true);
            nb = resMove.board; ns = resMove.state;
          }

          // Guard: if we drifted, resync to server FEN
          try {
            if (boardToFEN(nb, ns) !== g.fen) {
              const parsed = parseFEN(g.fen);
              nb = parsed.board; ns = parsed.state;
            }
          } catch { /* ignore */ }

          startTransition(() => { setBoard(nb); setState(ns); });
          lastAppliedRef.current = newLen;
        }

        setGame(g);
      } catch { /* network hiccup ignored */ }
    };

    const i = setInterval(tick, 1200);
    tick(); // immediate
    return () => { alive = false; clearInterval(i); };
  }, [gameId, token, state, board]);

  const joinGame = async (color: string) => {
    const res = await fetch(`${API_BASE}/games/${gameId}/join?color=${color}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setMyColor(data.color);
      loadGameFull();
    }
  };

  const handleSquareClick = (i: number) => {
    if (isSpectating || !myColor) return;
    if (!state || !board || game?.status !== 'active') return;
    if (state.turn !== myColor) return;

    if (selected === null) {
      const p = board[i];
      if (p && p.color === myColor) {
        setSelected(i);
        setLegalMoves(getLegalMoves(board, state, i));
      }
    } else {
      const move = legalMoves.find(m => m.to === i);
      if (move) {
        if (move.flags !== 'promo') {
          const { board: testBoard, state: testState } = makeMove(board, state, move, true);
          if (inCheck(testBoard, state.turn)) {
            setSelected(null);
            setLegalMoves([]);
            return;
          }
        }
        else if (move.flags === 'promo') {
          setPromoting({ from: move.from, to: move.to });
        } else {
          executeMove(move);
        }
      }
      setSelected(null);
      setLegalMoves([]);
    }
  };

  // ── Optimistic execute: paint first, post later; resync on failure
  const executeMove = async (move: Move) => {
    if (!state || !board) return;

    const { board: nb, state: ns } = makeMove(board, state, move);
    const newFen = boardToFEN(nb, ns);
    const outcome = detectOutcome(nb, ns);

    startTransition(() => { setBoard(nb); setState(ns); });
    lastAppliedRef.current += 1; // we expect server to append our move

    try {
      const res = await fetch(`${API_BASE}/games/${gameId}/move`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: move.from,
          to: move.to,
          flags: move.flags || null,
          promotion: move.promotion || null,
          fen: newFen,
          outcome: outcome.outcome,
          reason: outcome.reason
        })
      });
      if (!res.ok) throw new Error('Move rejected');
    } catch (err) {
      // Rollback to server truth
      await loadGameFull();
    }
  };

  const handlePromotion = (type: string) => {
    if (!promoting) return;
    executeMove({ ...promoting, promotion: type } as Move);
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

  // ── Cheap “king in check” marker (avoid running inCheck 64×)
  const whiteInCheck = useMemo(() => (board ? inCheck(board, 'w') : false), [board, state?.turn]);
  const blackInCheck = useMemo(() => (board ? inCheck(board, 'b') : false), [board, state?.turn]);

  if (!game) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <p className="text-white text-2xl">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <button
            onClick={onBack}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded"
          >
            ← Back to Lobby
          </button>
          <div className="text-white text-center">
            <h2 className="text-2xl font-bold">Game {game.code}</h2>
            <p className="text-slate-300">Status: {game.status}</p>
          </div>
          {game.status === 'active' && myColor && !isSpectating && (
            <button
              onClick={resign}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded"
            >
              Resign
            </button>
          )}
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
              {/* Flip container; children (pieces/dots) counter-rotate to look upright */}
              <div className={`grid grid-cols-8 gap-0 border-4 border-slate-600 ${isFlipped ? 'rotate-180' : ''}`}>
                {board.map((piece, i) => {
                  const r = rank(i);
                  const f = file(i);
                  const isLight = (r + f) % 2 === 0;
                  const isSelected = selected === i;
                  const isLegalMove = legalMoves.some(m => m.to === i);
                  const isCheck =
                    piece &&
                    piece.type === 'k' &&
                    ((piece.color === 'w' && whiteInCheck) || (piece.color === 'b' && blackInCheck));

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
                          className={`absolute w-4 h-4 rounded-full ${isFlipped ? 'rotate-180' : ''} ${piece ? 'border-4 border-green-500' : 'bg-green-500 opacity-50'
                            }`}
                        />
                      )}
                    </div>
                  );
                })}
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
                <p><strong>Turn:</strong> {state?.turn === 'w' ? 'White' : 'Black'}</p>
                <p><strong>Your Color:</strong> {myColor ? (myColor === 'w' ? 'White' : 'Black') : 'Spectating'}</p>
                <p><strong>Move:</strong> {state?.fullmove || 1}</p>
                {game.outcome && (
                  <div className="mt-4 p-4 bg-yellow-600 rounded">
                    <p className="font-bold text-white">Game Over!</p>
                    <p className="text-white">{game.reason}</p>
                  </div>
                )}
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