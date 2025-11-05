
const white: Record<string, string> = { q: '♕', r: '♖', b: '♗', n: '♘' };
const black: Record<string, string> = { q: '♛', r: '♜', b: '♝', n: '♞' };

export default function PromotionModal({
  color, onSelect, onCancel
}: { color:'w'|'b'; onSelect:(c:string)=>void; onCancel:()=>void; }) {
  const set = color === 'w' ? white : black;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-slate-800 rounded-2xl p-4 min-w-[240px]">
        <div className="font-semibold mb-2">Choose promotion</div>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(set).map(([k, glyph]) => (
            <button key={k} className="text-3xl bg-slate-700 rounded-xl py-2" onClick={() => onSelect(k)}>{glyph}</button>
          ))}
        </div>
        <div className="mt-3 text-right">
          <button className="px-3 py-2 bg-slate-600 rounded-xl" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
