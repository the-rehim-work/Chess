/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useMemo, useRef, startTransition } from 'react';
import { X } from 'lucide-react';
import ChatDock from './chat/chatDock.tsx';
import { API_BASE } from './apiOrigin.ts';
import { Chess, type Square, Move as ChessMove } from 'chess.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════
interface Piece {
  color: 'w' | 'b';
  type: 'p' | 'r' | 'n' | 'b' | 'q' | 'k';
}

interface Game {
  id: string;
  code: string;
  fen: string;
  status: string;
  outcome: string | null;
  reason: string | null;
  isRanked: boolean;
  isBotGame: boolean;
  botDifficulty?: string | null;
  eloChange?: {
    white?: { oldElo: number; newElo: number; league: string };
    black?: { oldElo: number; newElo: number; league: string };
  } | null;
  participants: Array<{
    displayName: string;
    color: 'w' | 'b';
    isBot: boolean;
    elo: number;
    league: string;
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

interface PlayerRating {
  userName?: string;
  displayName?: string;
  elo: number;
  league: string;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  winStreak: number;
  peakElo?: number;
}

interface MatchmakingStatus {
  status: 'idle' | 'queued' | 'matched' | 'already_queued' | 'cancelled';
  gameId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
const DEFAULT_ELO = 1200;
function rank(i: number) { return Math.floor(i / 8); }
function file(i: number) { return i % 8; }
function algebraic(i: number) { return 'abcdefgh'[file(i)] + (8 - rank(i)); }

function leagueBadgeClass(league: string) {
  if (league.startsWith('Iron')) return 'text-gray-400 bg-gray-800';
  if (league.startsWith('Bronze')) return 'text-amber-700 bg-amber-900/30';
  if (league.startsWith('Silver')) return 'text-slate-300 bg-slate-700';
  if (league.startsWith('Gold')) return 'text-yellow-400 bg-yellow-900/30';
  if (league.startsWith('Platinum')) return 'text-teal-300 bg-teal-900/30';
  if (league.startsWith('Diamond')) return 'text-blue-300 bg-blue-900/30';
  if (league.startsWith('Master')) return 'text-purple-400 bg-purple-900/30';
  return 'text-red-400 bg-red-900/30';
}

function getMockyLeague(elo: number): string {
  if (elo < 200) return 'Grass IV';
  if (elo < 325) return 'Grass III';
  if (elo < 450) return 'Grass II';
  if (elo < 600) return 'Grass I';
  if (elo < 700) return 'Puke IV';
  if (elo < 800) return 'Puke III';
  if (elo < 900) return 'Puke II';
  if (elo < 1000) return 'Puke I';
  if (elo < 1100) return 'Toilet IV';
  if (elo < 1200) return 'Toilet III';
  if (elo < 1300) return 'Toilet II';
  if (elo < 1400) return 'Toilet I';
  if (elo < 1500) return 'Microwave IV';
  if (elo < 1600) return 'Microwave III';
  if (elo < 1700) return 'Microwave II';
  if (elo < 1800) return 'Microwave I';
  if (elo < 1900) return 'Couch Potato III';
  if (elo < 2000) return 'Couch Potato II';
  if (elo < 2100) return 'Couch Potato I';
  if (elo < 2200) return 'Fridge III';
  if (elo < 2300) return 'Fridge II';
  if (elo < 2400) return 'Fridge I';
  if (elo < 2700) return 'Cockroach';
  return 'God of Blunders';
}

function displayLeague(serverLeague: string, elo: number): string {
  const style = localStorage.getItem('leagueStyle') ?? 'serious';
  return style === 'mocky' ? getMockyLeague(elo) : serverLeague;
}

function normalizeGame(row: any): Game {
  return {
    id: row.id,
    code: row.code,
    fen: row.fen,
    status: row.status,
    outcome: row.outcome ?? null,
    reason: row.reason ?? null,
    isRanked: row.isRanked ?? true,
    isBotGame: row.isBotGame ?? false,
    botDifficulty: row.botDifficulty ?? null,
    eloChange: row.eloChange ?? null,
    participants: (row.participants ?? row.Participants ?? []).map((p: any) => ({
      displayName: p.displayName ?? p.DisplayName,
      color: p.color,
      isBot: p.isBot ?? false,
      elo: p.elo ?? DEFAULT_ELO,
      league: p.league ?? 'Bronze IV'
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
                className="w-full p-3 text-base bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
              />
              <input
                type="email"
                placeholder="Email (optional)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-3 text-base bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
              />
            </>
          )}
          <input
            type="text"
            placeholder={mode === 'login' ? 'Username or Email' : 'Username'}
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className="w-full p-3 text-base bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 text-base bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
            required
          />
          {error && <p className={`text-sm ${error.includes('successful') ? 'text-green-400' : 'text-red-400'}`}>{error}</p>}
          <button
            type="submit"
            className="w-full min-h-[48px] bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-3 rounded transition touch-manipulation"
          >
            {mode === 'login' ? 'Login' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  );
}

function SettingsModal({ open, onClose, token }: { open: boolean; onClose: () => void; token: string }) {
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [leagueStyle, setLeagueStyle] = useState(() => localStorage.getItem('leagueStyle') ?? 'serious');

  const changePw = async () => {
    setPwMsg('');
    if (newPw !== confirmPw) { setPwMsg('Passwords do not match.'); return; }
    const res = await fetch(`${API_BASE}/auth/change-password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: curPw, newPassword: newPw, confirmPassword: confirmPw })
    });
    const data = await res.json();
    setPwMsg(data.message || (res.ok ? 'Done.' : 'Failed.'));
    if (res.ok) { setCurPw(''); setNewPw(''); setConfirmPw(''); }
  };

  const toggleStyle = (s: string) => {
    setLeagueStyle(s);
    localStorage.setItem('leagueStyle', s);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-xl shadow-2xl border border-slate-700 w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded text-white">✕</button>
        </div>
        <div className="mb-6">
          <h3 className="text-white font-semibold mb-3">Change Password</h3>
          <div className="space-y-2">
            <input type="password" placeholder="Current Password" value={curPw} onChange={e => setCurPw(e.target.value)}
              className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 outline-none" />
            <input type="password" placeholder="New Password" value={newPw} onChange={e => setNewPw(e.target.value)}
              className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 outline-none" />
            <input type="password" placeholder="Confirm New Password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
              className="w-full p-3 bg-slate-700 text-white rounded border border-slate-600 outline-none" />
            {pwMsg && <p className={`text-sm ${pwMsg.includes('Done') || pwMsg.includes('changed') ? 'text-green-400' : 'text-red-400'}`}>{pwMsg}</p>}
            <button onClick={changePw} className="w-full min-h-[44px] bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-2 rounded">
              Change Password
            </button>
          </div>
        </div>
        <div>
          <h3 className="text-white font-semibold mb-3">League Names</h3>
          <div className="flex gap-3">
            <button onClick={() => toggleStyle('serious')}
              className={`flex-1 py-2 rounded font-semibold ${leagueStyle === 'serious' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
              Serious
            </button>
            <button onClick={() => toggleStyle('mocky')}
              className={`flex-1 py-2 rounded font-semibold ${leagueStyle === 'mocky' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
              Mocky
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2">Mocky: Iron → Grass, Bronze → Puke, Silver → Toilet, Gold → Microwave, Platinum → Couch Potato, Diamond → Fridge, Master → Cockroach, GM → God of Blunders</p>
        </div>
      </div>
    </div>
  );
}

function Lobby({ token, user, onGameSelect }: { token: string; user: User; onGameSelect: (id: string, spectate?: boolean) => void }) {
  const [lobbyTab, setLobbyTab] = useState<'games' | 'leaderboard'>('games');
  const [myRating, setMyRating] = useState<PlayerRating | null>(null);
  const [leaderboard, setLeaderboard] = useState<PlayerRating[]>([]);
  const [matchmaking, setMatchmaking] = useState<'idle' | 'queued' | 'matched'>('idle');
  const [botPicker, setBotPicker] = useState(false);
  const [botColor, setBotColor] = useState<'w' | 'b' | 'random'>('random');
  const [games, setGames] = useState<Game[]>([]);
  const [creating, setCreating] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const [statusFilter, setStatusFilter] = useState<'all' | 'waiting' | 'active' | 'finished'>('all');
  const [myColorFilter, setMyColorFilter] = useState<'all' | 'w' | 'b' | 'spectating'>('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);

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

  const loadMyRating = async () => {
    const res = await fetch(`${API_BASE}/ratings/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    setMyRating(await res.json());
  };

  const loadLeaderboard = async () => {
    const res = await fetch(`${API_BASE}/ratings/leaderboard?take=50`);
    if (!res.ok) return;
    setLeaderboard(await res.json());
  };

  useEffect(() => {
    let alive = true;
    const tick = async () => { if (alive) await loadGames(); };
    tick();
    const i = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(i); };
  }, [token, statusFilter, onlyMine, search]);
  useEffect(() => {
    loadMyRating();
  }, [token]);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`${API_BASE}/online/count`);
        if (r.ok && alive) setOnlineCount((await r.json()).count);
      } catch {}
    };
    tick();
    const i = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(i); };
  }, []);
  useEffect(() => {
    if (lobbyTab === 'leaderboard') loadLeaderboard();
  }, [lobbyTab]);

  useEffect(() => {
    if (matchmaking !== 'queued') return;
    const i = setInterval(async () => {
      const res = await fetch(`${API_BASE}/matchmaking/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data: MatchmakingStatus = await res.json();
      if (data.status === 'matched' && data.gameId) {
        setMatchmaking('matched');
        onGameSelect(data.gameId);
      }
    }, 2000);
    return () => clearInterval(i);
  }, [matchmaking, token]);

  useEffect(() => {
    return () => {
      if (matchmaking === 'queued') {
        fetch(`${API_BASE}/matchmaking/queue`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      }
    };
  }, [matchmaking, token]);

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

  const queueRandom = async () => {
    const res = await fetch(`${API_BASE}/matchmaking/queue`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (!res.ok) return;
    const data: MatchmakingStatus = await res.json();
    if (data.status === 'matched' && data.gameId) onGameSelect(data.gameId);
    if (data.status === 'queued' || data.status === 'already_queued') setMatchmaking('queued');
  };

  const cancelQueue = async () => {
    await fetch(`${API_BASE}/matchmaking/queue`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    setMatchmaking('idle');
  };

  const playBot = async (difficulty: 'easy' | 'medium' | 'hard' | 'expert') => {
    const preferredColor = botColor === 'random' ? null : botColor;
    const res = await fetch(`${API_BASE}/bot/play`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ difficulty, preferredColor })
    });
    if (!res.ok) return;
    const data = await res.json();
    onGameSelect(data.gameId);
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
    <div className="min-h-screen min-h-[100dvh] bg-gradient-to-br from-slate-900 via-emerald-900 to-slate-900 px-4 py-4 sm:p-8 pb-[max(1.5rem,env(safe-area-inset-bottom,0px)+1rem)]">
      <div className="max-w-5xl mx-auto w-full min-w-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-start mb-6 sm:mb-8">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-4xl font-bold text-white mb-2">Chess Lobby</h1>
            <p className="text-slate-100 text-base sm:text-lg break-words">
              Welcome,
              <span className="ml-2 font-semibold text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.35)]">
                {user.displayName || user.email}
              </span>
            </p>
            <div className="mt-1 flex items-center gap-1 text-sm text-emerald-400">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {onlineCount} online
            </div>
            {myRating && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-cyan-300">Elo: {myRating.elo}</span>
                <span className={`px-2 py-1 rounded ${leagueBadgeClass(myRating.league)}`}>{displayLeague(myRating.league, myRating.elo)}</span>
                <span className="text-slate-200">W/L/D: {myRating.wins}/{myRating.losses}/{myRating.draws}</span>
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0 self-start sm:self-auto">
            <button
              onClick={() => setSettingsOpen(true)}
              className="px-4 py-2.5 min-h-[44px] bg-slate-700 hover:bg-slate-600 text-white rounded touch-manipulation"
            >
              Settings
            </button>
            <button
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              className="px-4 py-2.5 min-h-[44px] bg-slate-700 hover:bg-slate-600 text-white rounded touch-manipulation"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="bg-slate-800 rounded-lg p-2 mb-4 flex gap-2">
          <button onClick={() => setLobbyTab('games')} className={`px-4 py-2 rounded ${lobbyTab === 'games' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300'}`}>Games</button>
          <button onClick={() => setLobbyTab('leaderboard')} className={`px-4 py-2 rounded ${lobbyTab === 'leaderboard' ? 'bg-cyan-600 text-white' : 'bg-slate-700 text-slate-300'}`}>Leaderboard</button>
        </div>

        {lobbyTab === 'games' && (
          <>
        {/* ── NEW: Filters */}
        <div className="bg-slate-800 rounded-lg p-3 sm:p-4 mb-4 shadow-xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div className="sm:col-span-2 lg:col-span-2">
              <label className="block text-slate-300 text-xs mb-1">Search</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Code or Player"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full min-w-0 p-3 text-base bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
                />
                <button
                  onClick={() => resetSearch()}
                  className="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded text-slate-200 touch-manipulation"
                  title="Clear"
                  type="button"
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
                className="w-full p-3 text-base bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
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
                className="w-full p-3 text-base bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none"
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
        <div className="bg-slate-800 rounded-lg p-4 sm:p-6 mb-6 shadow-xl">
          <h2 className="text-xl font-semibold text-white mb-4">Quick Actions</h2>
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={createGame}
              disabled={creating}
              className="flex-1 min-h-[48px] bg-cyan-600 hover:bg-cyan-700 disabled:bg-cyan-800 text-white font-semibold py-3 rounded transition touch-manipulation"
            >
              {creating ? 'Creating...' : 'Create New Game'}
            </button>
            {matchmaking === 'queued' ? (
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 min-h-[48px] rounded bg-amber-900/30 text-amber-300 flex items-center justify-center animate-pulse">
                  Searching for opponent... (Elo {myRating?.elo ?? DEFAULT_ELO})
                </div>
                <button onClick={cancelQueue} className="px-4 min-h-[48px] bg-slate-600 hover:bg-slate-500 rounded text-white">Cancel</button>
              </div>
            ) : (
              <button onClick={queueRandom} className="flex-1 min-h-[48px] bg-amber-600 hover:bg-amber-700 text-white font-semibold py-3 rounded transition">Play Random</button>
            )}
            <button onClick={() => setBotPicker(v => !v)} className="flex-1 min-h-[48px] bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded transition">Play vs Bot</button>
            <div className="flex gap-2 flex-1 min-w-0">
              <input
                type="text"
                placeholder="Game Code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="flex-1 min-w-0 p-3 bg-slate-700 text-white rounded border border-slate-600 focus:border-emerald-500 outline-none text-base"
              />
              <button
                onClick={joinByCode}
                className="shrink-0 px-4 sm:px-6 min-h-[48px] min-w-[4.5rem] bg-green-600 hover:bg-green-700 text-white font-semibold rounded transition touch-manipulation"
              >
                Join
              </button>
            </div>
          </div>
          {botPicker && (
            <div className="mt-4 bg-slate-700 rounded p-3 space-y-3">
              <div className="flex gap-2">
                <button onClick={() => setBotColor('w')} className={`px-3 py-2 rounded ${botColor === 'w' ? 'bg-cyan-600' : 'bg-slate-600'}`}>White</button>
                <button onClick={() => setBotColor('b')} className={`px-3 py-2 rounded ${botColor === 'b' ? 'bg-cyan-600' : 'bg-slate-600'}`}>Black</button>
                <button onClick={() => setBotColor('random')} className={`px-3 py-2 rounded ${botColor === 'random' ? 'bg-cyan-600' : 'bg-slate-600'}`}>Random</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button onClick={() => playBot('easy')} className="bg-slate-600 hover:bg-slate-500 rounded p-2 text-white">Easy (600)</button>
                <button onClick={() => playBot('medium')} className="bg-slate-600 hover:bg-slate-500 rounded p-2 text-white">Medium (1000)</button>
                <button onClick={() => playBot('hard')} className="bg-slate-600 hover:bg-slate-500 rounded p-2 text-white">Hard (1500)</button>
                <button onClick={() => playBot('expert')} className="bg-slate-600 hover:bg-slate-500 rounded p-2 text-white">Expert (2000)</button>
              </div>
            </div>
          )}
        </div>

        {/* Cards */}
        <div className="bg-slate-800 rounded-lg p-4 sm:p-6 shadow-xl">
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
                      <> • {g.participants.map(p => `${p.displayName} (${p.elo})`).join(', ')}</>
                    )}
                    {finished && g.reason && <>, {g.reason}</>}
                  </p>
                  {finished && g.eloChange && (
                    <p className="text-xs text-amber-300 mt-1">
                      White: {g.eloChange.white?.oldElo}→{g.eloChange.white?.newElo} | Black: {g.eloChange.black?.oldElo}→{g.eloChange.black?.newElo}
                    </p>
                  )}
                  {myColor && (
                    <p className={`text-xs mt-1 ${myColorClass}`}>
                      You are {myColor === 'w' ? 'White' : 'Black'}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      if (!iAmIn && isFull) {
                        onGameSelect(g.id, true);
                      } else {
                        onGameSelect(g.id);
                      }
                    }}
                    className={`min-h-[44px] px-4 py-2 text-white rounded transition touch-manipulation ${buttonClass}`}
                  >
                    {actionLabel}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
          </>
        )}

        {lobbyTab === 'leaderboard' && (
          <div className="bg-slate-800 rounded-lg p-4 sm:p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-white mb-4">Leaderboard</h2>
            <div className="space-y-2">
              {leaderboard.map((r, i) => (
                <div key={`${r.userName}-${i}`} className={`grid grid-cols-6 gap-2 rounded p-2 ${r.userName === user.userName ? 'bg-emerald-900/30' : 'bg-slate-700'}`}>
                  <div className="text-slate-300">#{i + 1}</div>
                  <div className="text-white col-span-2 truncate">{r.displayName || r.userName}</div>
                  <div className="text-cyan-300">{r.elo}</div>
                  <div><span className={`px-2 py-1 rounded text-xs ${leagueBadgeClass(r.league)}`}>{displayLeague(r.league, r.elo)}</span></div>
                  <div className="text-slate-300 text-sm">{r.wins}/{r.losses}/{r.draws} ({r.winStreak})</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} token={token} />
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
    const g = normalizeGame(await res.json());
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
    if (!game || game.status !== 'active' || !game.isBotGame) return;
    const bot = game.participants.find(p => p.isBot);
    if (!bot) return;
    if (chess.turn() !== bot.color) return;
    const timer = setTimeout(() => maybeDoBotMove(), 800);
    return () => clearTimeout(timer);
  }, [game?.id, game?.status, game?.isBotGame, board.length]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`${API_BASE}/games/${gameId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const g = normalizeGame(await res.json());
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
      if (game?.isBotGame) {
        await maybeDoBotMove();
      }
    } catch (err) {
      await loadGameFull();
    }
  };

  const evaluateBoard = (c: Chess) => {
    const vals: Record<string, number> = { p: 1, n: 3, b: 3.25, r: 5, q: 9, k: 0 };
    let score = 0;
    const board = c.board();
    for (const row of board) for (const sq of row) if (sq) score += sq.color === 'w' ? vals[sq.type] : -vals[sq.type];
    score += c.moves().length * (c.turn() === 'w' ? 0.1 : -0.1);
    return score;
  };

  const minimax = (c: Chess, depth: number, alpha: number, beta: number, maximizingWhite: boolean): number => {
    if (depth === 0 || c.isGameOver()) return evaluateBoard(c);
    const moves = c.moves({ verbose: true }) as ChessMove[];
    if (maximizingWhite) {
      let val = -Infinity;
      for (const m of moves) {
        c.move(m);
        val = Math.max(val, minimax(c, depth - 1, alpha, beta, false));
        c.undo();
        alpha = Math.max(alpha, val);
        if (beta <= alpha) break;
      }
      return val;
    }
    let val = Infinity;
    for (const m of moves) {
      c.move(m);
      val = Math.min(val, minimax(c, depth - 1, alpha, beta, true));
      c.undo();
      beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    return val;
  };

  const pickBotMove = (difficulty: string, c: Chess): ChessMove | null => {
    const moves = c.moves({ verbose: true }) as ChessMove[];
    if (!moves.length) return null;
    const turn = c.turn();
    const randomMove = () => moves[Math.floor(Math.random() * moves.length)];
    if (difficulty === 'easy') {
      const captures = moves.filter(m => !!m.captured);
      if (captures.length && Math.random() < 0.3) return captures[Math.floor(Math.random() * captures.length)];
      return randomMove();
    }
    if (difficulty === 'medium' && Math.random() < 0.2) return randomMove();
    if (difficulty === 'hard' && Math.random() < 0.05) return randomMove();
    const depth = difficulty === 'expert' ? 3 : difficulty === 'hard' ? 2 : 1;
    let best: ChessMove | null = null;
    let bestScore = turn === 'w' ? -Infinity : Infinity;
    for (const m of moves) {
      c.move(m);
      const score = minimax(c, depth - 1, -Infinity, Infinity, c.turn() === 'w');
      c.undo();
      if (turn === 'w') {
        if (score > bestScore) { bestScore = score; best = m; }
      } else {
        if (score < bestScore) { bestScore = score; best = m; }
      }
    }
    return best ?? randomMove();
  };

  const maybeDoBotMove = async () => {
    if (!game || game.status !== 'active') return;
    const bot = game.participants.find(p => p.isBot);
    if (!bot) return;
    if (chess.turn() !== bot.color) return;
    await new Promise(r => setTimeout(r, 500 + Math.floor(Math.random() * 1000)));
    const difficulty = (game.botDifficulty || 'easy').toLowerCase();
    const botMove = pickBotMove(difficulty, chess);
    if (!botMove) return;
    const after = new Chess(chess.fen());
    after.move({ from: botMove.from, to: botMove.to, promotion: botMove.promotion });
    const isCheckmate = after.isCheckmate();
    const isDraw = after.isDraw();
    const isStalemate = after.isStalemate();
    let outcome = null;
    let reason = null;
    if (isCheckmate) {
      outcome = 'checkmate';
      reason = after.turn() === 'w' ? 'Black wins' : 'White wins';
    } else if (isStalemate) {
      outcome = 'draw';
      reason = 'stalemate';
    } else if (isDraw) {
      outcome = 'draw';
      reason = 'draw';
    }
    await fetch(`${API_BASE}/games/${gameId}/bot-move`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: algebraicToIndex(botMove.from),
        to: algebraicToIndex(botMove.to),
        flags: botMove.flags,
        promotion: botMove.promotion ?? null,
        fen: after.fen(),
        outcome,
        reason
      })
    });
    await loadGameFull();
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
      <div className="min-h-screen min-h-[100dvh] bg-gradient-to-br from-slate-900 via-emerald-900 to-slate-900 flex items-center justify-center px-4">
        <p className="text-white text-xl sm:text-2xl">Loading...</p>
      </div>
    );
  }

  const showResign = game.status === 'active' && myColor && !isSpectating;

  return (
    <div className="min-h-screen min-h-[100dvh] bg-gradient-to-br from-slate-900 via-emerald-900 to-slate-900 px-3 py-4 sm:p-8 pb-[max(5rem,env(safe-area-inset-bottom,0px)+4rem)]">
      <div className="max-w-6xl mx-auto w-full min-w-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-6">
          <div className="flex items-center justify-between gap-2 sm:contents">
            <button
              onClick={onBack}
              className="px-4 py-2.5 min-h-[44px] bg-slate-700 hover:bg-slate-600 text-white rounded touch-manipulation shrink-0"
            >
              ← Back to Lobby
            </button>
            {showResign && (
              <button
                onClick={resign}
                className="sm:hidden px-4 py-2.5 min-h-[44px] bg-red-600 hover:bg-red-700 text-white rounded touch-manipulation shrink-0"
              >
                Resign
              </button>
            )}
          </div>
          <div className="bg-slate-800 rounded-lg px-4 sm:px-6 py-3 text-center w-full sm:w-auto sm:flex-1 sm:max-w-md sm:mx-auto">
            <h2 className="text-lg sm:text-2xl font-bold text-white break-all">Game {game.code}</h2>
            {(() => {
              const finished = !!game.outcome;
              const waiting = game.status === 'waiting' || game.participants.length < 2;
              const statusClass = finished ? 'text-purple-400' : waiting ? 'text-green-400' : 'text-cyan-400';
              return <p className={`text-sm ${statusClass}`}>Status: {game.status}</p>;
            })()}
          </div>
          <div className="hidden sm:flex w-[88px] justify-end shrink-0">
            {showResign && (
              <button
                onClick={resign}
                className="px-4 py-2.5 min-h-[44px] bg-red-600 hover:bg-red-700 text-white rounded touch-manipulation"
              >
                Resign
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          <div className="lg:col-span-2">
            {game.status === 'waiting' && !myColor && !isSpectating && (
              <div className="bg-slate-800 rounded-lg p-4 sm:p-6 mb-4 text-center">
                <h3 className="text-white text-lg font-semibold mb-4">Join this game?</h3>
                <button
                  onClick={() => joinGame('auto')}
                  className="min-h-[48px] px-8 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded transition touch-manipulation"
                >
                  Join Game
                </button>
                <p className="text-xs text-slate-400 mt-2">Color assigned automatically</p>
              </div>
            )}

            <div className="bg-slate-800 rounded-lg p-3 sm:p-6 w-full max-w-full min-w-0 overflow-hidden">
              <div className="chess-board-container relative w-full mx-auto aspect-square" style={{ maxWidth: 'min(100%, calc(100vh - 20rem))' }}>
                <div className={`absolute inset-0 grid grid-cols-8 grid-rows-8 gap-0 border-4 border-slate-600 ${isFlipped ? 'rotate-180' : ''}`}>
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
                        className={`min-w-0 min-h-0 flex items-center justify-center cursor-pointer relative touch-manipulation select-none
              ${isLight ? 'bg-amber-100' : 'bg-amber-800'}
              ${isSelected ? 'ring-2 sm:ring-4 ring-yellow-400 ring-inset' : ''}
              ${isCheck ? 'bg-red-500' : ''}
              hover:opacity-80 transition`}
                      >
                        {piece && (
                          <img
                            src={getPieceImage(piece)}
                            alt={`${piece.color} ${piece.type}`}
                            className={`w-[75%] h-[75%] max-w-[3rem] max-h-[3rem] object-contain ${isFlipped ? 'rotate-180' : ''}`}
                            draggable={false}
                          />
                        )}
                        {isLegalMove && (
                          <div
                            className={`absolute w-[22%] h-[22%] max-w-4 max-h-4 rounded-full ${isFlipped ? 'rotate-180' : ''} ${piece ? 'border-4 border-green-500' : 'bg-green-500 opacity-50'}`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {lastMove && (() => {
                  const fromX = (file(lastMove.from) + 0.5) * 12.5;
                  const fromY = (rank(lastMove.from) + 0.5) * 12.5;
                  const toX = (file(lastMove.to) + 0.5) * 12.5;
                  const toY = (rank(lastMove.to) + 0.5) * 12.5;

                  const dx = toX - fromX;
                  const dy = toY - fromY;
                  const distance = Math.sqrt(dx * dx + dy * dy);

                  const minMarker = 4;
                  const maxMarker = 12;
                  const markerSize = Math.min(maxMarker, Math.max(minMarker, distance / 15));

                  return (
                    <svg
                      className={`absolute inset-0 w-full h-full pointer-events-none ${isFlipped ? 'rotate-180' : ''}`}
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
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
                        strokeWidth={1.2}
                        strokeLinecap="round"
                        markerEnd="url(#arrowhead)"
                      />
                    </svg>
                  );
                })()}
              </div>
            </div>

            {promoting && (
              <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4 pb-[env(safe-area-inset-bottom,0px)]">
                <div className="bg-slate-800 rounded-lg p-4 sm:p-8 w-full max-w-sm">
                  <h3 className="text-white text-xl sm:text-2xl font-bold mb-4 sm:mb-6 text-center">Promote Pawn</h3>
                  <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
                    {(['q', 'r', 'b', 'n'] as Piece['type'][]).map(type => (
                      <button
                        key={type}
                        onClick={() => handlePromotion(type)}
                        className="bg-slate-700 hover:bg-slate-600 p-3 sm:p-4 rounded transition touch-manipulation min-w-[4.5rem] min-h-[4.5rem] flex items-center justify-center"
                        type="button"
                      >
                        <img
                          src={getPieceImage({ color: myColor!, type })}
                          alt={type}
                          className={`w-12 h-12 sm:w-16 sm:h-16 ${isFlipped ? 'rotate-180' : ''}`}
                          draggable={false}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 min-w-0">
            <div className="bg-slate-800 rounded-lg p-4 sm:p-6">
              <h3 className="text-white text-lg sm:text-xl font-semibold mb-4">Game Info</h3>
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
                      <div className="mt-2 space-y-1 text-sm">
                        {game.participants.map(p => {
                          const ec = p.color === 'w' ? game.eloChange?.white : game.eloChange?.black;
                          const delta = ec ? ec.newElo - ec.oldElo : 0;
                          const sign = delta > 0 ? '+' : '';
                          return (
                            <div key={p.color} className="flex items-center justify-between gap-2">
                              <span>{p.displayName}</span>
                              <span>{ec?.newElo ?? p.elo} <span className={delta >= 0 ? 'text-emerald-300' : 'text-red-300'}>{ec ? `(${sign}${delta})` : ''}</span></span>
                              <span className={`px-2 py-0.5 rounded text-xs ${leagueBadgeClass(ec?.league ?? p.league)}`}>{displayLeague(ec?.league ?? p.league, ec?.newElo ?? p.elo)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-4 sm:p-6">
              <h3 className="text-white text-lg sm:text-xl font-semibold mb-4">Players</h3>
              <div className="space-y-2">
                {game.participants.map((p) => (
                  <div key={p.color} className="flex items-center justify-between gap-2 text-slate-300 min-w-0">
                    <span className="font-semibold truncate">{p.displayName}</span>
                    <span className="text-cyan-300">{p.elo}</span>
                    <span className={`px-2 py-1 rounded text-xs ${leagueBadgeClass(p.league)}`}>{displayLeague(p.league, p.elo)}</span>
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

            <div className="bg-slate-800 rounded-lg p-4 sm:p-6">
              <h3 className="text-white text-lg sm:text-xl font-semibold mb-4">Move History</h3>
              <div className="max-h-48 sm:max-h-64 overflow-y-auto space-y-1 text-slate-300 text-sm sm:text-base overscroll-contain">
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

      <ChatDock token={token} user={user} onLogout={handleLogout} onMatchFound={(gameId) => { setGameId(gameId); setSpectatorMode(false); }} />
    </>
  );
}