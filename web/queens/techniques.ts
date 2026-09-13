// Human solving techniques, ordered by difficulty — the Queens analogue of
// web/sudoku/techniques.ts, sharing no code with it (ADR 0001).
//
// Each technique is a function `(board, cg) => Hint | null` where `cg` is the
// working Candidate grid. Unlike Sudoku — where a cell can hold any of several
// digits, so the Candidate grid tracks a *set of digits per cell* — a Queens
// cell is binary: given the current placements and marks, it either could still
// legally hold *a* queen or it could not. There is no second dimension to
// track, so `CandGrid` here is a flat set of still-viable cells rather than
// Sudoku's map of cell to digits.
//
// Reasoning about "the candidates for this unit are confined to these N cells"
// — what issues #7 (adjacency-shadow elimination) and #8 (region<->line
// confinement) build on — is just "the subset of `cg` that intersects this
// unit's cells", computed on demand rather than cached as a per-unit index. A
// board this size (roughly 6x6-11x11) makes that recomputation cheap, so the
// extra bookkeeping a per-unit index would need (keeping 3 overlapping views in
// sync as cells are eliminated) was not judged worth it. #7/#8's implementers:
// keep using `board.units()` plus a membership filter against this same flat
// `cg` rather than introducing a parallel structure.
//
// A technique inspects `cg` (and `board`, e.g. for already-placed queens or
// region layout) and returns the *first* deduction it finds, or `null`. They
// never mutate anything — a hint describes one step, the caller decides whether
// to apply it.

import { Board, QUEEN, cellName, type Coord } from "./model.ts";

/** Still-viable cells, as row-major indices (see `Board.idx`). */
export type CandGrid = Set<number>;

/**
 * One solving step.
 *
 * `action` is `"place"` (put a queen in `cells[0]`) or `"eliminate"` (rule out
 * every cell in `cells` as a candidate — used by #7/#8's elimination
 * techniques; not produced by any technique in this pass). Queens has no digit
 * to carry alongside a placement — a cell either gets a queen or it does not —
 * so unlike Sudoku's `Hint` there is no `digits` field. `level` ranks
 * difficulty so callers can show "simplest first".
 */
export interface Hint {
  technique: string;
  level: number;
  action: "place" | "eliminate";
  cells: Coord[];
  units: string[];
  explanation: string;
}

export type Technique = (board: Board, cg: CandGrid) => Hint | null;

// ---------------------------------------------------------------------------
// Forced placement
// ---------------------------------------------------------------------------

/**
 * A unit (row, column or region) reduced to exactly one live candidate forces
 * the queen there.
 *
 * The Queens analogue of Sudoku's hidden single (there is no naked-single
 * equivalent since a cell has no digit choices of its own to narrow down —
 * just yes/no). This is the smallest, simplest deduction in the search, so it
 * stays first in `TECHNIQUES`.
 *
 * Units that already hold a queen are skipped explicitly rather than relied
 * upon to fall out of `cg` on their own — a defensive guard against a caller
 * passing a `cg` that was not seeded via `workingCandidates` (e.g. a hand-built
 * one in a test), so this function is safe to call directly against any
 * `(board, cg)` pair.
 */
export function forcedPlacement(board: Board, cg: CandGrid): Hint | null {
  for (const { label, cells } of board.units()) {
    if (cells.some(([r, c]) => board.state(r, c) === QUEEN)) continue; // unit already satisfied
    const live = cells.filter(([r, c]) => cg.has(board.idx(r, c)));
    if (live.length === 1) {
      const [r, c] = live[0];
      return {
        technique: "Forced placement",
        level: 1,
        action: "place",
        cells: [[r, c]],
        units: [label],
        explanation:
          `In ${label}, ${cellName(r, c)} is the only cell left that ` +
          `can hold a queen, so the queen must go there.`,
      };
    }
  }
  return null;
}

// Ordered simplest -> hardest. findHint() walks this list and returns the first
// hit. Issues #7 (adjacency-shadow elimination) and #8 (region<->line
// confinement) each append one more function here, sized smallest-first — see
// web/queens/docs/adr/0001-general-primitives-not-named-patterns.md for why
// both of those families feed this same list rather than separate passes.
export const TECHNIQUES: Technique[] = [forcedPlacement];
