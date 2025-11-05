
export default function Controls({
  games, activeGame, onNewGame, onUndo, onResign, onLoadGame, onDeleteGame
}: {
  games:any[]; activeGame:any; onNewGame:(o?:any)=>void; onUndo:()=>void; onResign:(c:'w'|'b')=>void; onLoadGame:(g:any)=>void; onDeleteGame:(id:string)=>void;
}) {
  return (
    <div className="mt-4 bg-slate-800 rounded-2xl p-3 shadow">
      <div className="flex flex-wrap gap-2">
        <button className="px-3 py-2 bg-emerald-600 rounded-xl" onClick={() => onNewGame({ p1: 'White', p2: 'Black' })}>New Game</button>
        <button className="px-3 py-2 bg-sky-600 rounded-xl" onClick={onUndo}>Undo</button>
        <button className="px-3 py-2 bg-rose-600 rounded-xl" onClick={() => onResign(activeGame?.snapshot?.turn || 'w')}>Resign Current Side</button>
      </div>
      <div className="mt-3">
        <div className="text-sm font-semibold mb-1">Saved Games</div>
        <div className="space-y-2">
          {games.map((g:any) => (
            <div key={g.id} className={`flex items-center justify-between rounded-xl px-3 py-2 ${g.id === activeGame?.id ? 'bg-slate-700' : 'bg-slate-900'}`}>
              <div className="text-sm">
                <div className="font-semibold">{g.meta.p1} vs {g.meta.p2}</div>
                <div className="opacity-70 text-xs">{new Date(g.createdAt).toLocaleString()} · ID {g.id.slice(-6)}</div>
              </div>
              <div className="flex gap-2">
                <button className="px-2 py-1 bg-slate-600 rounded-lg" onClick={() => onLoadGame(g)}>Load</button>
                <button className="px-2 py-1 bg-rose-700 rounded-lg" onClick={() => onDeleteGame(g.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
