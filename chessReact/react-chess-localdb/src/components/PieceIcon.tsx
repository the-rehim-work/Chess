
type PieceColor = 'w' | 'b';
type PieceType = 'p' | 'r' | 'n' | 'b' | 'q' | 'k';

export default function PieceIcon({
  color,
  type,
  size = 48,
}: {
  color: PieceColor;
  type: PieceType;
  size?: number;
}) {
  const src = `/icons/${type === 'p' ? 'pawn' :
    type === 'r' ? 'rook' :
    type === 'n' ? 'knight' :
    type === 'b' ? 'bishop' :
    type === 'q' ? 'queen' : 'king'}_${color}.svg`;

  return (
    <img
      src={src}
      alt={`${color === 'w' ? 'White' : 'Black'} ${type}`}
      width={size}
      height={size}
      draggable={false}
      className="pointer-events-none select-none"
    />
  );
}
