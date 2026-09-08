// Port of the classic (cage-free) assertions in tests/test_model.py.
//
// Cage-related tests stay in the Python file until the Killer slice (issue
// #21) ports Cage into web/sudoku/model.ts — porting them now would test a
// concept this module doesn't have yet.
//
// `idx`/`rc` stand in for Python's `(r, c)` tuples wherever the original
// asserts membership in a set of coordinates: see the note atop model.ts for
// why a JS Set can't dedupe tuples the way Python's can.

import { test } from "node:test";
import assert from "node:assert/strict";

// Node's ESM loader (unlike Vite's bundler resolution, which web/ is written
// for) requires the on-disk extension in an import specifier — hence ".ts"
// here but not in web/ source importing web/ source.
import { Board, boxIndex, cellName, idx } from "../../web/sudoku/model.ts";

test("box index and name", () => {
  assert.equal(boxIndex(0, 0), 0);
  assert.equal(boxIndex(4, 4), 4);
  assert.equal(boxIndex(8, 8), 8);
  assert.equal(cellName(0, 0), "r1c1");
  assert.equal(cellName(3, 6), "r4c7");
});

test("peers count", () => {
  const peers = new Board().peers(4, 4);
  assert.equal(peers.size, 20);
  assert.ok(!peers.has(idx(4, 4)));
  assert.ok(peers.has(idx(4, 0)) && peers.has(idx(0, 4)) && peers.has(idx(3, 3)));
});

test("units cover all", () => {
  const board = new Board();
  const units = [...board.units()];
  assert.equal(units.length, 27);
  assert.ok(units.every(([, cells]) => cells.length === 9));
});

test("candidates from values", () => {
  const board = Board.fromString(".".repeat(81));
  // fill a full row except one cell -> that cell's row constraint is tight
  for (let c = 0; c < 8; c++) board.setValue(0, c, c + 1); // 1..8 in r1c1..r1c8
  // r1c9 cannot be 1..8; box/col also constrain but at least 9 is allowed
  assert.deepEqual([...board.candidates(0, 8)].sort(), [9]);
});

test("string roundtrip and validity", () => {
  const s = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
  const board = Board.fromString(s);
  assert.ok(board.isValid());
  assert.ok(!board.isSolved());
  // serialization round-trips
  const again = Board.fromWire(board.toWire());
  assert.deepEqual(again.toWire(), board.toWire());
});

test("invalid detected", () => {
  const board = Board.fromString(".".repeat(81));
  board.setValue(0, 0, 5);
  board.setValue(0, 1, 5);
  assert.ok(!board.isValid());
});
