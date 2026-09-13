// Ported assertion-for-assertion from tests/test_queens_model.py, which this
// replaces along with the Python Queens package.

import { test } from "node:test";
import assert from "node:assert/strict";

import { Board, EMPTY, MARKED, QUEEN, cellName, type Coord } from "../../web/queens/model.ts";

// A 4x4 board split into four 2x2 quadrant regions (0=top-left, 1=top-right,
// 2=bottom-left, 3=bottom-right), used across several tests below.
const QUADRANTS = [
  [0, 0, 1, 1],
  [0, 0, 1, 1],
  [2, 2, 3, 3],
  [2, 2, 3, 3],
];

// One valid non-attacking placement on QUADRANTS: one queen per row, column and
// region, no two adjacent (incl. diagonally).
const SOLUTION: Coord[] = [
  [0, 1],
  [1, 3],
  [2, 0],
  [3, 2],
];

const quadrantBoard = (): Board => Board.fromGrid(QUADRANTS);

/** A set of coordinates as row-major indices, so it compares by value. */
const indices = (board: Board, cells: Iterable<Coord>): Set<number> =>
  new Set([...cells].map(([r, c]) => board.idx(r, c)));

test("cell name", () => {
  assert.equal(cellName(0, 0), "r1c1");
  assert.equal(cellName(3, 2), "r4c3");
});

test("neighbors of a corner and of a middle cell", () => {
  const board = quadrantBoard();
  assert.deepEqual(board.neighbors(0, 0), indices(board, [[0, 1], [1, 0], [1, 1]]));
  assert.deepEqual(
    board.neighbors(1, 1),
    indices(board, [
      [0, 0], [0, 1], [0, 2],
      [1, 0], [1, 2],
      [2, 0], [2, 1], [2, 2],
    ]),
  );
});

test("peers cover row, column and region", () => {
  const board = quadrantBoard();
  const peers = board.peers(0, 0);
  assert.deepEqual(
    peers,
    indices(board, [
      [0, 1], [0, 2], [0, 3], // row
      [1, 0], [2, 0], [3, 0], // column
      [1, 1], // region-mate, not otherwise counted
    ]),
  );
  assert.ok(!peers.has(board.idx(0, 0)));
});

test("units cover rows, columns and regions", () => {
  const units = quadrantBoard().units();
  assert.equal(units.length, 4 + 4 + 4);
  assert.ok(units.every(({ cells }) => cells.length === 4));
});

test("region cells and region ids", () => {
  const board = quadrantBoard();
  assert.deepEqual(board.regionIds(), new Set([0, 1, 2, 3]));
  assert.deepEqual(
    indices(board, board.regionCells(0)),
    indices(board, [[0, 0], [0, 1], [1, 0], [1, 1]]),
  );
});

test("an unpainted region defaults to null", () => {
  const board = new Board(3);
  assert.ok(board.coords().every(([r, c]) => board.region(r, c) === null));
  assert.deepEqual(board.regionIds(), new Set());
});

test("a row conflict is invalid", () => {
  const board = quadrantBoard();
  board.setState(0, 0, QUEEN);
  board.setState(0, 2, QUEEN);
  assert.ok(!board.isValid());
});

test("a column conflict is invalid", () => {
  const board = quadrantBoard();
  board.setState(0, 0, QUEEN);
  board.setState(2, 0, QUEEN);
  assert.ok(!board.isValid());
});

test("a region conflict is invalid", () => {
  const board = quadrantBoard();
  board.setState(0, 0, QUEEN);
  board.setState(1, 1, QUEEN); // both region 0, not adjacent-relevant here
  assert.ok(!board.isValid());
});

test("an adjacency conflict is invalid, including diagonally", () => {
  const board = quadrantBoard();
  board.setState(0, 1, QUEEN);
  board.setState(1, 2, QUEEN); // diagonal neighbor, different row/col/region
  assert.ok(!board.isValid());
});

test("non-adjacent queens in distinct units are valid", () => {
  const board = quadrantBoard();
  for (const [r, c] of SOLUTION) board.setState(r, c, QUEEN);
  assert.ok(board.isValid());
});

test("a complete placement is solved", () => {
  const board = quadrantBoard();
  for (const [r, c] of SOLUTION) board.setState(r, c, QUEEN);
  assert.ok(board.isSolved());
});

test("an incomplete placement is not solved", () => {
  const board = quadrantBoard();
  board.setState(0, 1, QUEEN);
  assert.ok(!board.isSolved());
});

test("marks affect neither validity nor solvedness", () => {
  const board = quadrantBoard();
  for (const [r, c] of SOLUTION) board.setState(r, c, QUEEN);
  board.setState(3, 3, MARKED);
  assert.ok(board.isValid());
  assert.ok(board.isSolved());
});

test("serialization round-trips", () => {
  const board = quadrantBoard();
  board.setState(0, 1, QUEEN);
  board.setState(2, 2, MARKED);
  const again = Board.fromWire(board.toWire());
  assert.deepEqual(again.toWire(), board.toWire());
  assert.equal(again.n, board.n);
  assert.equal(again.state(0, 1), QUEEN);
  assert.equal(again.state(2, 2), MARKED);
  assert.equal(again.region(0, 1), board.region(0, 1));
});

test("fromGrid builds an empty board with regions", () => {
  const board = quadrantBoard();
  assert.equal(board.n, 4);
  assert.ok(board.coords().every(([r, c]) => board.state(r, c) === EMPTY));
  assert.equal(board.region(3, 3), 3);
});
