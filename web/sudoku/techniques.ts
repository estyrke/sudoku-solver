// Human solving techniques, ordered by difficulty.
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
// The catalogue holds the classic techniques and Killer's Cage-sum and 45-rule
// ones together, in one escalation order — Killer is part of this context, not
// a separate one (docs/adr/0002-killer-sudoku-extends-sudoku-context.md). On a
// board with no cages the Killer techniques return `null` immediately, so a
// classic board pays nothing for them.

import { Board, Cage, DIGITS, boxIndex, cellName, idx, rc, type Coord } from "./model.ts";

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

function empties(cells: readonly Coord[], cg: CandGrid): Coord[] {
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
  const cage = board.cageAt(r, c);
  // Peers come back as indices, so ascending index is Python's `sorted(peers)`
  // over coordinate tuples — the same cell is blamed either way.
  for (const p of sortNums(board.peers(r, c))) {
    const [pr, pc] = rc(p);
    if (board.value(pr, pc) !== d) continue;
    if (pr === r) return [[pr, pc], `row ${r + 1}`];
    if (pc === c) return [[pr, pc], `column ${c + 1}`];
    if (boxIndex(pr, pc) === boxIndex(r, c)) return [[pr, pc], `box ${boxIndex(r, c) + 1}`];
    if (cage !== null && cage.indices.has(p)) return [[pr, pc], cageLabel(cage)];
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
 *
 * It matters most on Killer boards, where a cage-mate rules out a digit even
 * though it shares no row, column or box — a constraint most apps' auto-notes
 * don't apply.
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


// ---------------------------------------------------------------------------
// Killer Sudoku: cage sums
// ---------------------------------------------------------------------------

/** `the 15-cage at r1c1` — anchored on the topmost-then-leftmost cell, the same
 * one the UI prints the sum in. */
function cageLabel(cage: Cage): string {
  return `the ${cage.sum}-cage at ${cellName(...cage.anchor)}`;
}

/**
 * Whether `digits` can be dealt one-each to `cells` respecting candidates.
 *
 * A combination can total correctly yet still be impossible — e.g. {1,3} is no
 * use if both cells have already lost the 3. Matching cells to digits rules that
 * out, keeping eliminations sound.
 */
function dealsOut(digits: readonly number[], cells: Coord[], cg: CandGrid): boolean {
  const owner = new Map<number, Coord>(); // index into digits -> cell holding it

  const place = (cell: Coord, tried: Set<number>): boolean => {
    for (let i = 0; i < digits.length; i++) {
      if (tried.has(i) || !cand(cg, cell).has(digits[i])) continue;
      tried.add(i);
      if (!owner.has(i) || place(owner.get(i)!, tried)) {
        owner.set(i, cell);
        return true;
      }
    }
    return false;
  };

  return cells.every((cell) => place(cell, new Set()));
}

export interface CageOptions {
  empties: Coord[];
  /** Per empty cell (by row-major index): the digits some workable set puts there. */
  allowed: Map<number, Set<number>>;
  combos: number[][];
  remaining: number;
}

/**
 * For one group of cells that must hold *distinct* digits totalling `total`: its
 * empty cells, the digits actually placeable in each, and the combinations
 * considered. `null` when the group has nothing to say.
 *
 * Distinctness is the caller's promise, not something checked here. A cage has
 * it by rule; a 45-rule leftover only when its cells share a unit, which is what
 * `allDistinct` is for.
 */
export function groupOptions(
  board: Board,
  cg: CandGrid,
  cells: readonly Coord[],
  total: number,
): CageOptions | null {
  const open = empties(cells, cg);
  if (open.length === 0) return null;
  const filled: number[] = [];
  for (const [r, c] of cells) {
    const v = board.value(r, c);
    if (v !== null) filled.push(v);
  }
  const remaining = total - filled.reduce((a, b) => a + b, 0);
  const used = new Set(filled);
  const pool = DIGITS.filter((d) => !used.has(d));

  const combos: number[][] = [];
  const allowed = new Map<number, Set<number>>(open.map(([r, c]) => [idx(r, c), new Set<number>()]));
  for (const combo of combinations(pool, open.length)) {
    if (combo.reduce((a, b) => a + b, 0) !== remaining) continue;
    if (!dealsOut(combo, open, cg)) continue;
    combos.push(combo);
    for (const cell of open) {
      const mine = allowed.get(idx(cell[0], cell[1]))!;
      const others = open.filter((x) => idx(x[0], x[1]) !== idx(cell[0], cell[1]));
      for (const d of combo) {
        if (!cand(cg, cell).has(d) || mine.has(d)) continue;
        // A combination's digits are distinct, so this drops exactly the one.
        const rest = combo.filter((x) => x !== d);
        if (dealsOut(rest, others, cg)) mine.add(d);
      }
    }
  }
  // No workable set at all means the group is unsatisfiable; that's isValid's
  // business, not a hint's.
  if (combos.length === 0) return null;
  return { empties: open, allowed, combos, remaining };
}

/** `groupOptions` for a cage, whose distinctness and total are its own.
 *
 * Exported for the tests, which check what a cage with many workable sets does —
 * the number of sets decides how the hint is *worded*, so asserting on it
 * directly beats inferring it from the wording. */
export function cageOptions(board: Board, cg: CandGrid, cage: Cage): CageOptions | null {
  return groupOptions(board, cg, cage.cells, cage.sum);
}

function comboList(combos: number[][]): string {
  return combos.map((combo) => "{" + combo.join("") + "}").join(", ");
}

// The combination list is checked by hand — the player has to hold every set in
// their head and confirm the digit really is absent from (or present in) all of
// them. Past a handful that stops being an explanation and becomes an assertion:
// "the only workable sets are {13579}, {13678}, {14569} and 17 more, so 2 cannot
// go in r4c8" is impossible to verify, and impossible to act on if the reason it
// fires is a mistyped pencil mark rather than a real deduction.
//
// So this caps what gets *listed*, not what gets deduced. A cage with more sets
// than this still speaks, but it states the consequence instead of the working:
// "there are 17 ways to make that total and none of them puts a 2 in r6c6". The
// player checks the one claim rather than re-deriving seventeen sets, and the
// board moves. Capping the deduction itself was the earlier behaviour and it
// cost real boards: a 20-cage over four cells is exactly where combination
// analysis earns its keep and exactly where the list is too long to print.
export const MAX_LISTED_COMBOS = 4;

/** `1`, `1 or 2`, `1, 2 or 3` — for a claim about digits rather than a list. */
function orList(nums: number[]): string {
  if (nums.length === 1) return `${nums[0]}`;
  return `${nums.slice(0, -1).join(", ")} or ${nums[nums.length - 1]}`;
}

/** How many ways a group can make its total: `2 ways`, `17 ways`. */
function waysPhrase(n: number): string {
  return n === 1 ? "1 way" : `${n} ways`;
}

/**
 * The loosest bounds on what `cells` can total between them.
 *
 * Bounds the sum by the smallest and the largest distinct digits still pencilled
 * anywhere across the group. That is weaker than a true per-cell assignment — it
 * admits totals no real placement reaches — but it is only ever used to *prove* a
 * digit impossible, and a bound that admits too much never proves too much. It
 * buys a one-line argument the player can check against their own marks instead
 * of a list of sets they have to take on trust.
 */
function reach(cells: readonly Coord[], cg: CandGrid): [number, number] | null {
  if (cells.length === 0) return null;
  const union = new Set<number>();
  for (const cell of cells) for (const d of cand(cg, cell)) union.add(d);
  const pool = sortNums(union);
  if (pool.length < cells.length) return null;
  const k = cells.length;
  const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
  return [sum(pool.slice(0, k)), sum(pool.slice(pool.length - k))];
}

function cellsPhrase(n: number): string {
  return n === 1 ? "cell" : `${n} cells`;
}

/**
 * Digits `cell` can't hold because of what the rest of the cage must total.
 *
 * What the other cells can reach pins `cell` between two values, so a whole run
 * of digits falls at once — the elimination and its reason are the same sentence.
 */
export function squeezedOut(
  cell: Coord,
  group: readonly Coord[],
  cg: CandGrid,
  remaining: number,
): [number[], string] | null {
  const others = group.filter((x) => idx(x[0], x[1]) !== idx(cell[0], cell[1]));
  const bounds = reach(others, cg);
  if (bounds === null) return null;
  const [low, high] = bounds;
  const n = cellsPhrase(others.length);
  const tooSmall = sortNums([...cand(cg, cell)].filter((d) => remaining - d > high));
  if (tooSmall.length > 0) {
    return [
      tooSmall,
      `The other ${n} can total at most ${high}, so ${cellName(...cell)} ` +
        `must be at least ${remaining - high}`,
    ];
  }
  const tooBig = sortNums([...cand(cg, cell)].filter((d) => remaining - d < low));
  if (tooBig.length > 0) {
    return [
      tooBig,
      `The other ${n} can total at least ${low}, so ${cellName(...cell)} ` +
        `must be at most ${remaining - low}`,
    ];
  }
  return null;
}

/**
 * Restrict a cage's candidates to digit sets that can reach its sum.
 *
 * Purely about sum reachability — a cage's no-repeat rule is already handled by
 * cage-mates being peers, so it never has to be re-derived here.
 *
 * Cages are worked cheapest-first rather than in board order, and the wording
 * prefers a bound over a list of sets, because a hint nobody can follow is worse
 * than no hint: it leaves the player unable to tell a real deduction from a
 * consequence of one bad pencil mark.
 *
 * Four passes, in the order a player would want them: a forced placement; a
 * digit the arithmetic squeezes out in one line; a short list of sets; and last
 * a cage whose sets are too many to list, which states its conclusion instead
 * (see `MAX_LISTED_COMBOS`). The last pass is the one that carries a hard board
 * — the earlier three all go quiet long before the cage arithmetic runs out.
 */
export function cageSum(board: Board, cg: CandGrid): Hint | null {
  if (board.cages.length === 0) return null;
  const analysed: [Cage, CageOptions][] = [];
  for (const cage of board.cages) {
    const options = cageOptions(board, cg, cage);
    if (options !== null) analysed.push([cage, options]);
  }
  // Fewest sets to check first, then fewest cells — the shortest argument wins.
  // Both languages sort stably, so cages that tie stay in board order.
  analysed.sort(
    ([, a], [, b]) => a.combos.length - b.combos.length || a.empties.length - b.empties.length,
  );
  const short = analysed.filter(([, a]) => a.combos.length <= MAX_LISTED_COMBOS);

  // A cell only one digit can occupy is the stronger deduction, so look first.
  for (const [cage, { empties: open, allowed, combos, remaining }] of short) {
    for (const cell of open) {
      const mine = allowed.get(idx(cell[0], cell[1]))!;
      if (mine.size === 1 && cand(cg, cell).size > 1) {
        const d = [...mine][0];
        return {
          technique: "Cage sum",
          level: 3,
          action: "place",
          cells: [cell],
          digits: [d],
          units: [cageLabel(cage)],
          explanation:
            `${cageLabel(cage)} needs ${remaining} more across ` +
            `${cellsPhrase(open.length)}. The only workable sets are ` +
            `${comboList(combos)}, and every one of them puts ${d} ` +
            `in ${cellName(...cell)}.`,
        };
      }
    }
  }

  // Digits the cage's arithmetic squeezes out are one line to check, so they beat
  // any set list — even a set list from a cage with fewer combinations.
  for (const [cage, { empties: open, allowed, remaining }] of analysed) {
    for (const cell of open) {
      if (allowed.get(idx(cell[0], cell[1]))!.size === 0) continue;
      const squeezed = squeezedOut(cell, open, cg, remaining);
      if (squeezed === null) continue;
      const [gone, why] = squeezed;
      return {
        technique: "Cage sum",
        level: 3,
        action: "eliminate",
        cells: [cell],
        digits: gone,
        units: [cageLabel(cage)],
        explanation:
          `${cageLabel(cage)} needs ${remaining} more across ` +
          `${cellsPhrase(open.length)}. ${why} — ` +
          `${gone.join(", ")} cannot go there.`,
      };
    }
  }

  for (const [cage, { empties: open, allowed, combos, remaining }] of short) {
    for (const cell of open) {
      const mine = allowed.get(idx(cell[0], cell[1]))!;
      const gone = sortNums([...cand(cg, cell)].filter((d) => !mine.has(d)));
      if (gone.length > 0 && mine.size > 0) {
        return {
          technique: "Cage sum",
          level: 3,
          action: "eliminate",
          cells: [cell],
          digits: gone,
          units: [cageLabel(cage)],
          explanation:
            `${cageLabel(cage)} needs ${remaining} more across ` +
            `${cellsPhrase(open.length)}. The only workable sets are ` +
            `${comboList(combos)}, so ` +
            `${gone.join(", ")} cannot go in ${cellName(...cell)}.`,
        };
      }
    }
  }

  // Last: cages with more sets than anyone will check. Same deduction, stated
  // as its conclusion rather than its working — one claim to verify instead of
  // a list to re-derive.
  for (const [cage, { empties: open, allowed, combos, remaining }] of analysed) {
    if (combos.length <= MAX_LISTED_COMBOS) continue;
    for (const cell of open) {
      const mine = allowed.get(idx(cell[0], cell[1]))!;
      const gone = sortNums([...cand(cg, cell)].filter((d) => !mine.has(d)));
      if (gone.length > 0 && mine.size > 0) {
        return {
          technique: "Cage sum",
          level: 3,
          action: "eliminate",
          cells: [cell],
          digits: gone,
          units: [cageLabel(cage)],
          explanation:
            `${cageLabel(cage)} needs ${remaining} more across ` +
            `${cellsPhrase(open.length)}. There are ${waysPhrase(combos.length)} to do that, ` +
            `and not one of them puts ${orList(gone)} in ${cellName(...cell)}.`,
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Killer Sudoku: the 45-rule (innies and outies)
// ---------------------------------------------------------------------------

/** 45 — every unit holds each digit exactly once. */
export const UNIT_TOTAL = DIGITS.reduce((a, b) => a + b, 0);

/** A span of the board, by row-major index, and what its cells must total. */
export interface Span {
  label: string;
  cells: Set<number>;
  total: number;
}

function covered(cages: Cage[]): Set<number> {
  const out = new Set<number>();
  for (const cage of cages) for (const i of cage.indices) out.add(i);
  return out;
}

const isSubset = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean => {
  for (const i of a) if (!b.has(i)) return false;
  return true;
};

const meets = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean => {
  for (const i of a) if (b.has(i)) return true;
  return false;
};

const without = (a: ReadonlySet<number>, b: ReadonlySet<number>): Set<number> => {
  const out = new Set<number>();
  for (const i of a) if (!b.has(i)) out.add(i);
  return out;
};

// How many units a 45-rule span may cover. Two and three rows (or columns) are
// where the rule earns its keep: a single row often has no cage lying wholly
// inside it, while a band of two or three usually does, and the arithmetic
// closes on a band exactly as it does on one unit. On the board that prompted
// this, every single unit was silent and rows 1-2 immediately pinned a cell.
export const MAX_BAND = 3;

/**
 * Every span the 45-rule can be applied to.
 *
 * The nine rows, columns and boxes; runs of two and three adjacent rows or
 * columns; and pairs of boxes sharing a band or a stack. Adjacent only because
 * that is where cages cluster: any set of whole units is arithmetically valid,
 * but scanning all of them costs far more and finds almost nothing.
 *
 * Box pairs are the cheap half of a chute. All three boxes of a band are just
 * that band's rows, already yielded above — but two of them are a shape no row
 * or column span has, and cages that straddle a box boundary without leaving
 * the band close on it when they close on nothing else. On the Killer board that
 * prompted this, boxes 1+2 left three innies totalling 7, which was the whole
 * unlock; every row, column and band on that board was silent.
 */
export function* spans(board: Board): Generator<Span> {
  for (const [label, cells] of board.units()) {
    yield { label, cells: new Set(cells.map(([r, c]) => idx(r, c))), total: UNIT_TOTAL };
  }
  for (let n = 2; n <= MAX_BAND; n++) {
    for (let start = 0; start <= 9 - n; start++) {
      const range = `${start + 1}-${start + n}`;
      const rows = new Set<number>();
      const cols = new Set<number>();
      for (let k = start; k < start + n; k++) {
        for (let j = 0; j < 9; j++) {
          rows.add(idx(k, j));
          cols.add(idx(j, k));
        }
      }
      yield { label: `rows ${range}`, cells: rows, total: UNIT_TOTAL * n };
      yield { label: `columns ${range}`, cells: cols, total: UNIT_TOTAL * n };
    }
  }
  for (const [a, b] of boxPairs()) {
    const cells = new Set<number>();
    for (const box of [a, b]) {
      for (const [r, c] of Board.boxCells(box)) cells.add(idx(r, c));
    }
    yield { label: `boxes ${a + 1}+${b + 1}`, cells, total: UNIT_TOTAL * 2 };
  }
}

/** The 18 pairs of boxes sharing a band (1+2, 1+3, 2+3, ...) or a stack. */
function* boxPairs(): Generator<[number, number]> {
  for (let group = 0; group < 3; group++) {
    const band = [0, 1, 2].map((k) => group * 3 + k);
    const stack = [0, 1, 2].map((k) => k * 3 + group);
    for (const boxes of [band, stack]) {
      for (const [a, b] of combinations(boxes, 2)) yield [a, b];
    }
  }
}

/** What a span's 45-rule arithmetic leaves over: `kind`, the cells, what they
 * owe, and the cages' own total (carried so the explanation can show the
 * subtraction rather than assert its result). */
export interface Leftover {
  kind: "innie" | "outie";
  cells: Set<number>;
  owed: number;
  held: number;
}

/**
 * The cells a span's 45-rule arithmetic leaves over, and what they total.
 *
 * The *innies* are the span's cells no cage inside it covers; the *outies* are
 * the cells outside it that the cages meeting it spill onto.
 */
export function* unaccounted(board: Board, span: Set<number>, total: number): Generator<Leftover> {
  const inside = board.cages.filter((cage) => isSubset(cage.indices, span));
  const innies = without(span, covered(inside));
  if (innies.size > 0) {
    const held = inside.reduce((n, cage) => n + cage.sum, 0);
    yield { kind: "innie", cells: innies, owed: total - held, held };
  }

  const touching = board.cages.filter((cage) => meets(cage.indices, span));
  const reachable = covered(touching);
  if (isSubset(span, reachable)) {
    // Otherwise part of the span is uncaged and nothing closes.
    const outies = without(reachable, span);
    if (outies.size > 0) {
      const held = touching.reduce((n, cage) => n + cage.sum, 0);
      yield { kind: "outie", cells: outies, owed: held - total, held };
    }
  }
}

/** Whether `value` at `cell` is a placement worth reporting. */
export function fortyFivePlacement(cg: CandGrid, cell: Coord, value: number): boolean {
  const cands = cg.get(idx(cell[0], cell[1]));
  if (!(value >= 1 && value <= 9) || cands === undefined) return false;
  if (!cands.has(value)) return false; // contradiction, not a hint — isValid's business
  return cands.size > 1; // a lone candidate is a naked single, reported simpler
}

/**
 * Pin a single innie or outie by the 45-rule.
 *
 * Two arithmetic shapes, both from "every unit totals 45":
 *
 * *Innie* — the cages lying wholly inside a span cover all but one of its cells,
 * so that cell holds `total - (those cages' sum)`.
 *
 * *Outie* — the cages meeting a span cover it entirely and spill outside it by
 * exactly one cell, so that cell holds `(their sum) - total`.
 *
 * Applied to runs of up to three rows or columns as well as to single units; see
 * `spans`. When more than one cell is left over the difference constrains a set
 * rather than pinning a value — that is `fortyFiveSets`, which is a harder read
 * and sits much later in the catalogue.
 */
export function fortyFiveRule(board: Board, cg: CandGrid): Hint | null {
  if (board.cages.length === 0) return null;

  for (const { label, cells: span, total } of spans(board)) {
    for (const { kind, cells, owed, held } of unaccounted(board, span, total)) {
      if (cells.size !== 1) continue;
      const cell = rc(cells.values().next().value as number);
      if (!fortyFivePlacement(cg, cell, owed)) continue;
      const name = cellName(...cell);
      const why =
        kind === "innie"
          ? `The cages wholly inside ${label} total ${held} and cover all ` +
            `but ${name}. ${label} must total ${total}, so ${name} is ` +
            `${total} − ${held} = ${owed}.`
          : `The cages meeting ${label} total ${held} and cover it ` +
            `entirely, sticking out only into ${name}. ${label} must total ` +
            `${total}, so ${name} is ${held} − ${total} = ${owed}.`;
      return {
        technique: `45-rule (${kind})`,
        level: 4,
        action: "place",
        cells: [cell],
        digits: [owed],
        units: [label],
        explanation: why,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Killer Sudoku: the 45-rule over several cells at once
// ---------------------------------------------------------------------------

// Beyond four the total says almost nothing: the reachable range is nearly the
// whole of 1-9 for every cell, so the bound never bites and the work is wasted.
//
// Counted over the leftover cells still *empty*, not the whole leftover. It is
// the unknowns that make the arithmetic go slack, and a five-cell leftover with
// three digits already written into it is a two-cell problem — a sharp one, and
// the shape this rule most often closes on late in a board. Gating on the whole
// group instead hid those completely: column 6 of the board that prompted this
// leaves five innies owing 25, three of which fill in early, and the two that
// remain owe 7 between them.
export const MAX_LEFTOVER = 4;

/**
 * Whether these cells are guaranteed to hold different digits.
 *
 * They are if they share a row, a column or a box. It matters because the bound
 * in `squeezedOut` sums *distinct* digits: allow repeats and the true minimum
 * drops to k copies of the smallest, and the elimination is unsound. Innies of a
 * single unit always qualify; innies of a wider span and outies often don't, and
 * those are simply left alone.
 */
export function allDistinct(cells: Coord[]): boolean {
  const size = (ns: number[]) => new Set(ns).size;
  return (
    size(cells.map(([r]) => r)) === 1 ||
    size(cells.map(([, c]) => c)) === 1 ||
    size(cells.map(([r, c]) => boxIndex(r, c))) === 1
  );
}

/** A 45-rule leftover worked up into what a technique needs: where it came from,
 * which of its cells are still empty, and what those owe between them. */
interface LeftoverGroup {
  label: string;
  kind: "innie" | "outie";
  /** `inside rows 1-2` / `spilling out of box 3` — the phrase explanations use. */
  where: string;
  total: number;
  group: Coord[];
  open: Coord[];
  filled: number[];
  owed: number;
  /** `owed` less the digits already written into the group. */
  remaining: number;
}

/** Every leftover group worth reasoning about, in span order.
 *
 * Walked more than once — the squeeze and the combination count are different
 * strengths of argument, and every group deserves the cheaper one before any
 * group gets the dearer one. Recomputing beats caching: the whole walk is a few
 * hundred set operations, and the candidate grid it reads is not stable across
 * calls anyway.
 */
function* leftoverGroups(board: Board, cg: CandGrid): Generator<LeftoverGroup> {
  for (const { label, cells: span, total } of spans(board)) {
    for (const { kind, cells, owed } of unaccounted(board, span, total)) {
      // Fewer than two leftovers is `fortyFiveRule`'s single, reported simpler.
      if (cells.size < 2) continue;
      const group = sortCoords([...cells].map(rc));
      const filled: number[] = [];
      for (const [r, c] of group) {
        const v = board.value(r, c);
        if (v !== null) filled.push(v);
      }
      const open = empties(group, cg);
      // A cell that is neither empty-with-candidates nor filled.
      if (open.length + filled.length !== cells.size) continue;
      if (open.length > MAX_LEFTOVER) continue;
      yield {
        label,
        kind,
        where: `${kind === "innie" ? "inside" : "spilling out of"} ${label}`,
        total,
        group,
        open,
        filled,
        owed,
        remaining: owed - filled.reduce((a, b) => a + b, 0),
      };
    }
  }
}

/**
 * Use the 45-rule when it leaves several cells over rather than one.
 *
 * The leftover cells still have a known total, which is worth three things: if
 * every one but a single cell has since been filled in, that cell is pinned
 * after all; while several are empty, what the others can reach bounds each one;
 * and where that bound is too blunt, enumerating the ways the group can make its
 * total rules out digits the bound leaves standing. The same three strengths of
 * argument `cageSum` applies within a cage, applied to a group the cages don't
 * draw.
 *
 * Last in the catalogue. It is the hardest of these to see by hand, and offering
 * it before a naked pair would be answering a question nobody asked.
 */
export function fortyFiveSets(board: Board, cg: CandGrid): Hint | null {
  if (board.cages.length === 0) return null;

  for (const { label, kind, where, total, group, open, filled, owed, remaining } of leftoverGroups(
    board,
    cg,
  )) {
    if (open.length === 1) {
      const cell = open[0];
      if (fortyFivePlacement(cg, cell, remaining)) {
        return {
          technique: `45-rule (${kind} set)`,
          level: 7,
          action: "place",
          cells: [cell],
          digits: [remaining],
          units: [label],
          explanation:
            `The ${group.length} cells ${where} must total ${owed}, ` +
            `and all but ${cellName(...cell)} are filled in — ` +
            `leaving ${remaining} for it.`,
        };
      }
      continue;
    }

    // Without distinctness the bound below would be unsound.
    if (!allDistinct(open)) continue;
    for (const cell of open) {
      const squeezed = squeezedOut(cell, open, cg, remaining);
      if (squeezed === null) continue;
      const [gone, why] = squeezed;
      return {
        technique: `45-rule (${kind} set)`,
        level: 7,
        action: "eliminate",
        cells: [cell],
        digits: gone,
        units: [label],
        explanation:
          `${label} must total ${total}, which leaves ` +
          `${names(group)} ${where} to make ${owed}` +
          (filled.length > 0 ? ` — ${remaining} once the filled ones are taken off` : "") +
          `. ${why} — ${gone.join(", ")} cannot go there.`,
      };
    }
  }

  // Second walk: what the bound could not reach. Enumerating a group's workable
  // sets catches digits that sit comfortably inside its min-max range and are
  // still impossible — the bound sums digits from anywhere in the group, so it
  // admits totals no real assignment reaches.
  for (const { label, kind, where, total, group, open, filled, owed, remaining } of leftoverGroups(
    board,
    cg,
  )) {
    // Distinctness for the same reason as above: the sets are of distinct digits.
    if (open.length < 2 || !allDistinct(open)) continue;
    // Only the empty cells are passed, so the group's own filled digits stay in
    // the pool. They are already gone from any candidate set that shares a unit
    // with them, and where they don't share one they may legitimately repeat.
    const options = groupOptions(board, cg, open, remaining);
    if (options === null) continue;
    for (const cell of open) {
      const mine = options.allowed.get(idx(cell[0], cell[1]))!;
      const gone = sortNums([...cand(cg, cell)].filter((d) => !mine.has(d)));
      if (gone.length === 0 || mine.size === 0) continue;
      return {
        technique: `45-rule (${kind} set)`,
        level: 7,
        action: "eliminate",
        cells: [cell],
        digits: gone,
        units: [label],
        explanation:
          `${label} must total ${total}, which leaves ` +
          `${names(group)} ${where} to make ${owed}` +
          (filled.length > 0 ? ` — ${remaining} once the filled ones are taken off` : "") +
          `. There are ${waysPhrase(options.combos.length)} to do that, and not one of them ` +
          `puts ${orList(gone)} in ${cellName(...cell)}.`,
      };
    }
  }
  return null;
}

export type Technique = (board: Board, cg: CandGrid) => Hint | null;

/**
 * Ordered simplest -> hardest. `findHint` walks this list and returns the first
 * hit, so this order *is* the behaviour: which technique fires on a given board
 * follows from it, and the tests pin it.
 *
 * Killer's `cageSum` sits between the singles and the subsets, `fortyFiveRule`
 * directly after it, and `fortyFiveSets` last of all.
 */
export const TECHNIQUES: Technique[] = [
  // First: the player's own notes must be right before anything derived from
  // them will make sense to them.
  impossiblePencilMark,
  nakedSingle,
  hiddenSingle,
  cageSum,
  fortyFiveRule,
  nakedPair,
  nakedTriple,
  hiddenPair,
  nakedQuad,
  hiddenTriple,
  pointing,
  claiming,
  xWing,
  // Last: the hardest of these to see by hand, and it only ever fires when
  // everything simpler has already been exhausted.
  fortyFiveSets,
];
