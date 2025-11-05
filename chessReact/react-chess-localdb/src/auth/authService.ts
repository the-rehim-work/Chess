import { api } from '../api/http';
import { jwtDecode } from 'jwt-decode';

export type UserInfo = {
  id: string;
  userName: string;
  email: string;
  displayName: string;
  roles?: string[];
};

function saveToken(token: string) { localStorage.setItem('jwt', token); }
export function clearToken() { localStorage.removeItem('jwt'); }
export function getToken() { return localStorage.getItem('jwt'); }

export function isTokenValid(): boolean {
  const t = getToken();
  if (!t) return false;
  try {
    const d: any = jwtDecode(t);
    if (!d?.exp) return true;
    return d.exp * 1000 > Date.now();
  } catch { return false; }
}

export async function register(email: string, password: string, displayName?: string): Promise<UserInfo> {
  await api.post('/api/auth/register', { email, password, displayName });
  const { user } = await login(email, password);
  return user;
}

export async function login(email: string, password: string): Promise<{ token: string; user: UserInfo }> {
  const res = await api.post('/api/auth/login', { email, password });
  const { token, user } = res.data as { token: string; user: UserInfo };
  saveToken(token);
  return { token, user };
}

export async function me(): Promise<UserInfo> {
  const res = await api.get('/api/auth/me');
  return res.data as UserInfo;
}

export function logoutSoft() { clearToken(); }
