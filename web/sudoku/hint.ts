// Top-level hint search and candidate bookkeeping. (The solver lives in
// solver.ts.)
//
// `findHint` returns the single simplest applicable step. The working Candidate
// grid it uses is seeded from the player's Pencil marks when they have them,
// falling back to Candidates derived from board values — that way a hint
// reflects the state the player is actually looking at.

import { Board, cellName, idx, rc, type Coord } from "./model.ts";
import { TECHNIQUES, type CandGrid, type Hint } from "./techniques.ts";

/** A hint in the shape the page uses, where a Cell is `{r, c}` rather than a
 * pair. The catalogue itself never sees this — it is the page's shape, and it
 * lives here with the rest of what the page calls. */
export type WireHint = Omit<Hint, "cells"> & { cells: { r: number; c: number }[] };

export function hintToWire(hint: Hint): WireHint {
  return { ...hint, cells: hint.cells.map(([r, c]) => ({ r, c })) };
}

/**
 * Candidates per empty cell, row-major.
 *
 * Row-major because techniques return "the first cell that qualifies", so the
 * insertion order is what decides which cell a hint names — the same order
 * Python's dict of coordinates has.
 */
function candidateGrid(board: Board, seed: (r: number, c: number) => Set<number>): CandGrid {
  const cg: CandGrid = new Map();
  for (let i = 0; i < 81; i++) {
    const [r, c] = rc(i);
    if (board.value(r, c) === null) cg.set(i, seed(r, c));
  }
  return cg;
}

/**
 * The Candidate grid the engine reasons over when it hints.
 *
 * For each empty cell: the player's Pencil marks intersected with the legal
 * (value-derived) Candidates when marks exist; otherwise the legal Candidates
 * directly. Intersecting keeps us sound even if the player pencilled an
 * impossible digit.
 */
export function workingCandidates(board: Board): CandGrid {
  return candidateGrid(board, (r, c) => {
    const legal = board.candidates(r, c);
    const marks = board.cell(r, c).pencilMarks;
    if (marks.size === 0) return legal;
    return new Set([...marks].filter((d) => legal.has(d)));
  });
}

/**
 * The Candidate grid to solve from: derived from values alone.
 *
 * Deliberately blind to Pencil marks. A hint must reason from what the player
 * sees, but a solve must not: a *missing* mark would narrow the search past the
 * real solution.
 */
export function derivedCandidates(board: Board): CandGrid {
  return candidateGrid(board, (r, c) => board.candidates(r, c));
}

/** First applicable technique, simplest first. `null` if solved or stuck. */
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
 * A placement removes the cell from the grid and clears that digit from peers;
 * an elimination drops the listed digits from the named cells.
 *
 * Takes `board` because a cell's Peers are board data once Cages are in play,
 * not something derivable from coordinates alone (see `Board.peers`).
 */
export function applyToCandidates(board: Board, cg: CandGrid, hint: Hint): CandGrid {
  if (hint.action === "place") {
    const [r, c] = hint.cells[0];
    const d = hint.digits[0];
    cg.delete(idx(r, c));
    for (const p of board.peers(r, c)) cg.get(p)?.delete(d);
  } else {
    for (const [r, c] of hint.cells) {
      const cell = cg.get(idx(r, c));
      if (cell) for (const d of hint.digits) cell.delete(d);
    }
  }
  return cg;
}

/** Rub a hint's digits out of the Pencil marks it names, in place. */
function eraseMarks(board: Board, hint: Hint): void {
  for (const [r, c] of hint.cells) {
    for (const d of hint.digits) board.cell(r, c).pencilMarks.delete(d);
  }
}

/** A copy of `board` with `hint` applied: values for placements, Pencil marks
 * for eliminations. */
export function applyHint(board: Board, hint: Hint): Board {
  const next = Board.fromWire(board.toWire());
  if (hint.action === "place") {
    const [r, c] = hint.cells[0];
    next.setValue(r, c, hint.digits[0]);
  } else {
    eraseMarks(next, hint);
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
 * Operates on a persistent Candidate grid so eliminations accumulate.
 * Placements are written back to the board.
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
      work.setValue(r, c, hint.digits[0]);
    } else {
      // Mirror the elimination onto the board's own Pencil marks, not just the
      // Candidate grid. An impossible mark is already absent from `grid`, so
      // without this the same hint would be re-found forever.
      eraseMarks(work, hint);
    }
    applyToCandidates(work, grid, hint);
  }
  return { board: work, steps, solved: work.isSolved() };
}

/** The gentlest reveal: which Unit or Cell to look at, without saying what to do.
 *
 * Presentation rather than deduction, which is why it sits here in the Sudoku
 * engine's own module and not in something shared — Queens keeps a separate
 * implementation of the same idea, per ADR 0001. */
export function nudge(hint: Hint): string {
  if (hint.units.length > 0) return `Look at ${hint.units[0]}.`;
  const [r, c] = hint.cells[0];
  return `Look at ${cellName(r, c)}.`;
}
