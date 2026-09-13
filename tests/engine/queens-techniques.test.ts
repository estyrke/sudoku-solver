// Ported assertion-for-assertion from tests/test_queens_techniques.py, which
// this replaces along with the Python Queens package.

import { test } from "node:test";
import assert from "node:assert/strict";

import { Board, EMPTY, MARKED, QUEEN, type Coord } from "../../web/queens/model.ts";
import { forcedPlacement } from "../../web/queens/techniques.ts";
import {
  applyHint,
  applyToCandidates,
  findHint,
  solveWithTechniques,
  workingCandidates,
} from "../../web/queens/hint.ts";
import { solve } from "../../web/queens/solver.ts";

// A 4x4 board split into four 2x2 quadrant regions; see queens-model.test.ts
// for the same layout and its one non-attacking placement (SOLUTION).
const QUADRANTS = [
  [0, 0, 1, 1],
  [0, 0, 1, 1],
  [2, 2, 3, 3],
  [2, 2, 3, 3],
];
const SOLUTION: Coord[] = [
  [0, 1],
  [1, 3],
  [2, 0],
  [3, 2],
];

const quadrantBoard = (): Board => Board.fromGrid(QUADRANTS);

const indices = (board: Board, cells: Iterable<Coord>): Set<number> =>
  new Set([...cells].map(([r, c]) => board.idx(r, c)));

/** Queen cells as sorted "r,c" strings, so two placements compare by value. */
const placement = (board: Board): string[] =>
  board.queenCells().map(([r, c]) => `${r},${c}`).sort();

const SOLUTION_KEYS = SOLUTION.map(([r, c]) => `${r},${c}`).sort();

test("the backtracking solver solves a board", () => {
  const solved = solve(quadrantBoard());
  assert(solved);
  assert.ok(solved.isSolved());
  assert.deepEqual(placement(solved), SOLUTION_KEYS);
});

test("the backtracking solver respects existing queens and marks", () => {
  const board = quadrantBoard();
  // Pin the known solution's row-2 queen up front...
  board.setState(2, 0, QUEEN);
  // ...and mark out a cell that isn't part of any completion, to confirm marked
  // cells are honored as never-a-queen rather than just skipped by luck.
  board.setState(0, 0, MARKED);
  const solved = solve(board);
  assert(solved);
  assert.equal(solved.state(2, 0), QUEEN);
  assert.equal(solved.state(0, 0), MARKED);
  assert.ok(solved.isSolved());
  assert.deepEqual(placement(solved), SOLUTION_KEYS);
});

test("the backtracking solver reports no solution", () => {
  const board = quadrantBoard();
  // Two queens sharing a region up front makes the board unsolvable.
  board.setState(0, 0, QUEEN);
  board.setState(1, 1, QUEEN);
  assert.equal(solve(board), null);
});

test("the backtracking solver leaves the original board untouched", () => {
  const board = quadrantBoard();
  solve(board);
  assert.ok(board.coords().every(([r, c]) => board.state(r, c) === EMPTY));
});

// ---------------------------------------------------------------------------
// workingCandidates (elimination-propagation bookkeeping)
// ---------------------------------------------------------------------------

test("a wide-open board's candidates are every empty cell", () => {
  const board = quadrantBoard();
  assert.deepEqual(workingCandidates(board), indices(board, board.coords()));
});

test("candidates exclude marks and a queen's peers and neighbors", () => {
  const board = quadrantBoard();
  board.setState(0, 0, QUEEN);
  board.setState(3, 3, MARKED);
  const cg = workingCandidates(board);
  // The queen's own cell, its row/column/region peers, and its 8-neighbors are
  // all gone...
  assert.ok(!cg.has(board.idx(0, 0)));
  assert.ok(!cg.has(board.idx(0, 1))); // row peer
  assert.ok(!cg.has(board.idx(1, 0))); // column peer
  assert.ok(!cg.has(board.idx(1, 1))); // region peer + neighbor
  // ...as is the independently-marked cell...
  assert.ok(!cg.has(board.idx(3, 3)));
  // ...while an untouched cell out of the queen's reach survives.
  assert.ok(cg.has(board.idx(2, 3)));
});

test("applying a placement to the candidate grid propagates elimination", () => {
  const board = quadrantBoard();
  const cg = workingCandidates(board);
  const hint = findHint(board, indices(board, [[0, 0]]));
  assert(hint);
  applyToCandidates(board, cg, hint);
  assert.deepEqual(cg, workingCandidates(applyHint(board, hint)));
});

// ---------------------------------------------------------------------------
// forcedPlacement (individual technique tests, synthetic board + cg)
// ---------------------------------------------------------------------------

test("forced placement fires on a unit with a single candidate", () => {
  const board = quadrantBoard();
  // Hand-built cg, not derived from board state: row 1 is down to its one
  // remaining live cell; nothing else in cg matters for this check.
  const hint = forcedPlacement(board, indices(board, [[0, 0]]));
  assert(hint);
  assert.equal(hint.action, "place");
  assert.deepEqual(hint.cells, [[0, 0]]);
  assert.deepEqual(hint.units, ["row 1"]);
  assert.equal(hint.technique, "Forced placement");
});

test("forced placement is silent when every unit has multiple candidates", () => {
  const board = quadrantBoard();
  const cg = workingCandidates(board); // wide open: every unit has 4 live cells
  assert.equal(forcedPlacement(board, cg), null);
});

test("forced placement skips a unit that already has a queen", () => {
  // A bare, unpainted board (no regions) isolates the guard to row/column
  // units, so a stray column-of-1 elsewhere can't coincidentally fire too.
  const board = new Board(4);
  board.setState(0, 1, QUEEN);
  // A stale cg that (incorrectly) still lists row 1 as down to one live cell —
  // every other row/column stays fully open, so the guard against a unit that's
  // already satisfied is the only thing that can suppress a hit.
  const cg = indices(board, board.coords());
  for (const cell of [[0, 0], [0, 1], [0, 3]] as Coord[]) cg.delete(board.idx(...cell));
  assert.equal(forcedPlacement(board, cg), null);
});

// ---------------------------------------------------------------------------
// End-to-end hint pipeline
// ---------------------------------------------------------------------------

/** The quadrant board with every non-SOLUTION cell marked, so each row, column
 * and region is down to exactly one live cell from the start. */
function boardReducedToForcedSingles(): Board {
  const board = quadrantBoard();
  const solution = new Set(SOLUTION_KEYS);
  for (const [r, c] of board.coords()) {
    if (!solution.has(`${r},${c}`)) board.setState(r, c, MARKED);
  }
  return board;
}

test("the hint pipeline solves a board reduced to forced singles", () => {
  const { board: final, steps, solved } = solveWithTechniques(boardReducedToForcedSingles());

  assert.ok(solved);
  assert.ok(steps.length > 0, "expected at least one hint");
  assert.ok(steps.every((step) => step.technique === "Forced placement"));
  assert.ok(steps.every((step) => step.action === "place"));
  assert.deepEqual(placement(final), SOLUTION_KEYS);
});

test("findHint returns the correct placement step by step", () => {
  let board = boardReducedToForcedSingles();
  const solution = new Set(SOLUTION_KEYS);

  for (let i = 0; i < SOLUTION.length; i++) {
    const hint = findHint(board);
    assert(hint);
    assert.equal(hint.action, "place");
    const [r, c] = hint.cells[0];
    assert.ok(solution.has(`${r},${c}`)); // every step matches the known solution
    board = applyHint(board, hint);
  }

  assert.ok(board.isSolved());
  assert.deepEqual(placement(board), SOLUTION_KEYS);
  assert.equal(findHint(board), null);
});

// ---------------------------------------------------------------------------
// No hint on solved / invalid boards
// ---------------------------------------------------------------------------

test("no hint on an already-solved board", () => {
  const board = quadrantBoard();
  for (const [r, c] of SOLUTION) board.setState(r, c, QUEEN);
  assert.ok(board.isSolved());
  assert.equal(findHint(board), null);
});

test("no hint on an invalid board", () => {
  const board = quadrantBoard();
  board.setState(0, 0, QUEEN);
  board.setState(0, 2, QUEEN); // two queens in row 1 — invalid
  assert.ok(!board.isValid());
  assert.equal(findHint(board), null);
});
