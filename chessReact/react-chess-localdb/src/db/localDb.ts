import { initialFEN } from '../chess/logic.ts';

const KEY = 'chess_localdb_v1';

export type GameSnapshot = {
  id: string;
  createdAt: number;
  meta: { p1: string; p2: string };
  snapshot: { fen: string };
  history: any[];
  active: boolean;
};

function loadAll(): GameSnapshot[] {
  const data = localStorage.getItem(KEY);
  return data ? JSON.parse(data) : [];
}

function saveAll(games: GameSnapshot[]) {
  localStorage.setItem(KEY, JSON.stringify(games));
}

export function createNewGame(meta: { p1: string; p2: string }): GameSnapshot {
  const g: GameSnapshot = {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : 'id-' + Math.random().toString(36).substring(2, 11),
    createdAt: Date.now(),
    meta,
    snapshot: { fen: initialFEN },
    history: [],
    active: true,
  };
  const games = loadAll().map(g => ({ ...g, active: false }));
  games.push(g);
  saveAll(games);
  return g;
}

export function dbGetActiveGame(): GameSnapshot | null {
  const games = loadAll();
  return games.find(g => g.active) || null;
}

export function dbListGames(): GameSnapshot[] {
  return loadAll().sort((a, b) => b.createdAt - a.createdAt);
}

export function dbSaveGameSnapshot(id: string, fen: string, history: any[]) {
  const games = loadAll();
  const idx = games.findIndex(g => g.id === id);
  if (idx === -1) return;
  games[idx].snapshot = { fen };
  games[idx].history = history;
  saveAll(games);
}

export function dbApplyMove(id: string, moveRecord: any) {
  const games = loadAll();
  const idx = games.findIndex(g => g.id === id);
  if (idx === -1) return;
  const g = games[idx];
  g.history.push(moveRecord);
  g.snapshot.fen = moveRecord.fen;
  games.forEach(x => (x.active = false));
  g.active = true;
  games[idx] = g;
  saveAll(games);
}

export function dbResign(id: string, color: 'w' | 'b') {
  const games = loadAll();
  const idx = games.findIndex(g => g.id === id);
  if (idx === -1) return;
  const g = games[idx];
  g.snapshot.fen = g.snapshot.fen + ` resigned:${color}`;
  saveAll(games);
}

export function dbDeleteGame(id: string) {
  let games = loadAll();
  games = games.filter(g => g.id !== id);
  saveAll(games);
}
