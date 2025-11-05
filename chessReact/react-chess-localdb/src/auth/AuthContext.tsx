/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { UserInfo } from './authService';
import { isTokenValid, logoutSoft, me as apiMe, login as apiLogin, register as apiRegister } from './authService';

type AuthCtx = {
  user: UserInfo | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // bootstrap
  useEffect(() => {
    (async () => {
      try {
        if (!isTokenValid()) { setUser(null); return; }
        const u = await apiMe();
        setUser(u);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const { user } = await apiLogin(email, password);
    setUser(user);
  };

  const register = async (email: string, password: string, displayName?: string) => {
    const u = await apiRegister(email, password, displayName);
    setUser(u);
  };

  const logout = () => {
    logoutSoft();
    setUser(null);
    // Clear game URL on logout
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    window.history.replaceState({}, '', url.toString());
  };

  const value = useMemo<AuthCtx>(() => ({ user, loading, login, register, logout }), [user, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
