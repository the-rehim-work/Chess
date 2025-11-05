import { useState } from 'react';

export default function TokenBar() {
  const [t, setT] = useState(localStorage.getItem('jwt') || '');
  function save() {
    localStorage.setItem('jwt', t.trim());
    alert('JWT set');
  }
  function clear() {
    localStorage.removeItem('jwt');
    setT('');
    alert('JWT cleared');
  }
  return (
    <div className="flex gap-2 items-center text-xs bg-slate-800 p-2 rounded">
      <input className="flex-1 bg-slate-900 px-2 py-1 rounded outline-none" placeholder="Paste JWT"
             value={t} onChange={e=>setT(e.target.value)} />
      <button className="px-2 py-1 bg-blue-600 rounded" onClick={save}>Set</button>
      <button className="px-2 py-1 bg-slate-600 rounded" onClick={clear}>Clear</button>
    </div>
  );
}
