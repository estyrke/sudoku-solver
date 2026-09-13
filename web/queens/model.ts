// Pure-logic Queens board model.
//
// No DOM, no fetch, no rendering — just the board, its units/peers/neighbors,
// and validity checks, so the local solver and the local hint engine share one
// implementation.
//
// Coordinates are 0-indexed (row, col) throughout, same as the Sudoku context.
// Unlike Sudoku, board size N is data, not fixed — real boards run roughly
// 6x6-11x11 — so every structural helper is an instance method (carrying `n`)
// rather than a module-level constant.
//
// Cells are also addressable by a single row-major index (0..n*n-1) — `idx`/
// `rc` below — because a JS `Set` compares arrays by identity, not value, so a
// set of coordinate pairs cannot dedupe the way Python's `set[tuple[int, int]]`
// does. Peers and neighbors are keyed by index for that reason; human-facing
// coordinates are still `[r, c]` pairs everywhere else.
//
// This module shares no code with web/sudoku/model.ts by design (see
// docs/adr/0001-sudoku-and-queens-as-separate-contexts.md).

export const EMPTY = "empty";
export const MARKED = "marked";
export const QUEEN = "queen";

export type CellState = typeof EMPTY | typeof MARKED | typeof QUEEN;

export const STATES: readonly CellState[] = Object.freeze([EMPTY, MARKED, QUEEN]);

export type Coord = readonly [number, number];

/**
 * A single square.
 *
 * `region` is the id of the Region this cell belongs to, or `null` if the cell
 * has not been painted into a region yet. `null` is the sentinel for
 * "unpainted" rather than e.g. a 0-id region, so a freshly-sized board (before
 * any palette painting) round-trips through the wire form without implying a
 * real region 0 exists. Unpainted cells never conflict with each other on
 * region grounds (see `Board.isValid`) since they carry no region identity.
 */
export interface Cell {
  state: CellState;
  region: number | null;
}

/** The board as the page passes it around: plain JSON, no class instances. */
export interface BoardWire {
  n: number;
  cells: Cell[];
}

/** Human label like `r4c3` (1-indexed). */
export function cellName(r: number, c: number): string {
  return `r${r + 1}c${c + 1}`;
}

/** An N x N Queens board plus the structural helpers techniques rely on. */
export class Board {
  readonly n: number;
  readonly cells: Cell[];

  constructor(n: number, cells?: Cell[]) {
    this.n = n;
    if (cells === undefined) {
      cells = Array.from({ length: n * n }, () => ({ state: EMPTY as CellState, region: null }));
    }
    if (cells.length !== n * n) {
      throw new Error(`a board of size ${n} needs exactly ${n * n} cells`);
    }
    this.cells = cells;
  }

  // ---- access ------------------------------------------------------------

  /** Row-major index of a cell. */
  idx(r: number, c: number): number {
    return r * this.n + c;
  }

  /** The (row, col) a row-major index refers to. */
  rc(i: number): Coord {
    return [Math.floor(i / this.n), i % this.n];
  }

  coords(): Coord[] {
    const result: Coord[] = [];
    for (let r = 0; r < this.n; r++) for (let c = 0; c < this.n; c++) result.push([r, c]);
    return result;
  }

  cell(r: number, c: number): Cell {
    return this.cells[this.idx(r, c)];
  }

  state(r: number, c: number): CellState {
    return this.cell(r, c).state;
  }

  setState(r: number, c: number, state: CellState): void {
    if (!STATES.includes(state)) throw new Error(`unknown cell state: ${state}`);
    this.cell(r, c).state = state;
  }

  region(r: number, c: number): number | null {
    return this.cell(r, c).region;
  }

  setRegion(r: number, c: number, regionId: number | null): void {
    this.cell(r, c).region = regionId;
  }

  queenCells(): Coord[] {
    return this.coords().filter(([r, c]) => this.state(r, c) === QUEEN);
  }

  // ---- units, peers & neighbors -------------------------------------------

  rowCells(r: number): Coord[] {
    return Array.from({ length: this.n }, (_, c) => [r, c] as Coord);
  }

  colCells(c: number): Coord[] {
    return Array.from({ length: this.n }, (_, r) => [r, c] as Coord);
  }

  /** Distinct region ids painted onto the board so far (excludes unpainted). */
  regionIds(): Set<number> {
    const ids = new Set<number>();
    for (const cell of this.cells) if (cell.region !== null) ids.add(cell.region);
    return ids;
  }

  regionCells(regionId: number): Coord[] {
    return this.coords().filter(([r, c]) => this.region(r, c) === regionId);
  }

  /** Every row, column and (painted) region as `{ label, cells }`. */
  units(): { label: string; cells: Coord[] }[] {
    const result: { label: string; cells: Coord[] }[] = [];
    for (let r = 0; r < this.n; r++) result.push({ label: `row ${r + 1}`, cells: this.rowCells(r) });
    for (let c = 0; c < this.n; c++) {
      result.push({ label: `column ${c + 1}`, cells: this.colCells(c) });
    }
    for (const regionId of [...this.regionIds()].sort((a, b) => a - b)) {
      result.push({ label: `region ${regionId}`, cells: this.regionCells(regionId) });
    }
    return result;
  }

  /**
   * Cells that must not hold another queen alongside `(r, c)` by virtue of
   * sharing its row, column or region — the Queens analogue of Sudoku's peers.
   * Does not include adjacency; see `neighbors` for that.
   */
  peers(r: number, c: number): Set<number> {
    const result = new Set<number>();
    for (const [pr, pc] of this.rowCells(r)) result.add(this.idx(pr, pc));
    for (const [pr, pc] of this.colCells(c)) result.add(this.idx(pr, pc));
    const regionId = this.region(r, c);
    if (regionId !== null) {
      for (const [pr, pc] of this.regionCells(regionId)) result.add(this.idx(pr, pc));
    }
    result.delete(this.idx(r, c));
    return result;
  }

  /** The up-to-8 cells adjacent to `(r, c)`, including diagonals, clipped to
   * the board edge. */
  neighbors(r: number, c: number): Set<number> {
    const result = new Set<number>();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < this.n && nc >= 0 && nc < this.n) result.add(this.idx(nr, nc));
      }
    }
    return result;
  }

  // ---- status ------------------------------------------------------------

  /** No two queens share a row, column or region, and no two queens are
   * adjacent (incl. diagonally). */
  isValid(): boolean {
    const queens = this.queenCells();
    const seenRows = new Set<number>();
    const seenCols = new Set<number>();
    const seenRegions = new Set<number>();
    for (const [r, c] of queens) {
      if (seenRows.has(r) || seenCols.has(c)) return false;
      seenRows.add(r);
      seenCols.add(c);
      const regionId = this.region(r, c);
      if (regionId !== null) {
        if (seenRegions.has(regionId)) return false;
        seenRegions.add(regionId);
      }
    }
    const queenIdx = new Set(queens.map(([r, c]) => this.idx(r, c)));
    for (const [r, c] of queens) {
      for (const i of this.neighbors(r, c)) if (queenIdx.has(i)) return false;
    }
    return true;
  }

  /** Every row, column and region holds exactly one queen. */
  isSolved(): boolean {
    if (!this.isValid()) return false;
    for (const { cells } of this.units()) {
      if (cells.filter(([r, c]) => this.state(r, c) === QUEEN).length !== 1) return false;
    }
    return true;
  }

  // ---- serialization ------------------------------------------------------

  /**
   * An empty board (no marks or queens) from an N x N grid of region ids — the
   * Queens analogue of Sudoku's `fromString`, but the "grid" being loaded is
   * region layout rather than digit values.
   */
  static fromGrid(regions: readonly (readonly number[])[]): Board {
    const rows = regions.map((row) => [...row]);
    const n = rows.length;
    if (rows.some((row) => row.length !== n)) {
      throw new Error("fromGrid expects a square N x N grid of region ids");
    }
    const cells: Cell[] = [];
    for (const row of rows) for (const rid of row) cells.push({ state: EMPTY, region: rid });
    return new Board(n, cells);
  }

  toWire(): BoardWire {
    return {
      n: this.n,
      cells: this.cells.map((cell) => ({ state: cell.state, region: cell.region })),
    };
  }

  static fromWire(data: BoardWire): Board {
    const cells = data.cells.map((c) => ({
      state: (c.state ?? EMPTY) as CellState,
      region: c.region ?? null,
    }));
    return new Board(data.n, cells);
  }
}
