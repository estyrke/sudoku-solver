// Backtracking solver — the TypeScript port of `solve` in sudoku/solver/hint.py.
//
// This slice ports the backtracker alone, with no cage-sum propagation: that
// optimization exists in Python because a Killer board's cages make the naive
// search too slow, and Killer's Cage hasn't been ported yet (issue #21). A
// classic board is small enough for plain backtracking to be instant, which
// is exactly what the Python module's own docstring says about it.
//
// Candidates are carried incrementally and undone on backtrack, same as the
// Python version, rather than recomputed from the board at every node — it's
// not needed for speed on a classic board, but the Killer slice will need the
// same shape to bolt cage propagation onto, so it's built that way now.

// The extension is required so Node's native ESM loader can run this module
// straight from source for tests/engine; Vite's bundler resolution accepts it
// equally well when this file is bundled into the shipped sudoku tab.
import { Board, N, rc } from "./model.ts";

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

/** Backtracking solver. Returns a solved copy, or `null` if unsolvable. */
export function solve(board: Board): Board | null {
  const work = Board.fromWire(board.toWire());
  if (!work.isValid()) return null;

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
