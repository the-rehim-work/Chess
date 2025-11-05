
export default function MoveList({ moves }: { moves: any[] }) {
  const pairs: any[] = [];
  for (let i = 0; i < moves.length; i += 2) pairs.push([moves[i], moves[i + 1]]);
  return (
    <div className="bg-slate-800 rounded-2xl p-3 shadow max-h-[640px] overflow-auto">
      <div className="text-sm font-semibold mb-2">Move History</div>
      <ol className="space-y-1">
        {pairs.map((pair, i) => (
          <li key={i} className="grid grid-cols-[24px_1fr] gap-2 items-start">
            <span className="text-slate-400">{i + 1}.</span>
            <div className="flex gap-3">
              <span>{formatMove(pair[0])}</span>
              <span>{pair[1] ? formatMove(pair[1]) : ''}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function formatMove(m: any) {
  if (!m) return '';
  const base = m.san || `${m.piece?.type?.toUpperCase() === 'P' ? '' : m.piece?.type?.toUpperCase() || ''}${m.captured ? 'x' : ''}`;
  return base || '…';
}
