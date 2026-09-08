// Solver: `solve` for one answer, `solutions` for up to `limit` of them.
//
// Technique propagation first, backtracking for whatever is left. The search
// carries candidates incrementally and undoes them on backtrack rather than
// rebuilding every empty cell's set from the board at each node, and it prunes
// each cage down to the digits that can still complete its total. Both matter:
// the straightforward version took 108 seconds on one of the reference Killer
// boards, which in the browser is a hung tab rather than a server timeout.

// The extension is required so Node's native ESM loader can run this module
// straight from source for tests/engine; Vite's bundler resolution accepts it
// equally well when this file is bundled into the shipped sudoku tab.
import { Board, N, canReach, digitMask, idx, rc } from "./model.ts";
import { derivedCandidates, solveWithTechniques } from "./hint.ts";

/** Candidates removed from one cell, so a backtrack can put them back. */
type Undo = [number, number[]];

/**
 * Up to `limit` distinct solved copies of `board`.
 *
 * A limit of 2 answers "is this puzzle still uniquely determined?" without
 * paying to enumerate a board that has thousands of answers — which is what a
 * misread cage sum tends to produce, and what makes it unsafe to tell a player
 * their pencil marks are missing something (see audit.ts).
 */
export function solutions(board: Board, limit = 2): Board[] {
  const work = Board.fromWire(board.toWire());
  if (!work.isValid()) return [];
  const found: Board[] = [];
  search(work, found, limit);
  return found;
}

/** Depth-first search with cage-sum propagation. */
function search(board: Board, found: Board[], limit: number): boolean {
  // Row-major insertion order, as Python's dict of COORDS has: it decides which
  // of several equally-constrained cells the search branches on first.
  const cands = new Map<number, Set<number>>();
  for (let i = 0; i < N * N; i++) {
    const [r, c] = rc(i);
    if (board.value(r, c) !== null) continue;
    const cs = board.candidates(r, c);
    if (cs.size === 0) return false;
    cands.set(i, cs);
  }
  const peersOf = new Map<number, number[]>();
  for (const i of cands.keys()) peersOf.set(i, [...board.peers(...rc(i))]);

  // Per-cage bookkeeping, kept in step with the board: what the cage still owes,
  // which of its cells are still empty, and which digits it has not used up.
  const cageOf = new Map<number, number>();
  const owed: number[] = [];
  const empty: Set<number>[] = [];
  const unused: number[] = []; // digit bitmasks, as canReach wants them
  const ALL = digitMask([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  board.cages.forEach((cage, i) => {
    const blank = new Set<number>();
    let used = 0;
    let mask = ALL;
    for (const cell of cage.indices) {
      cageOf.set(cell, i);
      const v = board.value(...rc(cell));
      if (v === null) blank.add(cell);
      else {
        used += v;
        mask &= ~(1 << v);
      }
    }
    owed.push(cage.sum - used);
    empty.push(blank);
    unused.push(mask);
  });

  /** Remove `gone` from `cell`'s candidates; false if nothing survives. */
  const strip = (cell: number, gone: number[], undo: Undo[]): boolean => {
    const cs = cands.get(cell)!;
    const hit = gone.filter((d) => cs.has(d));
    if (hit.length === 0) return true;
    for (const d of hit) cs.delete(d);
    undo.push([cell, hit]);
    return cs.size > 0;
  };

  /** Cut cage `i`'s empty cells to digits that can still complete its sum. */
  const prune = (i: number, undo: Undo[]): boolean => {
    const cells = empty[i];
    const rem = owed[i];
    const pool = unused[i];
    const k = cells.size;
    if (k === 0) return rem === 0;
    for (const cell of cells) {
      const gone: number[] = [];
      for (const d of cands.get(cell)!) {
        if (!(pool & (1 << d)) || !canReach(k - 1, rem - d, pool & ~(1 << d))) gone.push(d);
      }
      if (!strip(cell, gone, undo)) return false;
    }
    return true;
  };

  const opening: Undo[] = [];
  for (let i = 0; i < board.cages.length; i++) {
    if (!prune(i, opening)) return false;
  }

  /** True once `limit` solutions are in hand; keep searching until then. */
  const step = (): boolean => {
    if (cands.size === 0) {
      found.push(Board.fromWire(board.toWire()));
      return found.length >= limit;
    }
    let cell = -1;
    let fewest = Infinity;
    for (const [i, cs] of cands) {
      if (cs.size < fewest) {
        cell = i;
        fewest = cs.size;
      }
    }
    const i = cageOf.get(cell);
    const [r, c] = rc(cell);
    const saved = cands.get(cell)!;
    for (const d of [...saved].sort((a, b) => a - b)) {
      const undo: Undo[] = [];
      cands.delete(cell);
      let ok = true;
      for (const p of peersOf.get(cell)!) {
        if (!cands.has(p)) continue;
        if (!strip(p, [d], undo)) {
          ok = false;
          break;
        }
      }
      const touched = ok && i !== undefined;
      if (touched) {
        empty[i!].delete(cell);
        owed[i!] -= d;
        unused[i!] &= ~(1 << d);
        ok = prune(i!, undo);
      }
      if (ok) {
        board.setValue(r, c, d);
        if (step()) return true;
        board.setValue(r, c, null);
      }
      if (touched) {
        empty[i!].add(cell);
        owed[i!] += d;
        unused[i!] |= 1 << d;
      }
      for (const [other, hit] of undo) {
        const cs = cands.get(other)!;
        for (const digit of hit) cs.add(digit);
      }
      // Re-inserting moves the cell to the end of the map, exactly as Python's
      // `cands[cell] = saved` moves it to the end of the dict — which is what
      // breaks ties between equally-constrained cells further down the search.
      cands.set(cell, saved);
    }
    return false;
  };

  return step();
}

/**
 * Solver. Returns a solved copy, or `null` if unsolvable.
 *
 * Human techniques run first and the backtracker picks up whatever they leave —
 * on an easy board that is nothing at all, and the answer falls out of
 * propagation alone. Propagation only ever removes candidates that no solution
 * could have used, so the search that follows is the same search over a smaller
 * tree, not a different one.
 */
export function solve(board: Board): Board | null {
  let work = Board.fromWire(board.toWire());
  if (!work.isValid()) return null;

  const run = solveWithTechniques(work, derivedCandidates(work));
  // A board the techniques wreck (they cannot, given derived candidates, but a
  // future technique with a bug could) is not allowed to make a solvable board
  // look unsolvable: fall back to the untouched one.
  if (run.board.isValid()) work = run.board;
  if (work.isSolved()) return work;

  const found = solutions(work, 1);
  return found.length > 0 ? found[0] : null;
}
