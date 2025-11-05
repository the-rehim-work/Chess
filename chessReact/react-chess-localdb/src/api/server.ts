import * as signalR from '@microsoft/signalr';
import { api, API_BASE } from './http';

export async function createGame() {
  const res = await api.post('/api/games', { fen: null });
  return res.data;
}
export async function getGame(id: string) {
  const res = await api.get(`/api/games/${id}`);
  return res.data;
}
export async function getGameByCode(code: string) {
  const res = await api.get(`/api/games/by-code/${encodeURIComponent(code)}`);
  return res.data;
}
export async function joinGame(id: string, color: 'w'|'b') {
  const res = await api.post(`/api/games/${id}/join?color=${color}`);
  return res.data;
}
export async function postMove(id: string, dto: {
  from: number; to: number; flags?: string|null; promotion?: string|null;
  fen: string; outcome?: string|null; reason?: string|null;
}) {
  const res = await api.post(`/api/games/${id}/move`, dto);
  return res.data;
}
export async function resign(id: string, color: 'w'|'b') {
  const res = await api.post(`/api/games/${id}/resign?color=${color}`);
  return res.data;
}
export async function undo(id: string) {
  const res = await api.post(`/api/games/${id}/undo`);
  return res.data;
}
export async function getUserGames() {
  const res = await api.get('/api/games/user');
  return res.data;
}
export async function getWaitingGames() {
  const res = await api.get('/api/games/waiting');
  return res.data;
}

export function connectHub(gameId: string, onUpdate: (payload: any) => void) {
  const conn = new signalR.HubConnectionBuilder()
    .withUrl(`${API_BASE}/hubs/game`, {
      accessTokenFactory: () => localStorage.getItem('jwt') || ''
    })
    .withAutomaticReconnect()
    .build();

  conn.on('game:update', onUpdate);
  conn.start()
    .then(() => conn.invoke('JoinGame', gameId))
    .catch((e) => console.error('Hub start error:', e));

  return conn;
}
