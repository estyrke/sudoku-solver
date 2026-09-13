// Backtracking solver: the exhaustive search behind the Solve button, separate
// from the technique-driven hint engine in hint.ts.

import { Board, EMPTY, QUEEN } from "./model.ts";

/** A solved copy of `board`, or `null` if no completion exists. */
export function solve(board: Board): Board | null {
  const work = Board.fromWire(board.toWire());
  if (!work.isValid()) return null;
  return backtrack(work, 0) ? work : null;
}

/** Recurse row-by-row: exactly one queen must land in each row, so each level
 * of recursion picks that row's column (or, if the row already has a queen from
 * the starting board, moves straight on). */
function backtrack(board: Board, row: number): boolean {
  if (row === board.n) return true;
  for (let c = 0; c < board.n; c++) {
    if (board.state(row, c) === QUEEN) return backtrack(board, row + 1);
  }
  for (let col = 0; col < board.n; col++) {
    if (board.state(row, col) !== EMPTY) continue; // marked cells can never receive a queen
    if (!canPlace(board, row, col)) continue;
    board.setState(row, col, QUEEN);
    if (backtrack(board, row + 1)) return true;
    board.setState(row, col, EMPTY);
  }
  return false;
}

function canPlace(board: Board, r: number, c: number): boolean {
  const region = board.region(r, c);
  for (const [pr, pc] of board.queenCells()) {
    if (pc === c) return false;
    if (region !== null && board.region(pr, pc) === region) return false;
    if (Math.abs(pr - r) <= 1 && Math.abs(pc - c) <= 1) return false;
  }
  return true;
}
