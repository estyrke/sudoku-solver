// The classic reader, end to end, against the board the Python reader produces.
//
// This is the parity gate. The fixture is committed pixels and the read beside
// it is committed JSON, written by tools/reader/render_classic_fixture.py from
// the Python reader — so this asserts the ported pipeline agrees with the one
// it was ported from, cell by cell, rather than merely agreeing with itself.
// tests/test_reader.py holds the Python half to the same two files.
//
// Everything here runs against the same committed OpenCV.js artifact the
// browser loads, and the fixture is decoded by the small PNG decoder next
// door, because the reader's own contract is that decoding is not its job.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import type { Board } from "../../web/sudoku/model.ts";
import { readClassicBoard } from "../../web/reader/read-board.ts";
import { decodePngFile } from "./png.ts";

const FIXTURE = new URL("../fixtures/synthetic_classic_board.png", import.meta.url);
const PINNED = new URL("../fixtures/classic_boards/synthetic_classic_board.json", import.meta.url);

const GIVENS: [number, number, number][] = [
  [0, 0, 1], [0, 4, 2], [1, 2, 3], [2, 7, 4], [3, 3, 5],
  [4, 1, 6], [5, 8, 7], [6, 5, 8], [7, 7, 2], [8, 0, 9],
];
const PENCIL_CELL: [number, number] = [4, 4];

/** The fixture, read once — three tests ask about the same board. */
let reading: Promise<Board> | null = null;

function readFixture(): Promise<Board> {
  if (reading === null) reading = readClassicBoard(decodePngFile(FIXTURE));
  return reading;
}

test("the synthetic board reads exactly as the Python reader reads it", async () => {
  const board = await readFixture();
  const pinned = JSON.parse(await readFile(PINNED, "utf8"));

  // Every value, every Given flag, every Pencil mark and every confidence
  // flag, in one comparison: a port that got 80 of 81 cells right is not a
  // port. Regenerate the pinned file only when the Python reader's own read
  // has changed and that change is the correct one.
  assert.deepEqual(board.toWire(), pinned);
});

test("it recovers the Givens", async () => {
  const board = await readFixture();

  for (const [r, c, digit] of GIVENS) {
    assert.equal(board.value(r, c), digit, `r${r + 1}c${c + 1}`);
    // Black glyphs, so the reader should call them Givens rather than entries.
    assert.equal(board.cell(r, c).isGiven, true, `r${r + 1}c${c + 1} should be a Given`);
  }
  // Cells with nothing in them stay empty.
  assert.equal(board.value(0, 1), null);
  // Nothing is flagged: this board is clean, and a flag here would mean the
  // classifier only just recognised a digit it should be sure of.
  assert.equal(board.cells.filter((cell) => cell.lowConfidence).length, 0);
});

test("it reads the Pencil marks, and does not read them as a value", async () => {
  const board = await readFixture();
  const [r, c] = PENCIL_CELL;

  assert.deepEqual([...board.cell(r, c).pencilMarks].sort((a, b) => a - b), [1, 5, 9]);
  assert.equal(board.value(r, c), null);
  // And nowhere else: small glyphs in one cell must not smear into its
  // neighbours through the grid lines.
  const withMarks = board.cells.filter((cell) => cell.pencilMarks.size > 0);
  assert.equal(withMarks.length, 1);
});
