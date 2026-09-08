// Pure-logic Sudoku board model.
//
// No DOM, no fetch, no rendering: just the grid, its units/peers, candidate
// derivation and validity checks, so the local solver, the local hint engine
// and the Killer audit can share one implementation instead of each growing its
// own.
//
// Killer's Cage lives here rather than in a sibling type — see
// docs/adr/0002-killer-sudoku-extends-sudoku-context.md. A Board with no cages
// is an ordinary classic board, which is what the Sudoku tab builds.
//
// Coordinates are 0-indexed (row, col) throughout, exactly as in the Python
// model. Cells are also addressable by a single row-major index (0..80) —
// `idx`/`rc` below — because a JS `Set` compares objects/tuples by identity,
// not value, so a set of coordinate pairs can't dedupe the way Python's
// `set[tuple[int, int]]` does. Peers, candidates and cage membership are keyed
// by index for that reason; human-facing coordinates are still `[r, c]` pairs
// everywhere else, matching the Python API.

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

/** Smallest and largest totals reachable by `size` distinct digits 1-9. */
export function sumBounds(size: number): [number, number] {
  let lo = 0;
  let hi = 0;
  for (let i = 1; i <= size; i++) lo += i;
  for (let i = N; i > N - size; i--) hi += i;
  return [lo, hi];
}

/** A set of digits 1-9 as a bitmask, so it can key a cache. */
export function digitMask(digits: Iterable<number>): number {
  let mask = 0;
  for (const d of digits) mask |= 1 << d;
  return mask;
}

const reachCache = new Map<number, boolean>();

/**
 * Whether `size` distinct digits drawn from `allowed` can total `total`.
 *
 * Pure arithmetic reachability — it says nothing about whether those digits can
 * legally be placed given the rest of the board.
 *
 * Cached, as the Python `lru_cache` is: the solver asks this once per candidate
 * per cage per node, and there are only a few thousand distinct questions to
 * ask. `allowed` is reduced to a 10-bit mask (see `digitMask`) so the cache key
 * is a single number; callers deep in the search pass the mask directly.
 */
export function canReach(size: number, total: number, allowed: Iterable<number> | number): boolean {
  const mask = typeof allowed === "number" ? allowed : digitMask(allowed);
  if (size === 0) return total === 0;
  if (total < 0) return false;
  const key = (size << 16) | (total << 10) | mask;
  const cached = reachCache.get(key);
  if (cached !== undefined) return cached;

  const pool: number[] = [];
  for (let d = 1; d <= N; d++) if (mask & (1 << d)) pool.push(d);
  const answer = pool.length < size ? false : pick(pool, 0, size, total);
  reachCache.set(key, answer);
  return answer;
}

/** Whether `k` of `pool[from..]` (ascending, distinct) total `rest`. */
function pick(pool: number[], from: number, k: number, rest: number): boolean {
  if (k === 0) return rest === 0;
  if (pool.length - from < k) return false;
  // The smallest and the largest `k` still available bracket what is reachable,
  // so a total outside them prunes the whole branch.
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < k; i++) {
    lo += pool[from + i];
    hi += pool[pool.length - 1 - i];
  }
  if (rest < lo || rest > hi) return false;
  for (let i = from; i <= pool.length - k; i++) {
    if (pick(pool, i + 1, k - 1, rest - pool[i])) return true;
  }
  return false;
}

/** True if `indices` form one orthogonally-connected group (no diagonals). */
function isContiguous(indices: ReadonlySet<number>): boolean {
  const start = indices.values().next().value as number;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const [r, c] = rc(stack.pop()!);
    for (const [nr, nc] of [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ]) {
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      const next = idx(nr, nc);
      if (indices.has(next) && !seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen.size === indices.size;
}

/**
 * A Killer cage: 2+ orthogonally-contiguous cells whose digits are distinct and
 * total `sum`.
 *
 * Not a Unit — a cage need not contain every digit 1-9. See `sudoku/CONTEXT.md`.
 *
 * `cells` is row-major sorted, so `cells[0]` is the anchor the UI prints the sum
 * in — Python's `min(cage.cells)`. `indices` is the same set keyed by row-major
 * index, which is what the 45-rule's set arithmetic needs.
 */
export class Cage {
  readonly cells: readonly Coord[];
  readonly indices: ReadonlySet<number>;
  readonly sum: number;

  constructor(cells: Iterable<Coord>, sum: number) {
    const indices = new Set<number>();
    for (const [r, c] of cells) {
      if (!(r >= 0 && r < N && c >= 0 && c < N)) {
        throw new Error("cage cells must be on the board");
      }
      indices.add(idx(r, c));
    }
    if (indices.size < 2) throw new Error("a cage needs at least 2 cells");
    if (indices.size > N) throw new Error("a cage cannot exceed 9 cells (digits must differ)");
    if (!isContiguous(indices)) throw new Error("a cage's cells must be orthogonally contiguous");
    const [lo, hi] = sumBounds(indices.size);
    if (!(lo <= sum && sum <= hi)) {
      throw new Error(`a ${indices.size}-cell cage must total ${lo}..${hi}, got ${sum}`);
    }
    this.indices = indices;
    this.cells = [...indices].sort((a, b) => a - b).map(rc);
    this.sum = sum;
  }

  /** The topmost-then-leftmost cell — Python's `min(cage.cells)`. */
  get anchor(): Coord {
    return this.cells[0];
  }
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

export interface WireCage {
  cells: { r: number; c: number }[];
  sum: number;
}

export interface WireBoard {
  cells: WireCell[];
  cages?: WireCage[];
}

/** A 9x9 Sudoku grid plus the structural helpers techniques rely on. */
export class Board {
  readonly cells: Cell[];
  readonly cages: Cage[];
  private readonly cageOf = new Map<number, Cage>();

  constructor(cells?: Cell[], cages?: Iterable<Cage>) {
    if (cells !== undefined && cells.length !== N * N) {
      throw new Error("a board needs exactly 81 cells");
    }
    this.cells = cells ?? Array.from({ length: N * N }, emptyCell);
    this.cages = [...(cages ?? [])];
    for (const cage of this.cages) {
      for (const i of cage.indices) {
        if (this.cageOf.has(i)) {
          throw new Error(`${cellName(...rc(i))} is in more than one cage`);
        }
        this.cageOf.set(i, cage);
      }
    }
  }

  // ---- cages ----------------------------------------------------------

  /** The cage containing `(r, c)`, or `null` on an uncaged cell. */
  cageAt(r: number, c: number): Cage | null {
    return this.cageOf.get(idx(r, c)) ?? null;
  }

  /**
   * Whether every cell belongs to a cage — true of a complete Killer board.
   *
   * Not an invariant: a board is legitimately part-caged while being entered.
   */
  isFullyCaged(): boolean {
    return this.cageOf.size === N * N;
  }

  /** Whether `cage` can still be completed: no repeated digit, no overshoot,
   * and a remainder its empty cells could actually total. */
  cageIsFeasible(cage: Cage): boolean {
    let soFar = 0;
    let empty = 0;
    let unused = digitMask(DIGITS);
    for (const [r, c] of cage.cells) {
      const v = this.value(r, c);
      if (v === null) {
        empty++;
        continue;
      }
      if (!(unused & (1 << v))) return false; // the same digit twice in one cage
      unused &= ~(1 << v);
      soFar += v;
    }
    if (empty === 0) return soFar === cage.sum;
    if (soFar >= cage.sum) return false;
    return canReach(empty, cage.sum - soFar, unused);
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
   * sharing a row, column or box, plus its cage-mates. An instance method, not
   * a static one, because cage membership is per-board data — see
   * `sudoku/CONTEXT.md`, *Peer*.
   */
  peers(r: number, c: number): Set<number> {
    const result = new Set<number>();
    for (const [pr, pc] of Board.rowCells(r)) result.add(idx(pr, pc));
    for (const [pr, pc] of Board.colCells(c)) result.add(idx(pr, pc));
    for (const [pr, pc] of Board.boxCells(boxIndex(r, c))) result.add(idx(pr, pc));
    const cage = this.cageAt(r, c);
    if (cage !== null) for (const i of cage.indices) result.add(i);
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

  /** No unit repeats a value, and every cage is still completable. */
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
    return this.cages.every((cage) => this.cageIsFeasible(cage));
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
    const data: WireBoard = {
      cells: this.cells.map((cell) => ({
        value: cell.value,
        is_given: cell.isGiven,
        pencil_marks: [...cell.pencilMarks].sort((a, b) => a - b),
        low_confidence: cell.lowConfidence,
      })),
    };
    // Omitted rather than empty on a cageless board, as Python's `to_dict` does:
    // a classic board's wire form says nothing about Killer.
    if (this.cages.length > 0) {
      data.cages = this.cages.map((cage) => ({
        cells: cage.cells.map(([r, c]) => ({ r, c })),
        sum: cage.sum,
      }));
    }
    return data;
  }

  static fromWire(data: WireBoard): Board {
    const cells = data.cells.map((c) => ({
      value: c.value,
      isGiven: Boolean(c.is_given),
      pencilMarks: new Set(c.pencil_marks ?? []),
      lowConfidence: Boolean(c.low_confidence),
    }));
    const cages = (data.cages ?? []).map(
      (cage) => new Cage(cage.cells.map((cell) => [cell.r, cell.c] as Coord), cage.sum),
    );
    return new Board(cells, cages);
  }
}
