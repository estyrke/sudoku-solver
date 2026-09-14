// What the reader says when it is guessing.
//
// A misread the player is not warned about is worse than a misread they are:
// they trust it, hint from it, and the engine deduces from a board that isn't
// theirs. The synthetic fixture is clean by construction and so can never
// exercise this, which is exactly why it gets its own case — a cell holding
// something that is a glyph by size but no digit by shape.

import test from "node:test";
import assert from "node:assert/strict";

import { loadOpenCV } from "../../web/cv/runtime.ts";
import { parseCell } from "../../web/reader/cell-parse.ts";
import { loadGlyphSeeds } from "../../web/reader/seeds.ts";
import type { Pixels } from "../../web/reader/pixels.ts";

/** The warped board's cell size — see web/reader/grid-detect.ts. */
const CELL = 54;

/** A white cell, painted by `paint` in cell coordinates. */
function cell(paint: (ink: (x: number, y: number) => void) => void): Pixels {
  const data = new Uint8Array(CELL * CELL * 4).fill(255);
  paint((x, y) => {
    const at = (y * CELL + x) * 4;
    data[at] = data[at + 1] = data[at + 2] = 0;
  });
  return { width: CELL, height: CELL, data };
}

/** An empty square outline, 26px tall and 3px thick. Tall enough to be taken
 *  for the cell's value rather than a Pencil mark, and shaped like nothing in
 *  the digit set — the closest thing to it is a zero, which a Sudoku cell
 *  cannot hold and which the classic reader therefore never classifies to. */
const RING = cell((ink) => {
  for (let y = 14; y < 40; y++) {
    for (let x = 14; x < 40; x++) if (y < 17 || y >= 37 || x < 17 || x >= 37) ink(x, y);
  }
});

const BLANK = cell(() => {});

async function digitExemplars() {
  const seeds = await loadGlyphSeeds();
  return new Map([1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => [d, seeds.byDigit.get(d) ?? []]));
}

test("a shape that is a glyph by size but no digit by shape is flagged", async () => {
  const cv = await loadOpenCV();
  const read = parseCell(cv, RING, await digitExemplars());

  assert.notEqual(read.value, null, "it still commits to its best guess");
  assert.equal(read.lowConfidence, true, "and says the guess is a weak one");
  assert.equal(read.pencilMarks.size, 0, "a value is not also Pencil marks");
});

test("an empty cell is neither a value nor a doubt", async () => {
  const cv = await loadOpenCV();
  const read = parseCell(cv, BLANK, await digitExemplars());

  assert.equal(read.value, null);
  assert.equal(read.lowConfidence, false, "nothing there is not the same as a doubtful read");
  assert.equal(read.pencilMarks.size, 0);
});
