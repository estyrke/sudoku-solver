// Pure-logic Sudoku board model — the TypeScript port of sudoku/model.py.
//
// No DOM, no fetch, no rendering: just the grid, its units/peers, candidate
// derivation and validity checks, so both the local solver and (later) the
// local hint engine can share one implementation instead of each growing its
// own.
//
// This slice ports the classic (cage-free) parts only. Killer's Cage extends
// this same class in sudoku/model.py rather than living in a sibling type —
// see docs/adr/0002-killer-sudoku-extends-sudoku-context.md — and will do the
// same here once the Killer slice (issue #21) ports it. Until then a Board
// has no notion of a cage, same as a Python Board built with no cages.
//
// Coordinates are 0-indexed (row, col) throughout, exactly as in the Python
// model. Cells are also addressable by a single row-major index (0..80) —
// `idx`/`rc` below — because a JS `Set` compares objects/tuples by identity,
// not value, so a set of coordinate pairs can't dedupe the way Python's
// `set[tuple[int, int]]` does. Peers and candidates are keyed by index for
// that reason; human-facing coordinates are still `[r, c]` pairs everywhere
// else, matching the Python API.

export const N = 9;
export const DIGITS: readonly number[] = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);

export type Coord = readonly [number, number];

/** Row-major index of a cell, 0..80. */
export const idx = (r: number, c: number): number => r * N + c;

/** The (row, col) a row-major index refers to. */
export const rc = (i: number): Coord => [Math.floor(i / N), i % N];

/** Box number 0..8 (left-to-right, top-to-bottom) for a cell. */
export function boxIndex(r: number, c: number): number {
  return Math.floor(r / 3) * 3 + Math.floor(c / 3);
}

/** Human label like `r4c7` (1-indexed). */
export function cellName(r: number, c: number): string {
  return `r${r + 1}c${c + 1}`;
}

/** A single square, mirroring `sudoku.model.Cell`. */
export interface Cell {
  value: number | null;
  isGiven: boolean;
  /** Candidates the *player* wrote, kept separate from derived Candidates. */
  pencilMarks: Set<number>;
  lowConfidence: boolean;
}

function emptyCell(): Cell {
  return { value: null, isGiven: false, pencilMarks: new Set<number>(), lowConfidence: false };
}

/** A cell as the server (and, here, any caller) sends and receives it. */
export interface WireCell {
  value: number | null;
  is_given?: boolean;
  pencil_marks?: number[];
  low_confidence?: boolean;
}

export interface WireBoard {
  cells: WireCell[];
}

/** A 9x9 Sudoku grid plus the structural helpers techniques rely on. */
export class Board {
  readonly cells: Cell[];

  constructor(cells?: Cell[]) {
    if (cells !== undefined && cells.length !== N * N) {
      throw new Error("a board needs exactly 81 cells");
    }
    this.cells = cells ?? Array.from({ length: N * N }, emptyCell);
  }

  // ---- access ---------------------------------------------------------

  cell(r: number, c: number): Cell {
    return this.cells[idx(r, c)];
  }

  value(r: number, c: number): number | null {
    return this.cell(r, c).value;
  }

  setValue(r: number, c: number, value: number | null): void {
    this.cell(r, c).value = value;
  }

  // ---- units & peers ----------------------------------------------------

  static rowCells(r: number): Coord[] {
    return Array.from({ length: N }, (_, c) => [r, c] as Coord);
  }

  static colCells(c: number): Coord[] {
    return Array.from({ length: N }, (_, r) => [r, c] as Coord);
  }

  static boxCells(b: number): Coord[] {
    const r0 = Math.floor(b / 3) * 3;
    const c0 = (b % 3) * 3;
    const out: Coord[] = [];
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) out.push([r0 + dr, c0 + dc]);
    }
    return out;
  }

  /** Yield all 27 units as `[label, cells]` pairs. */
  *units(): IterableIterator<[string, Coord[]]> {
    for (let r = 0; r < N; r++) yield [`row ${r + 1}`, Board.rowCells(r)];
    for (let c = 0; c < N; c++) yield [`column ${c + 1}`, Board.colCells(c)];
    for (let b = 0; b < N; b++) yield [`box ${b + 1}`, Board.boxCells(b)];
  }

  /**
   * The cells (by index) whose values constrain `(r, c)`: the classic 20
   * sharing a row, column or box. An instance method, not a static one,
   * because a Killer board's cages will add to this set once ported — cage
   * membership is per-board data, same as in the Python model.
   */
  peers(r: number, c: number): Set<number> {
    const result = new Set<number>();
    for (const [pr, pc] of Board.rowCells(r)) result.add(idx(pr, pc));
    for (const [pr, pc] of Board.colCells(c)) result.add(idx(pr, pc));
    for (const [pr, pc] of Board.boxCells(boxIndex(r, c))) result.add(idx(pr, pc));
    result.delete(idx(r, c));
    return result;
  }

  // ---- candidates ---------------------------------------------------------

  /** Legal digits for an empty cell, derived from current values. Empty set for a filled cell. */
  candidates(r: number, c: number): Set<number> {
    if (this.value(r, c) !== null) return new Set();
    const used = new Set<number>();
    for (const p of this.peers(r, c)) {
      const [pr, pc] = rc(p);
      const v = this.value(pr, pc);
      if (v !== null) used.add(v);
    }
    const out = new Set<number>();
    for (const d of DIGITS) if (!used.has(d)) out.add(d);
    return out;
  }

  // ---- status ---------------------------------------------------------

  isSolved(): boolean {
    return this.cells.every((cell) => cell.value !== null) && this.isValid();
  }

  /** No unit repeats a value. */
  isValid(): boolean {
    for (const [, unitCells] of this.units()) {
      const seen = new Set<number>();
      for (const [r, c] of unitCells) {
        const v = this.value(r, c);
        if (v === null) continue;
        if (seen.has(v)) return false;
        seen.add(v);
      }
    }
    return true;
  }

  /** True if invalid, or an empty cell has no candidates (dead end). */
  isBroken(): boolean {
    if (!this.isValid()) return true;
    for (let i = 0; i < N * N; i++) {
      const [r, c] = rc(i);
      if (this.value(r, c) === null && this.candidates(r, c).size === 0) return true;
    }
    return false;
  }

  // ---- serialization ------------------------------------------------------

  /** Build from a 9x9 of ints, where 0 means empty. Filled cells are givens when `givens` is true. */
  static fromGrid(rows: number[][], givens = true): Board {
    if (rows.length !== N || rows.some((row) => row.length !== N)) {
      throw new Error("fromGrid expects a 9x9 grid");
    }
    const cells = rows.flat().map((v) => ({
      value: v || null,
      isGiven: Boolean(v) && givens,
      pencilMarks: new Set<number>(),
      lowConfidence: false,
    }));
    return new Board(cells);
  }

  /** Build from an 81-char string; `0` or `.` is empty. */
  static fromString(s: string): Board {
    const chars = [...s].filter((ch) => "0123456789.".includes(ch));
    if (chars.length !== N * N) {
      throw new Error(`expected 81 cells, got ${chars.length}`);
    }
    const rows: number[][] = [];
    for (let i = 0; i < chars.length; i += N) {
      rows.push(chars.slice(i, i + N).map((ch) => (ch === "0" || ch === "." ? 0 : Number(ch))));
    }
    return Board.fromGrid(rows);
  }

  toWire(): WireBoard {
    return {
      cells: this.cells.map((cell) => ({
        value: cell.value,
        is_given: cell.isGiven,
        pencil_marks: [...cell.pencilMarks].sort((a, b) => a - b),
        low_confidence: cell.lowConfidence,
      })),
    };
  }

  static fromWire(data: WireBoard): Board {
    const cells = data.cells.map((c) => ({
      value: c.value,
      isGiven: Boolean(c.is_given),
      pencilMarks: new Set(c.pencil_marks ?? []),
      lowConfidence: Boolean(c.low_confidence),
    }));
    return new Board(cells);
  }
}
