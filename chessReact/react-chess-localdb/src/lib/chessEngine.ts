import { Chess, type Move, type Square } from 'chess.js';

export type Promotion = 'q'|'r'|'b'|'n';

export function idxToSq(i: number): Square {
  const f = 'abcdefgh'[i % 8];
  const r = 8 - Math.floor(i / 8);
  return `${f}${r}` as Square;
}

export function sqToIdx(sq: string): number {
  const f = sq.charCodeAt(0) - 97; // a->0
  const r = 8 - Number(sq[1]);
  return r * 8 + f;
}

export class ChessEngine {
  private game: Chess;

  constructor(fen?: string) {
    this.game = new Chess(fen);
  }

  loadFen(fen?: string) {
    this.game = new Chess(fen);
  }

  fen(): string { return this.game.fen(); }
  turn(): 'w'|'b' { return this.game.turn(); }

  legalFrom(index?: number) {
    if (index == null) return this.game.moves({ verbose: true }) as Move[];
    return this.game.moves({ square: idxToSq(index), verbose: true }) as Move[];
  }

  tryMove(fromIdx: number, toIdx: number, promotion?: Promotion) {
    const res = this.game.move({ from: idxToSq(fromIdx), to: idxToSq(toIdx), promotion });
    return res ? this.snapshot() : null;
  }

  snapshot() {
    return {
      fen: this.game.fen(),
      inCheck:  this.game.inCheck(),
      inMate:   this.game.isCheckmate(),
      inStale:  this.game.isStalemate(),
      inDraw:   this.game.isDraw(),
      threeRep: this.game.isThreefoldRepetition(),
      insuff:   this.game.isInsufficientMaterial(),
      turn:     this.game.turn(),
      moveNum:  (this.game as any).moveNumber ?? 0,
    };
  }
}
