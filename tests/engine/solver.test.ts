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
import { readFileSync } from "node:fs";
import path from "node:path";

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

// ---------------------------------------------------------------------------
// Killer Sudoku: the reference boards
// ---------------------------------------------------------------------------

// The four screenshots tests/test_reader.py reads, as the reader read them
// (tests/fixtures/killer_boards/*.json). The Python half of this test used to
// read and solve in one go; the reader stays server-side, so the read is pinned
// there and the solve is pinned here, against the same boards.
const REFERENCE = [
  "puzzle_page_killer_sample_board",
  "puzzle_page_killer_board2",
  "puzzle_page_killer_board3",
  "puzzle_page_killer_board4",
];

const fixture = (name: string): Board =>
  Board.fromWire(
    JSON.parse(
      readFileSync(
        path.join(import.meta.dirname, "..", "fixtures", "killer_boards", `${name}.json`),
        "utf8",
      ),
    ),
  );

test("every reference Killer board solves, quickly", () => {
  // The budget is the point. Without cage-sum propagation the search took 108
  // seconds on one of these, which in the browser is not slowness but a tab
  // that has stopped responding. These finish in milliseconds; one second is
  // loose enough for a slow CI box and still two orders of magnitude short of
  // the behaviour it guards against.
  for (const name of REFERENCE) {
    const board = fixture(name);
    const started = performance.now();
    const solved = solve(board);
    const elapsed = performance.now() - started;

    assert(solved, `${name} came out unsolvable`);
    assert.ok(solved.isSolved(), name);
    for (const cage of solved.cages) {
      const total: number = cage.cells.reduce((n, [r, c]) => n + solved.value(r, c)!, 0);
      assert.equal(total, cage.sum, `${name}: ${cage.sum}-cage totals ${total}`);
    }
    // the digits the player had already entered must survive the solve
    for (let i = 0; i < 81; i++) {
      const before = board.cells[i].value;
      if (before !== null) assert.equal(solved.cells[i].value, before, `${name} at ${i}`);
    }
    assert.ok(elapsed < 1000, `${name} took ${(elapsed / 1000).toFixed(1)}s`);
  }
});
