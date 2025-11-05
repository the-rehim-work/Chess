/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable prefer-const */

// ───────────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────────
export type PieceColor = 'w' | 'b';
export type PieceType = 'p' | 'r' | 'n' | 'b' | 'q' | 'k';
export type Board = (Piece | null)[];
export interface Piece { color: PieceColor; type: PieceType; }
export interface GameState {
  turn: PieceColor;
  // Castling rights: e.g. "KQkq" subset; empty string = none
  castling: string;
  // En-passant target square index or null (square *behind* the pawn that moved 2)
  ep: number | null;
  // 50-move rule: halfmoves since last capture or pawn move
  halfmove: number;
  // Fullmove number (starts at 1 and increments after Black’s move)
  fullmove: number;
}
export interface Move {
  from: number;
  to: number;
  captured?: Piece | null;
  promotion?: PieceType | null;
  flags?: string; // 'promo' | 'castle-k' | 'castle-q' | 'ep'
  san?: string;
}

// ───────────────────────────────────────────────────────────────────────────────
// Start position / FEN
// Castling and ep/clock fields included (FIDE style)
// ───────────────────────────────────────────────────────────────────────────────
export const initialFEN =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────
const KNIGHT = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING = [
  [1,0], [-1,0], [0,1], [0,-1], [1,1], [-1,1], [1,-1], [-1,-1],
];
const ROOK_DIR = [[1,0], [-1,0], [0,1], [0,-1]];
const BISHOP_DIR = [[1,1], [-1,1], [1,-1], [-1,-1]];
const QUEEN_DIR = [...ROOK_DIR, ...BISHOP_DIR];

function onBoard(r: number, f: number) { return r >= 0 && r < 8 && f >= 0 && f < 8; }
function idx(r: number, f: number) { return r * 8 + f; }
function rank(i: number) { return Math.floor(i / 8); }
function file(i: number) { return i % 8; }

function cloneBoard(b: Board): Board { return b.slice(); }

function colorOpp(c: PieceColor): PieceColor { return c === 'w' ? 'b' : 'w'; }

function removeCastlingRight(castling: string, right: 'K'|'Q'|'k'|'q') {
  return castling.replace(right, '');
}

// Key used for repetition (position identity)
// Includes placement + turn + castling + ep (NOT half/full move clocks)
export function positionKey(board: Board, s: GameState): string {
  let rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let empty = 0, row = '';
    for (let f = 0; f < 8; f++) {
      const p = board[idx(r,f)];
      if (!p) empty++;
      else {
        if (empty) { row += empty; empty = 0; }
        row += p.color === 'w' ? p.type.toUpperCase() : p.type;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const epStr = s.ep == null ? '-' : algebraicOfIndex(s.ep);
  return `${rows.join('/')}_${s.turn}_${s.castling || '-'}_${epStr}`;
}

export function algebraicOfIndex(i: number) {
  const files = 'abcdefgh';
  return files[file(i)] + (8 - rank(i));
}

function indexOfAlgebraic(square: string): number | null {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const f = square.charCodeAt(0) - 97;
  const r = 8 - Number(square[1]);
  return idx(r, f);
}

function isOpponentKing(p?: Piece | null): boolean {
  return !!p && p.type === 'k';
}

// ───────────────────────────────────────────────────────────────────────────────
// FEN I/O
// ───────────────────────────────────────────────────────────────────────────────
export function parseFEN(fen: string): { board: Board; state: GameState } {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const rows = placement.split('/');
  const board: Board = [];
  for (const row of rows) {
    for (const ch of row) {
      if (/\d/.test(ch)) {
        const n = Number(ch);
        for (let i = 0; i < n; i++) board.push(null);
      } else {
        const color: PieceColor = ch === ch.toUpperCase() ? 'w' : 'b';
        board.push({ color, type: ch.toLowerCase() as PieceType });
      }
    }
  }
  const s: GameState = {
    turn: (turn as PieceColor) || 'w',
    castling: castling === '-' ? '' : castling,
    ep: ep === '-' ? null : (indexOfAlgebraic(ep) as number | null),
    halfmove: Number(half) || 0,
    fullmove: Number(full) || 1,
  };
  return { board, state: s };
}

export function boardToFEN(board: Board, s: GameState): string {
  const rows: string[] = [];
  for (let r = 0; r < 8; r++) {
    let empty = 0, row = '';
    for (let f = 0; f < 8; f++) {
      const p = board[idx(r,f)];
      if (!p) empty++;
      else {
        if (empty) { row += empty; empty = 0; }
        row += p.color === 'w' ? p.type.toUpperCase() : p.type;
      }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const cast = s.castling.length ? s.castling : '-';
  const epStr = s.ep == null ? '-' : algebraicOfIndex(s.ep);
  return `${rows.join('/')} ${s.turn} ${cast} ${epStr} ${s.halfmove} ${s.fullmove}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Attack detection (for check / castling legality)
// ───────────────────────────────────────────────────────────────────────────────
function squareAttackedBy(board: Board, sq: number, attacker: PieceColor): boolean {
  // Knights
  for (const [dr, df] of KNIGHT) {
    const r = rank(sq) + dr, f = file(sq) + df;
    if (!onBoard(r,f)) continue;
    const p = board[idx(r,f)];
    if (p && p.color === attacker && p.type === 'n') return true;
  }
  // Kings
  for (const [dr, df] of KING) {
    const r = rank(sq) + dr, f = file(sq) + df;
    if (!onBoard(r,f)) continue;
    const p = board[idx(r,f)];
    if (p && p.color === attacker && p.type === 'k') return true;
  }
  // Sliding: rooks/queens (orthogonal)
  for (const [dr, df] of ROOK_DIR) {
    let r = rank(sq) + dr, f = file(sq) + df;
    while (onBoard(r,f)) {
      const p = board[idx(r,f)];
      if (p) {
        if (p.color === attacker && (p.type === 'r' || p.type === 'q')) return true;
        break;
      }
      r += dr; f += df;
    }
  }
  // Sliding: bishops/queens (diagonal)
  for (const [dr, df] of BISHOP_DIR) {
    let r = rank(sq) + dr, f = file(sq) + df;
    while (onBoard(r,f)) {
      const p = board[idx(r,f)];
      if (p) {
        if (p.color === attacker && (p.type === 'b' || p.type === 'q')) return true;
        break;
      }
      r += dr; f += df;
    }
  }
  // Pawns
  const dir = attacker === 'w' ? -1 : 1;
  for (const df of [-1, 1]) {
    const r = rank(sq) + dir, f = file(sq) + df;
    if (!onBoard(r,f)) continue;
    const p = board[idx(r,f)];
    if (p && p.color === attacker && p.type === 'p') return true;
  }
  return false;
}

export function inCheck(board: Board, _state: GameState, color: PieceColor) {
  // find king
  let kingSq = -1;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.color === color && p.type === 'k') { kingSq = i; break; }
  }
  if (kingSq === -1) return false; // malformed, treat as not in check
  return squareAttackedBy(board, kingSq, colorOpp(color));
}

// ───────────────────────────────────────────────────────────────────────────────
// Move gen (pseudo-legal), then filter out self-check
// Includes: pawn 1/2 push, diag captures, promo flag; knight/king; sliding pieces;
// castling (K/Q) with all FIDE checks; en passant generation + self-check filter.
// ───────────────────────────────────────────────────────────────────────────────
function slide(board: Board, from: number, color: PieceColor, dirs: number[][]): Move[] {
  const r0 = rank(from), f0 = file(from);
  const res: Move[] = [];
  for (const [dr, df] of dirs) {
    let r = r0 + dr, f = f0 + df;
    while (onBoard(r,f)) {
      const i = idx(r,f);
      const t = board[i];
      if (!t) {
        res.push({ from, to: i });
      } else {
        if (t.color !== color && !isOpponentKing(t)) {
          res.push({ from, to: i, captured: t });
        }
        break;
      }
      r += dr; f += df;
    }
  }
  return res;
}

export function getPseudoLegalMoves(board: Board, s: GameState, index: number): Move[] {
  const p = board[index];
  if (!p) return [];
  if (p.color !== s.turn) return [];
  const r = rank(index), f = file(index);
  const moves: Move[] = [];

  switch (p.type) {
    case 'p': {
      const dir = p.color === 'w' ? -1 : 1;
      const startRank = p.color === 'w' ? 6 : 1;
      const lastRank = p.color === 'w' ? 0 : 7;

      // One step
      const r1 = r + dir, f1 = f;
      if (onBoard(r1,f1) && !board[idx(r1,f1)]) {
        const to = idx(r1,f1);
        const m: Move = { from: index, to };
        if (r1 === lastRank) m.flags = 'promo';
        moves.push(m);

        // Two steps
        if (r === startRank) {
          const r2 = r + 2*dir;
          if (onBoard(r2,f1) && !board[idx(r2,f1)]) {
            moves.push({ from: index, to: idx(r2,f1) });
          }
        }
      }
      // Captures
      for (const df of [-1, 1]) {
        const rc = r + dir, fc = f + df;
        if (!onBoard(rc,fc)) continue;
        const ti = idx(rc,fc);
        const t = board[ti];
        if (t && t.color !== p.color && !isOpponentKing(t)) {
          const m: Move = { from: index, to: ti, captured: t };
          if (rc === lastRank) m.flags = 'promo';
          moves.push(m);
        }
      }
      // En passant capture (if s.ep is set and is the capture square)
      if (s.ep != null) {
        const er = rank(s.ep), ef = file(s.ep);
        if (er === r + dir && Math.abs(ef - f) === 1) {
          moves.push({ from: index, to: s.ep, flags: 'ep', captured: { color: colorOpp(p.color), type: 'p' } });
        }
      }
      break;
    }

    case 'n': {
      for (const [dr, df] of KNIGHT) {
        const nr = r + dr, nf = f + df;
        if (!onBoard(nr,nf)) continue;
        const t = board[idx(nr,nf)];
        if (!t || (t.color !== p.color && !isOpponentKing(t))) moves.push({ from: index, to: idx(nr,nf), captured: t || undefined });
      }
      break;
    }

    case 'b': moves.push(...slide(board, index, p.color, BISHOP_DIR)); break;
    case 'r': moves.push(...slide(board, index, p.color, ROOK_DIR)); break;
    case 'q': moves.push(...slide(board, index, p.color, QUEEN_DIR)); break;

    case 'k': {
      for (const [dr, df] of KING) {
        const nr = r + dr, nf = f + df;
        if (!onBoard(nr,nf)) continue;
        const t = board[idx(nr,nf)];
        if (!t || (t.color !== p.color && !isOpponentKing(t))) moves.push({ from: index, to: idx(nr,nf), captured: t || undefined });
      }
      // Castling
      if (p.color === 'w' && r === 7 && f === 4) {
        // White king-side (e1 to g1) if rights include 'K'
        if (s.castling.includes('K')) {
          if (!board[idx(7,5)] && !board[idx(7,6)]) {
            // Not in check, and squares f1,g1 not attacked
            if (!inCheck(board, s, 'w') &&
                !squareAttackedBy(board, idx(7,5), 'b') &&
                !squareAttackedBy(board, idx(7,6), 'b')) {
              moves.push({ from: index, to: idx(7,6), flags: 'castle-k' });
            }
          }
        }
        // White queen-side (e1 to c1) if rights include 'Q'
        if (s.castling.includes('Q')) {
          if (!board[idx(7,3)] && !board[idx(7,2)] && !board[idx(7,1)]) {
            if (!inCheck(board, s, 'w') &&
                !squareAttackedBy(board, idx(7,3), 'b') &&
                !squareAttackedBy(board, idx(7,2), 'b')) {
              moves.push({ from: index, to: idx(7,2), flags: 'castle-q' });
            }
          }
        }
      }
      if (p.color === 'b' && r === 0 && f === 4) {
        if (s.castling.includes('k')) {
          if (!board[idx(0,5)] && !board[idx(0,6)]) {
            if (!inCheck(board, s, 'b') &&
                !squareAttackedBy(board, idx(0,5), 'w') &&
                !squareAttackedBy(board, idx(0,6), 'w')) {
              moves.push({ from: index, to: idx(0,6), flags: 'castle-k' });
            }
          }
        }
        if (s.castling.includes('q')) {
          if (!board[idx(0,3)] && !board[idx(0,2)] && !board[idx(0,1)]) {
            if (!inCheck(board, s, 'b') &&
                !squareAttackedBy(board, idx(0,3), 'w') &&
                !squareAttackedBy(board, idx(0,2), 'w')) {
              moves.push({ from: index, to: idx(0,2), flags: 'castle-q' });
            }
          }
        }
      }
      break;
    }
  }
  return moves;
}

export function getLegalMoves(board: Board, s: GameState, index: number): Move[] {
  const pseudo = getPseudoLegalMoves(board, s, index);
  const res: Move[] = [];
  for (const m of pseudo) {
    const { board: nb, state: ns } = makeMove(board, s, m, /*skipLegalGuard*/ true);
    // 1) Your own king must not be in check after move
    if (inCheck(nb, ns, s.turn)) continue;
    // 2) Opponent king must still exist (no “capture the king” nonsense)
    const opp = ns.turn; // ns.turn has already flipped → opponent of mover
    if (!hasKing(nb, opp)) continue;
    res.push(m);
  }
  return res;
}

function hasKing(board: Board, color: PieceColor): boolean {
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (p && p.color === color && p.type === 'k') return true;
  }
  return false;
}

// ───────────────────────────────────────────────────────────────────────────────
// Apply move: updates board + state fully (castling, ep, clocks, promotion)
// skipLegalGuard=true is used only for move filtering (we don’t double-check there)
// ───────────────────────────────────────────────────────────────────────────────
export function makeMove(
  board: Board,
  state: GameState,
  move: Move,
  skipLegalGuard = false
): { board: Board; state: GameState } {
  const b = cloneBoard(board);
  const s: GameState = { ...state };

  const moving = b[move.from];
  if (!moving) return { board, state };

  // Reset EP by default
  s.ep = null;

  // Update halfmove clock
  const isPawnMove = moving.type === 'p';
  const isCapture = !!move.captured || move.flags === 'ep';
  s.halfmove = (isPawnMove || isCapture) ? 0 : s.halfmove + 1;

  // Move piece baseline
  b[move.to] = { ...moving };
  b[move.from] = null;

  // Promotion
  if (move.promotion) {
    b[move.to] = { color: moving.color, type: move.promotion };
  }

  // En passant actual capture remove
  if (move.flags === 'ep') {
    const dir = moving.color === 'w' ? 1 : -1; // captured pawn is behind the target square
    const capSq = move.to + dir * 8;
    b[capSq] = null;
  }

  // Two-square pawn push → set EP target
  if (moving.type === 'p' && Math.abs(move.to - move.from) === 16) {
    // EP target is the square passed over
    s.ep = (move.to + move.from) / 2;
  }

  // Castling rook move + remove castling rights accordingly
  // Also: any king move removes that side’s KQ; any rook move removes that rook’s right
  const fromR = rank(move.from), fromF = file(move.from);
  const toR = rank(move.to), toF = file(move.to);

  if (moving.type === 'k') {
    // Remove rights for that color
    if (moving.color === 'w') { s.castling = removeCastlingRight(removeCastlingRight(s.castling, 'K'), 'Q'); }
    else { s.castling = removeCastlingRight(removeCastlingRight(s.castling, 'k'), 'q'); }

    // Rook reposition for castle
    if (move.flags === 'castle-k') {
      // king to g-file; rook h-file to f-file
      if (moving.color === 'w') { b[idx(7,5)] = b[idx(7,7)]; b[idx(7,7)] = null; }
      else { b[idx(0,5)] = b[idx(0,7)]; b[idx(0,7)] = null; }
    }
    if (move.flags === 'castle-q') {
      // king to c-file; rook a-file to d-file
      if (moving.color === 'w') { b[idx(7,3)] = b[idx(7,0)]; b[idx(7,0)] = null; }
      else { b[idx(0,3)] = b[idx(0,0)]; b[idx(0,0)] = null; }
    }
  }

  // Rook move from initial squares removes that side’s specific right
  if (moving.type === 'r') {
    if (fromR === 7 && fromF === 0) s.castling = removeCastlingRight(s.castling, 'Q');
    if (fromR === 7 && fromF === 7) s.castling = removeCastlingRight(s.castling, 'K');
    if (fromR === 0 && fromF === 0) s.castling = removeCastlingRight(s.castling, 'q');
    if (fromR === 0 && fromF === 7) s.castling = removeCastlingRight(s.castling, 'k');
  }

  // If a rook is captured on its original square, remove that right
  if (isCapture) {
    if (toR === 7 && toF === 0) s.castling = removeCastlingRight(s.castling, 'Q');
    if (toR === 7 && toF === 7) s.castling = removeCastlingRight(s.castling, 'K');
    if (toR === 0 && toF === 0) s.castling = removeCastlingRight(s.castling, 'q');
    if (toR === 0 && toF === 7) s.castling = removeCastlingRight(s.castling, 'k');
  }

  // Turn and fullmove
  s.turn = colorOpp(s.turn);
  if (s.turn === 'w') s.fullmove += 1;

  if (!skipLegalGuard) {
    // Guard against illegal (self-check) if called externally by mistake
    if (inCheck(b, s, colorOpp(s.turn))) {
      return { board, state }; // reject
    }
  }

  return { board: b, state: s };
}

// ───────────────────────────────────────────────────────────────────────────────
// Outcome detection
// - checkmate / stalemate
// - 50-move rule
// - repetition (need positions map from outside or history with FEN/keys)
// - insufficient material
// ───────────────────────────────────────────────────────────────────────────────
function hasLegalMove(board: Board, s: GameState): boolean {
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p || p.color !== s.turn) continue;
    const moves = getLegalMoves(board, s, i);
    if (moves.length) return true;
  }
  return false;
}

export function insufficientMaterial(board: Board): boolean {
  // Count pieces
  let wB = 0, bB = 0, wN = 0, bN = 0, wR = 0, bR = 0, wQ = 0, bQ = 0, wP = 0, bP = 0;
  const bishopsSquares: { w: number[], b: number[] } = { w: [], b: [] };

  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p) continue;
    if (p.type === 'p') { p.color === 'w' ? wP++ : bP++; }
    if (p.type === 'r') { p.color === 'w' ? wR++ : bR++; }
    if (p.type === 'q') { p.color === 'w' ? wQ++ : bQ++; }
    if (p.type === 'n') { p.color === 'w' ? wN++ : bN++; }
    if (p.type === 'b') {
      if (p.color === 'w') { wB++; bishopsSquares.w.push(i); }
      else { bB++; bishopsSquares.b.push(i); }
    }
  }

  // Any pawn/rook/queen present → mating material exists
  if (wP || bP || wR || bR || wQ || bQ) return false;

  // K vs K
  if (wB === 0 && bB === 0 && wN === 0 && bN === 0) return true;

  // K+B vs K or K+N vs K
  if ((wB === 1 && wN === 0 && bB === 0 && bN === 0) ||
      (wN === 1 && wB === 0 && bB === 0 && bN === 0) ||
      (bB === 1 && bN === 0 && wB === 0 && wN === 0) ||
      (bN === 1 && bB === 0 && wB === 0 && wN === 0)) return true;

  // K+B vs K+B with same-colored bishops
  if (wB === 1 && bB === 1 && wN === 0 && bN === 0) {
    const wb = bishopsSquares.w[0], bb = bishopsSquares.b[0];
    const wbDark = (rank(wb) + file(wb)) % 2 === 1;
    const bbDark = (rank(bb) + file(bb)) % 2 === 1;
    if (wbDark === bbDark) return true;
  }

  return false;
}

export function detectOutcome(board: Board, s: GameState, repetitionCount?: Record<string, number>) {
  // Checkmate / Stalemate
  const side = s.turn;
  const legal = hasLegalMove(board, s);
  const check = inCheck(board, s, side);

  if (!legal) {
    if (check) return { outcome: 'checkmate', reason: side === 'w' ? 'Black wins' : 'White wins' };
    return { outcome: 'draw', reason: 'stalemate' };
  }

  // 50-move rule
  if (s.halfmove >= 100) {
    return { outcome: 'draw', reason: '50-move rule' };
  }

  // Insufficient material
  if (insufficientMaterial(board)) {
    return { outcome: 'draw', reason: 'insufficient material' };
  }

  // Threefold repetition (needs external counter of positions)
  if (repetitionCount) {
    const key = positionKey(board, s);
    if ((repetitionCount[key] || 0) >= 3) {
      return { outcome: 'draw', reason: 'threefold repetition' };
    }
  }

  return { outcome: null, reason: null };
}

// ───────────────────────────────────────────────────────────────────────────────
// Time-forfeit helper (hook for UI clocks)
// FIDE: if a player’s time expires they lose, unless the opponent has no mating material → draw.
// Use with your UI clocks before accepting a move.
// ───────────────────────────────────────────────────────────────────────────────
export function timeForfeitOutcome(board: Board, loser: PieceColor) {
  const winner = colorOpp(loser);
  // If winner lacks mating material → draw
  const hypotheticalBoard = board; // same board; material check only
  // “Winner has mating material?” → invert insufficientMaterial by giving them the move; but
  // we only need to know if *winner* has mating material.
  // Quick check: if overall insufficient material → draw.
  if (insufficientMaterial(hypotheticalBoard)) {
    return { outcome: 'draw', reason: 'time forfeit & insufficient material' };
  }
  return { outcome: 'time', reason: `${winner === 'w' ? 'White' : 'Black'} wins on time` };
}
