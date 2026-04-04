const origin = (import.meta.env.VITE_API_BASE ?? 'http://api-chess.runasp.net').replace(/\/$/, '');
export const API_BASE = `${origin}/api`;
export const CHAT_HUB_URL = `${origin}/hubs/chat`;
