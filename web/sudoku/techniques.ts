// Human solving techniques, ordered by difficulty — the TypeScript port of
// sudoku/solver/techniques.py.
//
// Each technique is a function `(board, cg) -> Hint | null` where `cg` is the
// working candidate grid: a candidate set per empty cell. A technique inspects
// `cg` and returns the *first* deduction it finds, or `null`. They never mutate
// anything — a hint describes one step, the caller decides whether to apply it.
//
// Passing `cg` in (rather than deriving it from values inside each technique)
// is what lets elimination steps persist: pointing/box-line/subset moves narrow
// `cg`, and a later single can then become visible. The caller seeds `cg` from
// the player's Pencil marks when present, falling back to Candidates derived
// from board values (see `workingCandidates` in hint.ts).
//
// This slice ports the classic (cage-free) techniques. The Cage-sum and 45-rule
// techniques are part of the same catalogue and keep their slots in the
// escalation order below; they arrive with the Killer slice (issue #21), which
// is also what brings Cage to the TypeScript Board.

import { Board, boxIndex, cellName, idx, rc, type Coord } from "./model.ts";

/**
 * Candidates per empty cell, keyed by row-major index.
 *
 * Keyed by index rather than by `[r, c]` because a JS `Map` compares array keys
 * by identity, so coordinate pairs could not be looked up by value the way
 * Python's `dict[tuple[int, int], set[int]]` can. Iteration order is insertion
 * order in both languages, and the callers build it row-major, so techniques
 * that return "the first cell that qualifies" pick the same cell as Python's.
 */
export type CandGrid = Map<number, Set<number>>;

/** One solving step. `action` is "place" (write `digits[0]` into `cells[0]`) or
 * "eliminate" (remove `digits` from the candidates of every cell in `cells`).
 * `level` ranks difficulty so callers can show "simplest first". */
export interface Hint {
  technique: string;
  level: number;
  action: "place" | "eliminate";
  cells: Coord[];
  digits: number[];
  units: string[];
  explanation: string;
}

// --- small helpers, mirroring the Python module's own -----------------------

/** Python's `repr` of a list of ints — `[1, 2]`. The explanations interpolate
 * sorted lists directly, and the wording is asserted on. */
function pyList(nums: number[]): string {
  return `[${nums.join(", ")}]`;
}

function names(cells: Coord[]): string {
  return cells.map(([r, c]) => cellName(r, c)).join(", ");
}

function empties(cells: Coord[], cg: CandGrid): Coord[] {
  return cells.filter(([r, c]) => cg.has(idx(r, c)));
}

const cand = (cg: CandGrid, cell: Coord): Set<number> => cg.get(idx(cell[0], cell[1]))!;

/** Coordinates in row-major order, as Python's `sorted()` leaves tuples. */
function sortCoords(cells: Coord[]): Coord[] {
  return [...cells].sort((a, b) => idx(a[0], a[1]) - idx(b[0], b[1]));
}

const sortNums = (nums: Iterable<number>): number[] => [...nums].sort((a, b) => a - b);

/** `itertools.combinations`: n-length tuples in input order, lexicographic. */
function* combinations<T>(items: readonly T[], n: number): Generator<T[]> {
  if (n > items.length) return;
  const pick: number[] = Array.from({ length: n }, (_, i) => i);
  for (;;) {
    yield pick.map((i) => items[i]);
    let i = n - 1;
    while (i >= 0 && pick[i] === i + items.length - n) i--;
    if (i < 0) return;
    pick[i]++;
    for (let j = i + 1; j < n; j++) pick[j] = pick[j - 1] + 1;
  }
}

function intersects(a: Set<number>, b: Set<number>): boolean {
  for (const d of a) if (b.has(d)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// The player's own notes
// ---------------------------------------------------------------------------

/** The placed `d` that makes it impossible at `cell`, and how it relates. */
function ruledOutBy(board: Board, cell: Coord, d: number): [Coord, string] | null {
  const [r, c] = cell;
  // Peers come back as indices, so ascending index is Python's `sorted(peers)`
  // over coordinate tuples — the same cell is blamed either way.
  for (const p of sortNums(board.peers(r, c))) {
    const [pr, pc] = rc(p);
    if (board.value(pr, pc) !== d) continue;
    if (pr === r) return [[pr, pc], `row ${r + 1}`];
    if (pc === c) return [[pr, pc], `column ${c + 1}`];
    if (boxIndex(pr, pc) === boxIndex(r, c)) return [[pr, pc], `box ${boxIndex(r, c) + 1}`];
    // Killer's cage-mate branch belongs here, and arrives with issue #21.
  }
  return null;
}

/**
 * Flag a Pencil mark that a placed digit already rules out.
 *
 * The engine reasons over the player's marks intersected with what is actually
 * legal, so an impossible mark is quietly ignored. That makes a later deduction
 * look like sleight of hand — "8 fits only in r8c9" reads as nonsense to
 * someone who can still see an 8 pencilled in r8c8. Correcting the marks is the
 * missing first step, not something to apply behind the player's back
 * (`sudoku/CONTEXT.md`, *Pencil mark*).
 */
export function impossiblePencilMark(board: Board, _cg: CandGrid): Hint | null {
  for (let i = 0; i < 81; i++) {
    const [r, c] = rc(i);
    if (board.value(r, c) !== null) continue;
    const marks = board.cell(r, c).pencilMarks;
    if (marks.size === 0) continue;
    const legal = board.candidates(r, c);
    const stale = sortNums([...marks].filter((d) => !legal.has(d)));
    if (stale.length === 0) continue;

    const blame = stale.map((d) => [d, ruledOutBy(board, [r, c], d)] as const);
    const parts = blame
      .filter(([, found]) => found !== null)
      .map(([d, found]) => `${d} is already in ${cellName(...found![0])} (${found![1]})`);
    const first = blame.map(([, found]) => found).find((found) => found !== null) ?? null;
    return {
      technique: "Impossible pencil mark",
      level: 0,
      action: "eliminate",
      cells: [[r, c]],
      digits: stale,
      units: first ? [first[1]] : [],
      explanation:
        `${cellName(r, c)} is pencilled ${stale.join(", ")}, but ` +
        parts.join("; ") +
        ". Rub that out before looking for anything cleverer — " +
        "the board reads differently once it's gone.",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Singles
// ---------------------------------------------------------------------------

export function nakedSingle(_board: Board, cg: CandGrid): Hint | null {
  for (const [i, cands] of cg) {
    if (cands.size !== 1) continue;
    const [r, c] = rc(i);
    const d = [...cands][0];
    return {
      technique: "Naked single",
      level: 1,
      action: "place",
      cells: [[r, c]],
      digits: [d],
      units: [],
      explanation: `${cellName(r, c)} has only one remaining candidate, ${d}, so it must go there.`,
    };
  }
  return null;
}

export function hiddenSingle(board: Board, cg: CandGrid): Hint | null {
  for (const [label, cells] of board.units()) {
    const open = empties(cells, cg);
    for (let d = 1; d <= 9; d++) {
      const holders = open.filter((cell) => cand(cg, cell).has(d));
      if (holders.length !== 1) continue;
      const [r, c] = holders[0];
      if (cand(cg, holders[0]).size === 1) continue; // a naked single; the simpler rule reports it
      return {
        technique: "Hidden single",
        level: 2,
        action: "place",
        cells: [[r, c]],
        digits: [d],
        units: [label],
        explanation: `In ${label}, ${d} fits only in ${cellName(r, c)}, so it must go there.`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Naked / hidden subsets
// ---------------------------------------------------------------------------

function nakedSubset(board: Board, cg: CandGrid, n: number, level: number, name: string): Hint | null {
  for (const [label, cells] of board.units()) {
    const open = empties(cells, cg);
    for (const combo of combinations(open, n)) {
      const union = new Set<number>();
      for (const cell of combo) for (const d of cand(cg, cell)) union.add(d);
      if (union.size !== n) continue;
      const inCombo = new Set(combo.map(([r, c]) => idx(r, c)));
      const elimCells = open.filter(
        (cell) => !inCombo.has(idx(cell[0], cell[1])) && intersects(cand(cg, cell), union),
      );
      if (elimCells.length === 0) continue;
      return {
        technique: `Naked ${name}`,
        level,
        action: "eliminate",
        cells: elimCells,
        digits: sortNums(union),
        units: [label],
        explanation:
          `In ${label}, ${names(combo)} together hold only ${pyList(sortNums(union))}, ` +
          `so those digits can be removed from ${names(elimCells)}.`,
      };
    }
  }
  return null;
}

export const nakedPair = (board: Board, cg: CandGrid) => nakedSubset(board, cg, 2, 3, "pair");
export const nakedTriple = (board: Board, cg: CandGrid) => nakedSubset(board, cg, 3, 4, "triple");
export const nakedQuad = (board: Board, cg: CandGrid) => nakedSubset(board, cg, 4, 5, "quad");

function hiddenSubset(board: Board, cg: CandGrid, n: number, level: number, name: string): Hint | null {
  for (const [label, cells] of board.units()) {
    const open = empties(cells, cg);
    const present: number[] = [];
    for (let d = 1; d <= 9; d++) {
      if (open.some((cell) => cand(cg, cell).has(d))) present.push(d);
    }
    for (const combo of combinations(present, n)) {
      const comboSet = new Set(combo);
      const holders = open.filter((cell) => intersects(cand(cg, cell), comboSet));
      if (holders.length !== n) continue;
      const elimCells = holders.filter((cell) => [...cand(cg, cell)].some((d) => !comboSet.has(d)));
      if (elimCells.length === 0) continue;
      const removedSet = new Set<number>();
      for (const cell of elimCells) {
        for (const d of cand(cg, cell)) if (!comboSet.has(d)) removedSet.add(d);
      }
      const removed = sortNums(removedSet);
      return {
        technique: `Hidden ${name}`,
        level,
        action: "eliminate",
        cells: sortCoords(elimCells),
        digits: removed,
        units: [label],
        explanation:
          `In ${label}, ${pyList(sortNums(combo))} appear only in ${names(sortCoords(holders))}, ` +
          `so other candidates (${pyList(removed)}) can be removed from those cells.`,
      };
    }
  }
  return null;
}

export const hiddenPair = (board: Board, cg: CandGrid) => hiddenSubset(board, cg, 2, 4, "pair");
export const hiddenTriple = (board: Board, cg: CandGrid) => hiddenSubset(board, cg, 3, 5, "triple");

// ---------------------------------------------------------------------------
// Intersections
// ---------------------------------------------------------------------------

/** Box -> line: a digit confined to one row/col within a box clears that line elsewhere. */
export function pointing(_board: Board, cg: CandGrid): Hint | null {
  for (let b = 0; b < 9; b++) {
    const box = empties(Board.boxCells(b), cg);
    const inBox = new Set(box.map(([r, c]) => idx(r, c)));
    for (let d = 1; d <= 9; d++) {
      const holders = box.filter((cell) => cand(cg, cell).has(d));
      if (holders.length < 2) continue;
      const rows = new Set(holders.map(([r]) => r));
      const cols = new Set(holders.map(([, c]) => c));
      let line: Coord[];
      let lineLabel: string;
      if (rows.size === 1) {
        const r = [...rows][0];
        line = empties(Board.rowCells(r), cg);
        lineLabel = `row ${r + 1}`;
      } else if (cols.size === 1) {
        const c = [...cols][0];
        line = empties(Board.colCells(c), cg);
        lineLabel = `column ${c + 1}`;
      } else {
        continue;
      }
      const elim = line.filter(
        (cell) => !inBox.has(idx(cell[0], cell[1])) && cand(cg, cell).has(d),
      );
      if (elim.length === 0) continue;
      return {
        technique: "Pointing pair/triple",
        level: 6,
        action: "eliminate",
        cells: elim,
        digits: [d],
        units: [`box ${b + 1}`, lineLabel],
        explanation:
          `In box ${b + 1}, ${d} can only sit in ${lineLabel} (${names(holders)}), ` +
          `so ${d} is removed from the rest of ${lineLabel}: ${names(elim)}.`,
      };
    }
  }
  return null;
}

/** Line -> box: a digit confined to one box within a row/col clears the rest of that box. */
export function claiming(_board: Board, cg: CandGrid): Hint | null {
  const lines: [string, Coord[]][] = [];
  for (let r = 0; r < 9; r++) lines.push([`row ${r + 1}`, Board.rowCells(r)]);
  for (let c = 0; c < 9; c++) lines.push([`column ${c + 1}`, Board.colCells(c)]);
  for (const [label, cells] of lines) {
    const open = empties(cells, cg);
    for (let d = 1; d <= 9; d++) {
      const holders = open.filter((cell) => cand(cg, cell).has(d));
      if (holders.length < 2) continue;
      const boxes = new Set(holders.map(([r, c]) => boxIndex(r, c)));
      if (boxes.size !== 1) continue;
      const b = [...boxes][0];
      const held = new Set(holders.map(([r, c]) => idx(r, c)));
      const box = empties(Board.boxCells(b), cg);
      const elim = box.filter((cell) => !held.has(idx(cell[0], cell[1])) && cand(cg, cell).has(d));
      if (elim.length === 0) continue;
      return {
        technique: "Box/line reduction",
        level: 6,
        action: "eliminate",
        cells: elim,
        digits: [d],
        units: [label, `box ${b + 1}`],
        explanation:
          `In ${label}, ${d} can only sit inside box ${b + 1} (${names(holders)}), ` +
          `so ${d} is removed from the rest of box ${b + 1}: ${names(elim)}.`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fish
// ---------------------------------------------------------------------------

export function xWing(_board: Board, cg: CandGrid): Hint | null {
  const search = (byRow: boolean): Hint | null => {
    for (let d = 1; d <= 9; d++) {
      const positions = new Map<number, number[]>();
      for (let i = 0; i < 9; i++) {
        const cross: number[] = [];
        for (let j = 0; j < 9; j++) {
          const [r, c] = byRow ? [i, j] : [j, i];
          if (cg.get(idx(r, c))?.has(d)) cross.push(j);
        }
        if (cross.length === 2) positions.set(i, cross);
      }
      for (const [a, b] of combinations([...positions.keys()], 2)) {
        const pa = positions.get(a)!;
        const pb = positions.get(b)!;
        if (pa[0] !== pb[0] || pa[1] !== pb[1]) continue;
        const elim: Coord[] = [];
        for (let k = 0; k < 9; k++) {
          if (k === a || k === b) continue;
          for (const cross of pa) {
            const [r, c] = byRow ? [k, cross] : [cross, k];
            if (cg.get(idx(r, c))?.has(d)) elim.push([r, c]);
          }
        }
        if (elim.length === 0) continue;
        const orient = byRow ? "rows" : "columns";
        return {
          technique: "X-Wing",
          level: 7,
          action: "eliminate",
          cells: elim,
          digits: [d],
          units: [],
          explanation:
            `${d} forms an X-Wing across ${orient} ${a + 1} and ${b + 1}, ` +
            `so ${d} is removed from ${names(elim)}.`,
        };
      }
    }
    return null;
  };
  return search(true) ?? search(false);
}

export type Technique = (board: Board, cg: CandGrid) => Hint | null;

/**
 * Ordered simplest -> hardest. `findHint` walks this list and returns the first
 * hit, so this order *is* the behaviour: which technique fires on a given board
 * follows from it, and the tests pin it.
 *
 * Killer's `cageSum` sits between the singles and the subsets, and its
 * `fortyFiveRule` directly after; `fortyFiveSets` goes last of all. Those slots
 * are reserved rather than filled — they arrive with issue #21.
 */
export const TECHNIQUES: Technique[] = [
  // First: the player's own notes must be right before anything derived from
  // them will make sense to them.
  impossiblePencilMark,
  nakedSingle,
  hiddenSingle,
  // cageSum,        (Killer — issue #21)
  // fortyFiveRule,  (Killer — issue #21)
  nakedPair,
  nakedTriple,
  hiddenPair,
  nakedQuad,
  hiddenTriple,
  pointing,
  claiming,
  xWing,
  // fortyFiveSets,  (Killer — issue #21; last, being the hardest to see by hand)
];
