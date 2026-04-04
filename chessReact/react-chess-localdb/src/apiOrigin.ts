const defaultOrigin =
  import.meta.env.DEV ? 'http://localhost:5082' : 'http://api-chess.runasp.net';
const origin = (import.meta.env.VITE_API_BASE ?? defaultOrigin).replace(/\/$/, '');
export const API_BASE = `${origin}/api`;
export const CHAT_HUB_URL = `${origin}/hubs/chat`;
