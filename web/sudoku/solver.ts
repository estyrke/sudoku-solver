// Solver — the TypeScript port of `solve` in sudoku/solver/hint.py.
//
// Technique propagation first, backtracking for whatever is left. No cage-sum
// propagation: that pruning exists in Python because a Killer board's cages
// make the naive search too slow, and Killer's Cage hasn't been ported yet
// (issue #21).
//
// Candidates are carried incrementally and undone on backtrack, same as the
// Python version, rather than recomputed from the board at every node — it's
// not needed for speed on a classic board, but the Killer slice will need the
// same shape to bolt cage propagation onto, so it's built that way now.

// The extension is required so Node's native ESM loader can run this module
// straight from source for tests/engine; Vite's bundler resolution accepts it
// equally well when this file is bundled into the shipped sudoku tab.
import { Board, N, rc } from "./model.ts";
import { derivedCandidates, solveWithTechniques } from "./hint.ts";

/** Depth-first search, choosing the cell with fewest candidates first (as Python's `min` does). */
function backtrack(board: Board, cands: Map<number, Set<number>>, peersOf: Map<number, number[]>): boolean {
  if (cands.size === 0) return true;

  let best = -1;
  let bestSize = Infinity;
  for (const [i, s] of cands) {
    if (s.size < bestSize) {
      best = i;
      bestSize = s.size;
    }
  }

  const [r, c] = rc(best);
  const digits = [...cands.get(best)!].sort((a, b) => a - b);
  const saved = cands.get(best)!;
  cands.delete(best);

  for (const d of digits) {
    const undo: [number, number][] = []; // [peer index, digit put back]
    let ok = true;
    for (const p of peersOf.get(best)!) {
      const s = cands.get(p);
      if (s && s.has(d)) {
        s.delete(d);
        undo.push([p, d]);
        if (s.size === 0) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      board.setValue(r, c, d);
      if (backtrack(board, cands, peersOf)) return true;
      board.setValue(r, c, null);
    }
    for (const [p, dig] of undo) cands.get(p)!.add(dig);
  }

  cands.set(best, saved);
  return false;
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

  const cands = new Map<number, Set<number>>();
  for (let i = 0; i < N * N; i++) {
    const [r, c] = rc(i);
    if (work.value(r, c) === null) {
      const cs = work.candidates(r, c);
      if (cs.size === 0) return null;
      cands.set(i, cs);
    }
  }

  const peersOf = new Map<number, number[]>();
  for (const i of cands.keys()) {
    const [r, c] = rc(i);
    peersOf.set(i, [...work.peers(r, c)]);
  }

  return backtrack(work, cands, peersOf) ? work : null;
}
