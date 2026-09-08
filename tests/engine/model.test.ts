// Port of the assertions in tests/test_model.py, classic and Killer alike.
//
// `idx`/`rc` stand in for Python's `(r, c)` tuples wherever the original
// asserts membership in a set of coordinates: see the note atop model.ts for
// why a JS Set can't dedupe tuples the way Python's can.

import { test } from "node:test";
import assert from "node:assert/strict";

// Node's ESM loader (unlike Vite's bundler resolution, which web/ is written
// for) requires the on-disk extension in an import specifier — hence ".ts"
// here but not in web/ source importing web/ source.
import { Board, Cage, boxIndex, cellName, idx, type Coord } from "../../web/sudoku/model.ts";

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

// ---------------------------------------------------------------------------
// Killer Sudoku: cages
// ---------------------------------------------------------------------------

const SOLUTION = [
  [5, 3, 4, 6, 7, 8, 9, 1, 2],
  [6, 7, 2, 1, 9, 5, 3, 4, 8],
  [1, 9, 8, 3, 4, 2, 5, 6, 7],
  [8, 5, 9, 7, 6, 1, 4, 2, 3],
  [4, 2, 6, 8, 5, 3, 7, 9, 1],
  [7, 1, 3, 9, 2, 4, 8, 5, 6],
  [9, 6, 1, 5, 3, 7, 2, 8, 4],
  [2, 8, 7, 4, 1, 9, 6, 3, 5],
  [3, 4, 5, 2, 8, 6, 1, 7, 9],
];

/**
 * Partition every row into contiguous runs of 2,2,2,3 cells.
 *
 * Same-row cells always hold distinct digits, so each cage is legal by
 * construction and consistent with `grid` as a solution.
 */
function killerCages(grid: number[][]): Cage[] {
  const spans: [number, number][] = [
    [0, 2],
    [2, 4],
    [4, 6],
    [6, 9],
  ];
  const out: Cage[] = [];
  for (let r = 0; r < 9; r++) {
    for (const [a, b] of spans) {
      const cells: Coord[] = [];
      let total = 0;
      for (let c = a; c < b; c++) {
        cells.push([r, c]);
        total += grid[r][c];
      }
      out.push(new Cage(cells, total));
    }
  }
  return out;
}

test("cage rejects a single cell", () => {
  assert.throws(() => new Cage([[0, 0]], 5), /at least 2 cells/);
});

test("cage rejects non-contiguous cells", () => {
  assert.throws(() => new Cage([[0, 0], [0, 2]], 10), /contiguous/);
});

test("cage rejects diagonal-only contact", () => {
  // touching at a corner is not orthogonal adjacency
  assert.throws(() => new Cage([[0, 0], [1, 1]], 10), /contiguous/);
});

test("cage rejects unreachable sums", () => {
  // two distinct digits total 3..17
  assert.throws(() => new Cage([[0, 0], [0, 1]], 2), /must total 3\.\.17/);
  assert.throws(() => new Cage([[0, 0], [0, 1]], 18), /must total 3\.\.17/);
});

test("cage rejects overlap", () => {
  const a = new Cage([[0, 0], [0, 1]], 8);
  const b = new Cage([[0, 1], [0, 2]], 8);
  assert.throws(() => new Board(undefined, [a, b]), /more than one cage/);
});

// An L-shaped cage whose ends share no row, column or box: (0,2) is in box 0,
// (1,3) in box 1, on different rows and columns. Two orthogonally-adjacent cells
// always share a row or column, so it takes 3 cells to get a cage-mate that
// isn't already a classic peer — which is what makes these tests discriminating.
const L_CAGE: Coord[] = [[0, 2], [1, 2], [1, 3]];

test("cage mates are peers", () => {
  const board = new Board(undefined, [new Cage(L_CAGE, 15)]);
  assert.ok(!new Board().peers(0, 2).has(idx(1, 3))); // not a peer without the cage
  assert.ok(board.peers(0, 2).has(idx(1, 3))); // the cage put it there
  assert.equal(board.peers(0, 2).size, 21); // classic 20 plus exactly that one
});

test("an uncaged board has exactly the classic peers", () => {
  assert.equal(new Board().peers(4, 4).size, 20);
});

test("candidates exclude cage-mate values", () => {
  const board = new Board(undefined, [new Cage(L_CAGE, 15)]);
  board.setValue(1, 3, 4);
  assert.ok(new Board().candidates(0, 2).has(4)); // legal without the cage
  assert.ok(!board.candidates(0, 2).has(4)); // the cage's no-repeat rules it out
});

test("cage validity flags a repeat and an overshoot", () => {
  const cage = new Cage([[0, 0], [1, 0]], 10); // vertical, crosses no box boundary
  const board = new Board(undefined, [cage]);
  board.setValue(0, 0, 4);
  assert.ok(board.isValid());
  board.setValue(1, 0, 9); // 4 + 9 = 13 > 10
  assert.ok(!board.isValid());
});

test("cage validity flags an unreachable remainder", () => {
  // three cells totalling 24 is only 7+8+9; if one is a 1 the rest can't reach 23
  const board = new Board(undefined, [new Cage([[0, 0], [0, 1], [0, 2]], 24)]);
  board.setValue(0, 0, 1);
  assert.ok(!board.isValid());
});

test("a full cage must hit its sum exactly", () => {
  const board = new Board(undefined, [new Cage([[0, 0], [0, 1]], 10)]);
  board.setValue(0, 0, 3);
  board.setValue(0, 1, 6); // 9, not 10
  assert.ok(!board.isValid());
  board.setValue(0, 1, 7); // 10
  assert.ok(board.isValid());
});

test("is fully caged", () => {
  assert.ok(!new Board().isFullyCaged());
  assert.ok(new Board(undefined, killerCages(SOLUTION)).isFullyCaged());
});

test("cage serialization round-trips", () => {
  const board = new Board(undefined, killerCages(SOLUTION));
  board.setValue(0, 0, 5);
  const again = Board.fromWire(board.toWire());
  assert.deepEqual(again.toWire(), board.toWire());
  assert.equal(again.cages.length, board.cages.length);
  assert.ok(again.cageAt(0, 0) !== null);
  assert.equal(again.cageAt(0, 0)!.sum, board.cageAt(0, 0)!.sum);
});

test("a cageless board omits cages from serialization", () => {
  assert.ok(!("cages" in new Board().toWire()));
});
