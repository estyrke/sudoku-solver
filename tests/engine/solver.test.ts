// Coverage for the backtracking solver ported into web/sudoku/solver.ts. The
// Python module has no dedicated solver test file of its own (solve() is only
// exercised indirectly through the /solve endpoint, which had no tests
// either), so this file is new rather than ported.

import { test } from "node:test";
// `assert(...)` (not `assert.ok`) is the one with a TS assertion signature,
// which is what lets the compiler narrow `solved` past `Board | null` below.
import assert from "node:assert/strict";

// Node's ESM loader (unlike Vite's bundler resolution, which web/ is written
// for) requires the on-disk extension in an import specifier — hence ".ts"
// here but not in web/ source importing web/ source.
import { Board } from "../../web/sudoku/model.ts";
import { solve } from "../../web/sudoku/solver.ts";

const PUZZLE = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION =
  "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

test("solves a puzzle with a unique solution", () => {
  const solved = solve(Board.fromString(PUZZLE));
  assert(solved);
  assert.ok(solved.isSolved());
  assert.equal(solved.toWire().cells.map((c) => c.value).join(""), SOLUTION);
});

test("reports no solution for an unsolvable board", () => {
  const board = Board.fromString(PUZZLE);
  // Force a dead end: fill r1c9 with a digit its row already holds.
  board.setValue(0, 8, 5);
  assert.equal(solve(board), null);
});

test("reports no solution for an already-invalid board", () => {
  const board = Board.fromString(".".repeat(81));
  board.setValue(0, 0, 5);
  board.setValue(0, 1, 5);
  assert.equal(solve(board), null);
});

test("preserves every digit already entered, given or not", () => {
  const board = Board.fromString(PUZZLE);
  // A player's own pen entry, not a given.
  board.setValue(1, 4, 9);
  const solved = solve(board);
  assert(solved);
  for (let i = 0; i < 81; i++) {
    const before = board.cells[i].value;
    if (before !== null) assert.equal(solved.cells[i].value, before);
  }
});

test("does not mutate the board passed in", () => {
  const board = Board.fromString(PUZZLE);
  const before = board.toWire();
  solve(board);
  assert.deepEqual(board.toWire(), before);
});
