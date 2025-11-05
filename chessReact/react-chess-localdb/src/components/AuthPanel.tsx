import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

export default function AuthPanel() {
  const { user, login, logout, register } = useAuth();
  const [email, setEmail] = useState('admin@chess.local');
  const [pwd, setPwd] = useState('Admin!123');
  const [displayName, setDisplayName] = useState('Admin');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'login'|'register'|null>(null);

  if (user) {
    return (
      <div className="flex items-center gap-3 text-sm bg-slate-800 p-2 rounded">
        <span>Signed in as <b>{user.displayName || user.userName || user.email}</b></span>
        <button
          disabled={!!busy}
          className="px-2 py-1 bg-slate-600 rounded disabled:opacity-50"
          onClick={logout}
        >
          Logout
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm bg-slate-800 p-3 rounded">
      {error && <div className="text-red-400 text-xs">{error}</div>}
      <input
        className="bg-slate-900 px-2 py-1 rounded outline-none"
        placeholder="Email"
        autoComplete="username"
        value={email}
        onChange={e=>setEmail(e.target.value)}
      />
      <input
        className="bg-slate-900 px-2 py-1 rounded outline-none"
        placeholder="Password"
        type="password"
        autoComplete="current-password"
        value={pwd}
        onChange={e=>setPwd(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          className="px-3 py-1 bg-blue-600 rounded disabled:opacity-50"
          disabled={busy === 'login'}
          onClick={async () => {
            try {
              setBusy('login'); setError('');
              await login(email, pwd);
            } catch (e: any) {
              setError(e.message || 'Login failed');
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === 'login' ? 'Logging in…' : 'Login'}
        </button>

        <input
          className="bg-slate-900 px-2 py-1 rounded outline-none flex-1"
          placeholder="Display name (reg)"
          value={displayName}
          onChange={e=>setDisplayName(e.target.value)}
        />

        <button
          className="px-3 py-1 bg-emerald-600 rounded disabled:opacity-50"
          disabled={busy === 'register'}
          onClick={async () => {
            try {
              setBusy('register'); setError('');
              await register(email, pwd, displayName);
            } catch (e: any) {
              setError(e.message || 'Registration failed');
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === 'register' ? 'Registering…' : 'Register'}
        </button>
      </div>
    </div>
  );
}
