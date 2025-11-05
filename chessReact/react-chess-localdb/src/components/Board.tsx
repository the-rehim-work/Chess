import React from 'react';
import clsx from 'clsx';

type Piece = { color: 'w'|'b'; type: 'p'|'r'|'n'|'b'|'q'|'k' };
type Props = {
  board: (Piece | null)[];
  selected: number | null;
  legalTargets: { to: number }[];
  onSquareClick: (i: number) => void;
  flip?: boolean;
};

const files = ['a','b','c','d','e','f','g','h'];

export default function Board({ board, selected, legalTargets, onSquareClick, flip }: Props) {
  const legalSet = new Set(legalTargets.map(m => m.to));
  const squares = [...Array(64).keys()];
  const order = flip ? [...squares].reverse() : squares;

  return (
    <div className="relative">
      {/* Theme tokens */}
      <style>{`
        :root{
          --sq-dark: #2b3645;      /* deep slate */
          --sq-light:#c7d2e0;      /* cool-light steel */
          --sq-dark-hi:#334155;    /* hover */
          --sq-light-hi:#d7e0ea;
          --sel-ring:#ffd54a;      /* amber */
          --move-dot:#10b981;      /* emerald */
        }
      `}</style>

      <div className="grid grid-cols-8 border-2 border-slate-700 rounded-2xl overflow-hidden shadow-xl">
        {order.map((visualIndex) => {
          const i = flip ? 63 - visualIndex : visualIndex;
          const r = Math.floor(i / 8);
          const f = i % 8;
          const dark = (r + f) % 2 === 1;

          const isSel  = selected === i;
          const isHint = legalSet.has(i);

          const sqBase = dark
            ? 'bg-[var(--sq-dark)]'
            : 'bg-[var(--sq-light)]';

          const sqHover = dark
            ? 'hover:bg-[var(--sq-dark-hi)]'
            : 'hover:bg-[var(--sq-light-hi)]';

          return (
            <button
              key={i}
              onClick={() => onSquareClick(i)}
              className={clsx(
                'relative aspect-square select-none focus:outline-none',
                sqBase, sqHover
              )}
            >
              {/* subtle inner gradient & border for “solid but alive” */}
              <div className="absolute inset-0 pointer-events-none">
                <div className={clsx(
                  'w-full h-full',
                  dark
                    ? 'bg-gradient-to-br from-white/0 via-white/0 to-white/5'
                    : 'bg-gradient-to-br from-white/40 via-white/10 to-white/0'
                )}/>
                <div className={clsx(
                  'absolute inset-0 ring-1',
                  dark ? 'ring-white/5' : 'ring-black/10'
                )}/>
              </div>

              {/* selection ring */}
              {isSel && (
                <div className="absolute inset-1 rounded-xl ring-2 ring-[var(--sel-ring)] shadow-[0_0_0_2px_rgba(0,0,0,0.25)]"/>
              )}

              {/* legal move dots */}
              {isHint && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full bg-[var(--move-dot)] opacity-80 shadow"/>
                </div>
              )}

              {/* piece */}
              <div className="absolute inset-0 flex items-center justify-center text-2xl">
                {renderPiece(board[i])}
              </div>

              {/* coords (bottom-left corner squares) */}
              {f === 0 && (
                <div className={clsx(
                  "absolute left-1 bottom-1 text-[10px] font-mono",
                  dark ? "text-white/60" : "text-black/60"
                )}>{8 - r}</div>
              )}
              {r === 7 && (
                <div className={clsx(
                  "absolute right-1 top-1 text-[10px] font-mono",
                  dark ? "text-white/60" : "text-black/60"
                )}>{files[f]}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function renderPiece(p?: Piece | null) {
  if (!p) return null;
  // Simple glyph set; swap for SVGs later if you want.
  const map: Record<Piece['type'], string> = {
    p:'♟', r:'♜', n:'♞', b:'♝', q:'♛', k:'♚'
  };
  const glyph = map[p.type];
  return (
    <span className={clsx(
      'drop-shadow',
      p.color === 'w' ? 'text-white' : 'text-slate-900'
    )}>{glyph}</span>
  );
}
