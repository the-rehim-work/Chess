/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable prefer-const */

// ═══════════════════════════════════════════════════════════════════════════════
// COMPLETE CHESS ENGINE - ALL FIDE RULES IMPLEMENTED
// ═══════════════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────────
export type PieceColor = 'w' | 'b';
export type PieceType = 'p' | 'r' | 'n' | 'b' | 'q' | 'k';
export type Board = (Piece | null)[];

export interface Piece { 
  color: PieceColor; 
  type: PieceType; 
}

export interface GameState {
  turn: PieceColor;
  castling: string;  // e.g. "KQkq" - castling rights
  ep: number | null; // en-passant target square index
  halfmove: number;  // for 50-move rule
  fullmove: number;  // full move counter
}

export interface Move {
  from: number;
  to: number;
  captured?: Piece | null;
  promotion?: PieceType | null;
  flags?: string; // 'promo' | 'castle-k' | 'castle-q' | 'ep'
  san?: string;   // Standard Algebraic Notation
}

export interface GameOutcome {
  outcome: 'checkmate' | 'stalemate' | 'draw' | 'time' | null;
  reason: string | null;
  winner?: PieceColor | null;
}

// ───────────────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────────────
export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const KNIGHT_MOVES = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2], 
  [1, -2], [1, 2], [2, -1], [2, 1]
];

const KING_MOVES = [
  [1, 0], [-1, 0], [0, 1], [0, -1], 
  [1, 1], [-1, 1], [1, -1], [-1, -1]
];

const ROOK_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRECTIONS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
const QUEEN_DIRECTIONS = [...ROOK_DIRECTIONS, ...BISHOP_DIRECTIONS];

// ───────────────────────────────────────────────────────────────────────────────
// Board Helpers
// ───────────────────────────────────────────────────────────────────────────────
function isOnBoard(rank: number, file: number): boolean {
  return rank >= 0 && rank < 8 && file >= 0 && file < 8;
}

function squareIndex(rank: number, file: number): number {
  return rank * 8 + file;
}

function getRank(index: number): number {
  return Math.floor(index / 8);
}

function getFile(index: number): number {
  return index % 8;
}

function cloneBoard(board: Board): Board {
  return board.slice();
}

function oppositeColor(color: PieceColor): PieceColor {
  return color === 'w' ? 'b' : 'w';
}

export function indexToAlgebraic(index: number): string {
  const files = 'abcdefgh';
  return files[getFile(index)] + (8 - getRank(index));
}

function algebraicToIndex(square: string): number | null {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  const file = square.charCodeAt(0) - 97; // 'a' = 0
  const rank = 8 - Number(square[1]);
  return squareIndex(rank, file);
}

// ───────────────────────────────────────────────────────────────────────────────
// FEN Parsing and Generation
// ───────────────────────────────────────────────────────────────────────────────
export function parseFEN(fen: string): { board: Board; state: GameState } {
  const [placement, turn, castling, ep, halfmove, fullmove] = fen.trim().split(/\s+/);
  const rows = placement.split('/');
  const board: Board = [];

  for (const row of rows) {
    for (const char of row) {
      if (/\d/.test(char)) {
        const emptySquares = Number(char);
        for (let i = 0; i < emptySquares; i++) {
          board.push(null);
        }
      } else {
        const color: PieceColor = char === char.toUpperCase() ? 'w' : 'b';
        const type = char.toLowerCase() as PieceType;
        board.push({ color, type });
      }
    }
  }

  const state: GameState = {
    turn: (turn as PieceColor) || 'w',
    castling: castling === '-' ? '' : castling,
    ep: ep === '-' ? null : algebraicToIndex(ep),
    halfmove: Number(halfmove) || 0,
    fullmove: Number(fullmove) || 1,
  };

  return { board, state };
}

export function boardToFEN(board: Board, state: GameState): string {
  const rows: string[] = [];
  
  for (let rank = 0; rank < 8; rank++) {
    let emptyCount = 0;
    let rowString = '';
    
    for (let file = 0; file < 8; file++) {
      const piece = board[squareIndex(rank, file)];
      if (!piece) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          rowString += emptyCount;
          emptyCount = 0;
        }
        const pieceChar = piece.color === 'w' 
          ? piece.type.toUpperCase() 
          : piece.type;
        rowString += pieceChar;
      }
    }
    if (emptyCount > 0) rowString += emptyCount;
    rows.push(rowString);
  }

  const castlingStr = state.castling || '-';
  const epStr = state.ep === null ? '-' : indexToAlgebraic(state.ep);
  
  return `${rows.join('/')} ${state.turn} ${castlingStr} ${epStr} ${state.halfmove} ${state.fullmove}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Position Key (for repetition detection)
// ───────────────────────────────────────────────────────────────────────────────
export function getPositionKey(board: Board, state: GameState): string {
  const rows: string[] = [];
  
  for (let rank = 0; rank < 8; rank++) {
    let emptyCount = 0;
    let rowString = '';
    
    for (let file = 0; file < 8; file++) {
      const piece = board[squareIndex(rank, file)];
      if (!piece) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          rowString += emptyCount;
          emptyCount = 0;
        }
        rowString += piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
      }
    }
    if (emptyCount > 0) rowString += emptyCount;
    rows.push(rowString);
  }

  const epStr = state.ep === null ? '-' : indexToAlgebraic(state.ep);
  return `${rows.join('/')}_${state.turn}_${state.castling || '-'}_${epStr}`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Attack Detection (Critical for Check/Checkmate)
// ───────────────────────────────────────────────────────────────────────────────
function isSquareAttackedBy(board: Board, square: number, attackerColor: PieceColor): boolean {
  const rank = getRank(square);
  const file = getFile(square);

  // Check for knight attacks
  for (const [dr, df] of KNIGHT_MOVES) {
    const r = rank + dr;
    const f = file + df;
    if (!isOnBoard(r, f)) continue;
    
    const piece = board[squareIndex(r, f)];
    if (piece && piece.color === attackerColor && piece.type === 'n') {
      return true;
    }
  }

  // Check for king attacks
  for (const [dr, df] of KING_MOVES) {
    const r = rank + dr;
    const f = file + df;
    if (!isOnBoard(r, f)) continue;
    
    const piece = board[squareIndex(r, f)];
    if (piece && piece.color === attackerColor && piece.type === 'k') {
      return true;
    }
  }

  // Check for rook/queen attacks (orthogonal)
  for (const [dr, df] of ROOK_DIRECTIONS) {
    let r = rank + dr;
    let f = file + df;
    
    while (isOnBoard(r, f)) {
      const piece = board[squareIndex(r, f)];
      if (piece) {
        if (piece.color === attackerColor && (piece.type === 'r' || piece.type === 'q')) {
          return true;
        }
        break; // Blocked
      }
      r += dr;
      f += df;
    }
  }

  // Check for bishop/queen attacks (diagonal)
  for (const [dr, df] of BISHOP_DIRECTIONS) {
    let r = rank + dr;
    let f = file + df;
    
    while (isOnBoard(r, f)) {
      const piece = board[squareIndex(r, f)];
      if (piece) {
        if (piece.color === attackerColor && (piece.type === 'b' || piece.type === 'q')) {
          return true;
        }
        break; // Blocked
      }
      r += dr;
      f += df;
    }
  }

  // Check for pawn attacks
  const pawnDirection = attackerColor === 'w' ? -1 : 1;
  for (const df of [-1, 1]) {
    const r = rank + pawnDirection;
    const f = file + df;
    if (!isOnBoard(r, f)) continue;
    
    const piece = board[squareIndex(r, f)];
    if (piece && piece.color === attackerColor && piece.type === 'p') {
      return true;
    }
  }

  return false;
}

export function isInCheck(board: Board, state: GameState, color: PieceColor): boolean {
  // Find the king
  let kingSquare = -1;
  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (piece && piece.color === color && piece.type === 'k') {
      kingSquare = i;
      break;
    }
  }

  if (kingSquare === -1) {
    return false; // No king found (shouldn't happen in valid game)
  }

  return isSquareAttackedBy(board, kingSquare, oppositeColor(color));
}

// ───────────────────────────────────────────────────────────────────────────────
// Move Generation - Sliding Pieces
// ───────────────────────────────────────────────────────────────────────────────
function generateSlidingMoves(
  board: Board, 
  from: number, 
  color: PieceColor, 
  directions: number[][]
): Move[] {
  const rank = getRank(from);
  const file = getFile(from);
  const moves: Move[] = [];

  for (const [dr, df] of directions) {
    let r = rank + dr;
    let f = file + df;

    while (isOnBoard(r, f)) {
      const targetSquare = squareIndex(r, f);
      const targetPiece = board[targetSquare];

      if (!targetPiece) {
        // Empty square - valid move
        moves.push({ from, to: targetSquare });
      } else if (targetPiece.color !== color && targetPiece.type !== 'k') {
        // Enemy piece (but not king) - can capture
        moves.push({ from, to: targetSquare, captured: targetPiece });
        break; // Can't move further
      } else {
        // Own piece or enemy king - blocked
        break;
      }

      r += dr;
      f += df;
    }
  }

  return moves;
}

// ───────────────────────────────────────────────────────────────────────────────
// Pseudo-Legal Move Generation (before check validation)
// ───────────────────────────────────────────────────────────────────────────────
export function getPseudoLegalMoves(board: Board, state: GameState, square: number): Move[] {
  const piece = board[square];
  if (!piece || piece.color !== state.turn) {
    return [];
  }

  const rank = getRank(square);
  const file = getFile(square);
  const moves: Move[] = [];

  switch (piece.type) {
    case 'p': {
      // Pawn moves
      const direction = piece.color === 'w' ? -1 : 1;
      const startRank = piece.color === 'w' ? 6 : 1;
      const promotionRank = piece.color === 'w' ? 0 : 7;

      // One square forward
      const oneStep = rank + direction;
      if (isOnBoard(oneStep, file)) {
        const oneStepSquare = squareIndex(oneStep, file);
        if (!board[oneStepSquare]) {
          const move: Move = { from: square, to: oneStepSquare };
          if (oneStep === promotionRank) {
            move.flags = 'promo';
          }
          moves.push(move);

          // Two squares forward from starting position
          if (rank === startRank) {
            const twoStep = rank + 2 * direction;
            const twoStepSquare = squareIndex(twoStep, file);
            if (!board[twoStepSquare]) {
              moves.push({ from: square, to: twoStepSquare });
            }
          }
        }
      }

      // Diagonal captures
      for (const df of [-1, 1]) {
        const captureRank = rank + direction;
        const captureFile = file + df;
        
        if (isOnBoard(captureRank, captureFile)) {
          const captureSquare = squareIndex(captureRank, captureFile);
          const targetPiece = board[captureSquare];
          
          if (targetPiece && targetPiece.color !== piece.color && targetPiece.type !== 'k') {
            const move: Move = { from: square, to: captureSquare, captured: targetPiece };
            if (captureRank === promotionRank) {
              move.flags = 'promo';
            }
            moves.push(move);
          }
        }
      }

      // En passant
      if (state.ep !== null) {
        const epRank = getRank(state.ep);
        const epFile = getFile(state.ep);
        
        if (epRank === rank + direction && Math.abs(epFile - file) === 1) {
          moves.push({
            from: square,
            to: state.ep,
            flags: 'ep',
            captured: { color: oppositeColor(piece.color), type: 'p' }
          });
        }
      }
      break;
    }

    case 'n': {
      // Knight moves
      for (const [dr, df] of KNIGHT_MOVES) {
        const r = rank + dr;
        const f = file + df;
        
        if (isOnBoard(r, f)) {
          const targetSquare = squareIndex(r, f);
          const targetPiece = board[targetSquare];
          
          if (!targetPiece || (targetPiece.color !== piece.color && targetPiece.type !== 'k')) {
            moves.push({ 
              from: square, 
              to: targetSquare, 
              captured: targetPiece || undefined 
            });
          }
        }
      }
      break;
    }

    case 'b': {
      moves.push(...generateSlidingMoves(board, square, piece.color, BISHOP_DIRECTIONS));
      break;
    }

    case 'r': {
      moves.push(...generateSlidingMoves(board, square, piece.color, ROOK_DIRECTIONS));
      break;
    }

    case 'q': {
      moves.push(...generateSlidingMoves(board, square, piece.color, QUEEN_DIRECTIONS));
      break;
    }

    case 'k': {
      // Regular king moves
      for (const [dr, df] of KING_MOVES) {
        const r = rank + dr;
        const f = file + df;
        
        if (isOnBoard(r, f)) {
          const targetSquare = squareIndex(r, f);
          const targetPiece = board[targetSquare];
          
          if (!targetPiece || (targetPiece.color !== piece.color && targetPiece.type !== 'k')) {
            moves.push({ 
              from: square, 
              to: targetSquare, 
              captured: targetPiece || undefined 
            });
          }
        }
      }

      // Castling moves
      if (piece.color === 'w' && rank === 7 && file === 4) {
        // White kingside castling
        if (state.castling.includes('K')) {
          const f1 = squareIndex(7, 5);
          const g1 = squareIndex(7, 6);
          
          if (!board[f1] && !board[g1]) {
            if (!isInCheck(board, state, 'w') &&
                !isSquareAttackedBy(board, f1, 'b') &&
                !isSquareAttackedBy(board, g1, 'b')) {
              moves.push({ from: square, to: g1, flags: 'castle-k' });
            }
          }
        }

        // White queenside castling
        if (state.castling.includes('Q')) {
          const d1 = squareIndex(7, 3);
          const c1 = squareIndex(7, 2);
          const b1 = squareIndex(7, 1);
          
          if (!board[d1] && !board[c1] && !board[b1]) {
            if (!isInCheck(board, state, 'w') &&
                !isSquareAttackedBy(board, d1, 'b') &&
                !isSquareAttackedBy(board, c1, 'b')) {
              moves.push({ from: square, to: c1, flags: 'castle-q' });
            }
          }
        }
      }

      if (piece.color === 'b' && rank === 0 && file === 4) {
        // Black kingside castling
        if (state.castling.includes('k')) {
          const f8 = squareIndex(0, 5);
          const g8 = squareIndex(0, 6);
          
          if (!board[f8] && !board[g8]) {
            if (!isInCheck(board, state, 'b') &&
                !isSquareAttackedBy(board, f8, 'w') &&
                !isSquareAttackedBy(board, g8, 'w')) {
              moves.push({ from: square, to: g8, flags: 'castle-k' });
            }
          }
        }

        // Black queenside castling
        if (state.castling.includes('q')) {
          const d8 = squareIndex(0, 3);
          const c8 = squareIndex(0, 2);
          const b8 = squareIndex(0, 1);
          
          if (!board[d8] && !board[c8] && !board[b8]) {
            if (!isInCheck(board, state, 'b') &&
                !isSquareAttackedBy(board, d8, 'w') &&
                !isSquareAttackedBy(board, c8, 'w')) {
              moves.push({ from: square, to: c8, flags: 'castle-q' });
            }
          }
        }
      }
      break;
    }
  }

  return moves;
}

// ───────────────────────────────────────────────────────────────────────────────
// Legal Move Generation (filters out moves that leave king in check)
// ───────────────────────────────────────────────────────────────────────────────
export function getLegalMoves(board: Board, state: GameState, square: number): Move[] {
  const pseudoMoves = getPseudoLegalMoves(board, state, square);
  const legalMoves: Move[] = [];

  for (const move of pseudoMoves) {
    // Try the move
    const { board: newBoard, state: newState } = makeMove(board, state, move, true);
    
    // Check if our own king is in check after the move
    if (!isInCheck(newBoard, newState, state.turn)) {
      // Check if opponent's king still exists
      const opponentColor = oppositeColor(state.turn);
      let opponentKingExists = false;
      
      for (let i = 0; i < 64; i++) {
        const piece = newBoard[i];
        if (piece && piece.color === opponentColor && piece.type === 'k') {
          opponentKingExists = true;
          break;
        }
      }
      
      if (opponentKingExists) {
        legalMoves.push(move);
      }
    }
  }

  return legalMoves;
}

// ───────────────────────────────────────────────────────────────────────────────
// Make Move (applies move to board and updates state)
// ───────────────────────────────────────────────────────────────────────────────
export function makeMove(
  board: Board,
  state: GameState,
  move: Move,
  skipValidation = false
): { board: Board; state: GameState } {
  const newBoard = cloneBoard(board);
  const newState: GameState = { ...state };

  const movingPiece = newBoard[move.from];
  if (!movingPiece) {
    return { board, state }; // Invalid move
  }

  // Reset en passant
  newState.ep = null;

  // Update halfmove clock (50-move rule)
  const isPawnMove = movingPiece.type === 'p';
  const isCapture = !!move.captured || move.flags === 'ep';
  newState.halfmove = (isPawnMove || isCapture) ? 0 : newState.halfmove + 1;

  // Move the piece
  newBoard[move.to] = { ...movingPiece };
  newBoard[move.from] = null;

  // Handle promotion
  if (move.promotion) {
    newBoard[move.to] = { color: movingPiece.color, type: move.promotion };
  }

  // Handle en passant capture
  if (move.flags === 'ep') {
    const capturedPawnDirection = movingPiece.color === 'w' ? 1 : -1;
    const capturedPawnSquare = move.to + capturedPawnDirection * 8;
    newBoard[capturedPawnSquare] = null;
  }

  // Set en passant target for two-square pawn moves
  if (movingPiece.type === 'p' && Math.abs(move.to - move.from) === 16) {
    newState.ep = (move.to + move.from) / 2;
  }

  const fromRank = getRank(move.from);
  const fromFile = getFile(move.from);
  const toRank = getRank(move.to);
  const toFile = getFile(move.to);

  // Handle castling
  if (movingPiece.type === 'k') {
    // Remove castling rights for this king
    if (movingPiece.color === 'w') {
      newState.castling = newState.castling.replace('K', '').replace('Q', '');
    } else {
      newState.castling = newState.castling.replace('k', '').replace('q', '');
    }

    // Move rook for castling
    if (move.flags === 'castle-k') {
      if (movingPiece.color === 'w') {
        newBoard[squareIndex(7, 5)] = newBoard[squareIndex(7, 7)];
        newBoard[squareIndex(7, 7)] = null;
      } else {
        newBoard[squareIndex(0, 5)] = newBoard[squareIndex(0, 7)];
        newBoard[squareIndex(0, 7)] = null;
      }
    } else if (move.flags === 'castle-q') {
      if (movingPiece.color === 'w') {
        newBoard[squareIndex(7, 3)] = newBoard[squareIndex(7, 0)];
        newBoard[squareIndex(7, 0)] = null;
      } else {
        newBoard[squareIndex(0, 3)] = newBoard[squareIndex(0, 0)];
        newBoard[squareIndex(0, 0)] = null;
      }
    }
  }

  // Remove castling rights when rook moves
  if (movingPiece.type === 'r') {
    if (fromRank === 7 && fromFile === 0) newState.castling = newState.castling.replace('Q', '');
    if (fromRank === 7 && fromFile === 7) newState.castling = newState.castling.replace('K', '');
    if (fromRank === 0 && fromFile === 0) newState.castling = newState.castling.replace('q', '');
    if (fromRank === 0 && fromFile === 7) newState.castling = newState.castling.replace('k', '');
  }

  // Remove castling rights when rook is captured
  if (isCapture) {
    if (toRank === 7 && toFile === 0) newState.castling = newState.castling.replace('Q', '');
    if (toRank === 7 && toFile === 7) newState.castling = newState.castling.replace('K', '');
    if (toRank === 0 && toFile === 0) newState.castling = newState.castling.replace('q', '');
    if (toRank === 0 && toFile === 7) newState.castling = newState.castling.replace('k', '');
  }

  // Switch turn
  newState.turn = oppositeColor(newState.turn);
  
  // Increment fullmove after black's turn
  if (newState.turn === 'w') {
    newState.fullmove += 1;
  }

  // Validate move doesn't leave own king in check (unless skipped for performance)
  if (!skipValidation) {
    if (isInCheck(newBoard, newState, oppositeColor(newState.turn))) {
      return { board, state }; // Illegal move
    }
  }

  return { board: newBoard, state: newState };
}

// ───────────────────────────────────────────────────────────────────────────────
// Check if any legal move exists
// ───────────────────────────────────────────────────────────────────────────────
function hasAnyLegalMove(board: Board, state: GameState): boolean {
  for (let square = 0; square < 64; square++) {
    const piece = board[square];
    if (!piece || piece.color !== state.turn) continue;
    
    const legalMoves = getLegalMoves(board, state, square);
    if (legalMoves.length > 0) {
      return true;
    }
  }
  return false;
}

// ───────────────────────────────────────────────────────────────────────────────
// Insufficient Material Detection
// ───────────────────────────────────────────────────────────────────────────────
export function hasInsufficientMaterial(board: Board): boolean {
  let whitePawns = 0, blackPawns = 0;
  let whiteRooks = 0, blackRooks = 0;
  let whiteQueens = 0, blackQueens = 0;
  let whiteKnights = 0, blackKnights = 0;
  let whiteBishops = 0, blackBishops = 0;
  const whiteBishopSquares: number[] = [];
  const blackBishopSquares: number[] = [];

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece) continue;

    switch (piece.type) {
      case 'p':
        piece.color === 'w' ? whitePawns++ : blackPawns++;
        break;
      case 'r':
        piece.color === 'w' ? whiteRooks++ : blackRooks++;
        break;
      case 'q':
        piece.color === 'w' ? whiteQueens++ : blackQueens++;
        break;
      case 'n':
        piece.color === 'w' ? whiteKnights++ : blackKnights++;
        break;
      case 'b':
        if (piece.color === 'w') {
          whiteBishops++;
          whiteBishopSquares.push(i);
        } else {
          blackBishops++;
          blackBishopSquares.push(i);
        }
        break;
    }
  }

  // Any pawns, rooks, or queens mean there's mating material
  if (whitePawns || blackPawns || whiteRooks || blackRooks || whiteQueens || blackQueens) {
    return false;
  }

  // King vs King
  if (whiteBishops === 0 && blackBishops === 0 && whiteKnights === 0 && blackKnights === 0) {
    return true;
  }

  // King + Bishop vs King or King + Knight vs King
  if ((whiteBishops === 1 && whiteKnights === 0 && blackBishops === 0 && blackKnights === 0) ||
      (whiteKnights === 1 && whiteBishops === 0 && blackBishops === 0 && blackKnights === 0) ||
      (blackBishops === 1 && blackKnights === 0 && whiteBishops === 0 && whiteKnights === 0) ||
      (blackKnights === 1 && blackBishops === 0 && whiteBishops === 0 && whiteKnights === 0)) {
    return true;
  }

  // King + Bishop vs King + Bishop with same-colored bishops
  if (whiteBishops === 1 && blackBishops === 1 && whiteKnights === 0 && blackKnights === 0) {
    const whiteBishopSquare = whiteBishopSquares[0];
    const blackBishopSquare = blackBishopSquares[0];
    
    const whiteOnDark = (getRank(whiteBishopSquare) + getFile(whiteBishopSquare)) % 2 === 1;
    const blackOnDark = (getRank(blackBishopSquare) + getFile(blackBishopSquare)) % 2 === 1;
    
    if (whiteOnDark === blackOnDark) {
      return true;
    }
  }

  return false;
}

// ───────────────────────────────────────────────────────────────────────────────
// Game Outcome Detection (Checkmate, Stalemate, Draw)
// ───────────────────────────────────────────────────────────────────────────────
export function detectOutcome(
  board: Board, 
  state: GameState, 
  positionHistory?: Record<string, number>
): GameOutcome {
  const currentPlayer = state.turn;
  const hasLegalMoves = hasAnyLegalMove(board, state);
  const inCheck = isInCheck(board, state, currentPlayer);

  // Checkmate: No legal moves and in check
  if (!hasLegalMoves && inCheck) {
    const winner = oppositeColor(currentPlayer);
    return {
      outcome: 'checkmate',
      reason: `Checkmate - ${winner === 'w' ? 'White' : 'Black'} wins`,
      winner
    };
  }

  // Stalemate: No legal moves but not in check
  if (!hasLegalMoves && !inCheck) {
    return {
      outcome: 'stalemate',
      reason: 'Stalemate - No legal moves available',
      winner: null
    };
  }

  // 50-move rule (100 halfmoves)
  if (state.halfmove >= 100) {
    return {
      outcome: 'draw',
      reason: '50-move rule - No capture or pawn move in 50 moves',
      winner: null
    };
  }

  // Insufficient material
  if (hasInsufficientMaterial(board)) {
    return {
      outcome: 'draw',
      reason: 'Insufficient material to checkmate',
      winner: null
    };
  }

  // Threefold repetition
  if (positionHistory) {
    const currentPositionKey = getPositionKey(board, state);
    const repetitionCount = positionHistory[currentPositionKey] || 0;
    
    if (repetitionCount >= 3) {
      return {
        outcome: 'draw',
        reason: 'Threefold repetition',
        winner: null
      };
    }
  }

  // Game continues
  return {
    outcome: null,
    reason: null,
    winner: null
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Time Forfeit Detection
// ───────────────────────────────────────────────────────────────────────────────
export function detectTimeForfeit(board: Board, losingColor: PieceColor): GameOutcome {
  const winner = oppositeColor(losingColor);

  // If the winner has insufficient material, it's a draw
  if (hasInsufficientMaterial(board)) {
    return {
      outcome: 'draw',
      reason: 'Time forfeit but insufficient material to mate',
      winner: null
    };
  }

  return {
    outcome: 'time',
    reason: `${winner === 'w' ? 'White' : 'Black'} wins on time`,
    winner
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Get All Legal Moves for Current Position
// ───────────────────────────────────────────────────────────────────────────────
export function getAllLegalMoves(board: Board, state: GameState): Move[] {
  const allMoves: Move[] = [];
  
  for (let square = 0; square < 64; square++) {
    const piece = board[square];
    if (!piece || piece.color !== state.turn) continue;
    
    const moves = getLegalMoves(board, state, square);
    allMoves.push(...moves);
  }
  
  return allMoves;
}

// ───────────────────────────────────────────────────────────────────────────────
// Check if King Can Move to Square Safely
// ───────────────────────────────────────────────────────────────────────────────
export function canKingMoveSafely(
  board: Board, 
  state: GameState, 
  kingSquare: number, 
  targetSquare: number
): boolean {
  const piece = board[kingSquare];
  if (!piece || piece.type !== 'k') return false;

  const targetPiece = board[targetSquare];
  
  // Can't move to square occupied by own piece
  if (targetPiece && targetPiece.color === piece.color) {
    return false;
  }

  // Can't capture enemy king
  if (targetPiece && targetPiece.type === 'k') {
    return false;
  }

  // Simulate the move
  const testBoard = cloneBoard(board);
  testBoard[targetSquare] = testBoard[kingSquare];
  testBoard[kingSquare] = null;

  // Check if target square is under attack
  return !isSquareAttackedBy(testBoard, targetSquare, oppositeColor(piece.color));
}

// ───────────────────────────────────────────────────────────────────────────────
// Validate Move (checks if move is legal)
// ───────────────────────────────────────────────────────────────────────────────
export function isMoveLegal(board: Board, state: GameState, move: Move): boolean {
  const legalMoves = getLegalMoves(board, state, move.from);
  return legalMoves.some(m => m.from === move.from && m.to === move.to);
}

// ───────────────────────────────────────────────────────────────────────────────
// Check if Square is Under Attack
// ───────────────────────────────────────────────────────────────────────────────
export function isSquareUnderAttack(
  board: Board, 
  square: number, 
  attackingColor: PieceColor
): boolean {
  return isSquareAttackedBy(board, square, attackingColor);
}

// ───────────────────────────────────────────────────────────────────────────────
// Get Attacking Pieces (returns all pieces attacking a square)
// ───────────────────────────────────────────────────────────────────────────────
export function getAttackingPieces(
  board: Board, 
  square: number, 
  attackingColor: PieceColor
): number[] {
  const attackers: number[] = [];
  const rank = getRank(square);
  const file = getFile(square);

  // Check for knight attacks
  for (const [dr, df] of KNIGHT_MOVES) {
    const r = rank + dr;
    const f = file + df;
    if (!isOnBoard(r, f)) continue;
    
    const attackerSquare = squareIndex(r, f);
    const piece = board[attackerSquare];
    if (piece && piece.color === attackingColor && piece.type === 'n') {
      attackers.push(attackerSquare);
    }
  }

  // Check for king attacks
  for (const [dr, df] of KING_MOVES) {
    const r = rank + dr;
    const f = file + df;
    if (!isOnBoard(r, f)) continue;
    
    const attackerSquare = squareIndex(r, f);
    const piece = board[attackerSquare];
    if (piece && piece.color === attackingColor && piece.type === 'k') {
      attackers.push(attackerSquare);
    }
  }

  // Check for sliding piece attacks (rooks, bishops, queens)
  for (const [dr, df] of QUEEN_DIRECTIONS) {
    let r = rank + dr;
    let f = file + df;
    
    while (isOnBoard(r, f)) {
      const attackerSquare = squareIndex(r, f);
      const piece = board[attackerSquare];
      
      if (piece) {
        if (piece.color === attackingColor) {
          const isRookDirection = dr === 0 || df === 0;
          const isBishopDirection = Math.abs(dr) === Math.abs(df);
          
          if ((isRookDirection && (piece.type === 'r' || piece.type === 'q')) ||
              (isBishopDirection && (piece.type === 'b' || piece.type === 'q'))) {
            attackers.push(attackerSquare);
          }
        }
        break;
      }
      
      r += dr;
      f += df;
    }
  }

  // Check for pawn attacks
  const pawnDirection = attackingColor === 'w' ? -1 : 1;
  for (const df of [-1, 1]) {
    const r = rank + pawnDirection;
    const f = file + df;
    if (!isOnBoard(r, f)) continue;
    
    const attackerSquare = squareIndex(r, f);
    const piece = board[attackerSquare];
    if (piece && piece.color === attackingColor && piece.type === 'p') {
      attackers.push(attackerSquare);
    }
  }

  return attackers;
}

// ───────────────────────────────────────────────────────────────────────────────
// Check if King is in Checkmate
// ───────────────────────────────────────────────────────────────────────────────
export function isCheckmate(board: Board, state: GameState): boolean {
  const inCheck = isInCheck(board, state, state.turn);
  const hasLegalMoves = hasAnyLegalMove(board, state);
  return inCheck && !hasLegalMoves;
}

// ───────────────────────────────────────────────────────────────────────────────
// Check if King is in Stalemate
// ───────────────────────────────────────────────────────────────────────────────
export function isStalemate(board: Board, state: GameState): boolean {
  const inCheck = isInCheck(board, state, state.turn);
  const hasLegalMoves = hasAnyLegalMove(board, state);
  return !inCheck && !hasLegalMoves;
}

// ───────────────────────────────────────────────────────────────────────────────
// Position Evaluation (simple material count)
// ───────────────────────────────────────────────────────────────────────────────
export function evaluatePosition(board: Board): number {
  const pieceValues: Record<PieceType, number> = {
    p: 1,
    n: 3,
    b: 3,
    r: 5,
    q: 9,
    k: 0
  };

  let score = 0;
  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (piece) {
      const value = pieceValues[piece.type];
      score += piece.color === 'w' ? value : -value;
    }
  }

  return score;
}

// ───────────────────────────────────────────────────────────────────────────────
// Export All Functions
// ───────────────────────────────────────────────────────────────────────────────
export {
  isOnBoard,
  squareIndex,
  getRank,
  getFile,
  oppositeColor,
  isSquareAttackedBy,
  cloneBoard,
  algebraicToIndex,
};