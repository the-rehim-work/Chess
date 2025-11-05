import PieceIcon from './PieceIcon.tsx';

export default function Square({
  idx, piece, dark, isSelected, moveHere, onClick, flip = false
}: { idx:number; piece:any; dark:boolean; isSelected:boolean; moveHere:boolean; onClick:()=>void; flip?: boolean; }) {
  const squareBg = dark ? 'bg-[#769656]' : 'bg-[#EEEED2]';
  const ring = isSelected ? 'ring-3 ring-cyan-500/45 ring-offset-0' : '';
  const moveDot = moveHere && !piece
    ? "after:content-[''] after:absolute after:w-3 after:h-3 after:rounded-full after:bg-cyan-400/45"
    : '';
  const captureOverlay = moveHere && piece
    ? "after:content-[''] after:absolute after:inset-[10%] after:rounded-md after:bg-cyan-400/20"
    : '';

  return (
    <button
      onClick={onClick}
      className={[
        'relative aspect-square w-full flex items-center justify-center select-none transition-shadow',
        squareBg, ring, moveDot, captureOverlay,
        flip ? 'rotate-180' : '',
      ].join(' ')}
      aria-label={`square-${idx}`}
    >
      {piece && (
        <PieceIcon color={piece.color} type={piece.type} size={52} />
      )}
    </button>
  );
}
