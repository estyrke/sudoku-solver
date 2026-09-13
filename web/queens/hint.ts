// Top-level hint search and Candidate bookkeeping. (The backtracking solver
// lives in solver.ts.)
//
// `findHint` returns the single simplest applicable step, walking `TECHNIQUES`
// (see techniques.ts) in order. `workingCandidates` builds the Candidate grid
// it reasons over fresh from the board each time it is called: Queens has no
// pencil-mark-versus-derived-candidate reconciliation to do the way Sudoku
// does, since a Mark already *is* the board's record of "ruled out" — there is
// no separate mark set to intersect against legal candidates.

import { Board, EMPTY, MARKED, QUEEN, cellName, type Coord } from "./model.ts";
import { TECHNIQUES, type CandGrid, type Hint } from "./techniques.ts";

/** A hint in the shape the page uses, where a Cell is `{r, c}` rather than a
 * pair. The catalogue itself never sees this — it is the page's shape, and it
 * lives here with the rest of what the page calls. */
export type WireHint = Omit<Hint, "cells"> & { cells: { r: number; c: number }[] };

export function hintToWire(hint: Hint): WireHint {
  return { ...hint, cells: hint.cells.map(([r, c]) => ({ r, c })) };
}

/**
 * The Candidate grid the engine reasons over: every empty cell not ruled out by
 * an existing queen's row, column, region (`Board.peers`) or 8-neighbors
 * (`Board.neighbors`) — Queens' elimination-propagation bookkeeping. Marked
 * cells are excluded automatically since they are not empty; a Mark carries no
 * extra information beyond "not a candidate" (see web/queens/CONTEXT.md).
 */
export function workingCandidates(board: Board): CandGrid {
  const blocked = new Set<number>();
  for (const [r, c] of board.queenCells()) {
    for (const i of board.peers(r, c)) blocked.add(i);
    for (const i of board.neighbors(r, c)) blocked.add(i);
  }
  const cg: CandGrid = new Set();
  for (const [r, c] of board.coords()) {
    const i = board.idx(r, c);
    if (board.state(r, c) === EMPTY && !blocked.has(i)) cg.add(i);
  }
  return cg;
}

/** First applicable technique, simplest first. `null` if invalid, solved, or
 * stuck (no implemented technique applies). */
export function findHint(board: Board, cg?: CandGrid): Hint | null {
  if (!board.isValid()) return null;
  const grid = cg ?? workingCandidates(board);
  for (const technique of TECHNIQUES) {
    const hint = technique(board, grid);
    if (hint !== null) return hint;
  }
  return null;
}

/**
 * Apply a hint to a Candidate grid in place and return it.
 *
 * Takes `board` in addition to `(cg, hint)` because a cell's peers/neighbors
 * depend on board size and region layout, which are instance data (`Board.n`,
 * per-cell `region`). Sudoku's counterpart takes a board for the same reason —
 * its peers became board-dependent once Killer cages entered the model.
 *
 * A placement drops the placed cell from `cg` and propagates elimination to its
 * peers and neighbors, exactly like `workingCandidates` does for a queen
 * already on the board. An elimination (issues #7/#8) just drops the named
 * cells.
 */
export function applyToCandidates(board: Board, cg: CandGrid, hint: Hint): CandGrid {
  if (hint.action === "place") {
    const [r, c] = hint.cells[0];
    cg.delete(board.idx(r, c));
    for (const i of board.peers(r, c)) cg.delete(i);
    for (const i of board.neighbors(r, c)) cg.delete(i);
  } else {
    for (const [r, c] of hint.cells) cg.delete(board.idx(r, c));
  }
  return cg;
}

/** A copy of `board` with `hint` applied (a queen for a placement, a mark for
 * an elimination). */
export function applyHint(board: Board, hint: Hint): Board {
  const next = Board.fromWire(board.toWire());
  if (hint.action === "place") {
    const [r, c] = hint.cells[0];
    next.setState(r, c, QUEEN);
  } else {
    for (const [r, c] of hint.cells) next.setState(r, c, MARKED);
  }
  return next;
}

export interface TechniqueRun {
  board: Board;
  steps: Hint[];
  solved: boolean;
}

/**
 * Repeatedly apply `findHint` until solved or stuck.
 *
 * Operates on a persistent Candidate grid so eliminations accumulate, and
 * writes placements back to the board as it goes.
 */
export function solveWithTechniques(board: Board, cg?: CandGrid): TechniqueRun {
  const work = Board.fromWire(board.toWire());
  const grid = cg ?? workingCandidates(work);
  const steps: Hint[] = [];
  for (;;) {
    const hint = findHint(work, grid);
    if (hint === null) break;
    steps.push(hint);
    if (hint.action === "place") {
      const [r, c] = hint.cells[0] as Coord;
      work.setState(r, c, QUEEN);
    } else {
      for (const [r, c] of hint.cells) work.setState(r, c, MARKED);
    }
    applyToCandidates(work, grid, hint);
  }
  return { board: work, steps, solved: work.isSolved() };
}

/** The gentlest reveal: which Unit or Cell to look at, without saying what to
 * do.
 *
 * Queens keeps its own implementation of this rather than reusing Sudoku's, so
 * the two engines stay independent per ADR 0001. */
export function nudge(hint: Hint): string {
  if (hint.units.length > 0) return `Look at ${hint.units[0]}.`;
  const [r, c] = hint.cells[0];
  return `Look at ${cellName(r, c)}.`;
}
