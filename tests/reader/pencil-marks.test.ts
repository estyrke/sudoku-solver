// Positional Pencil-mark detection, on ink drawn by hand.
//
// Ported from tests/test_reader.py, docstrings and all: each of these exists
// because a real screenshot broke in a specific way, and the explanation is the
// more useful half. Ink is drawn directly rather than rendered, so what is
// under test is the sub-grid mapping and the hairline filter alone — no
// threshold, no classifier, nothing that could make a failure ambiguous.

import test from "node:test";
import assert from "node:assert/strict";

import { loadOpenCV } from "../../web/cv/runtime.ts";
import { positionalMarks } from "../../web/reader/cell-parse.ts";
import type { Gray } from "../../web/reader/pixels.ts";

const SIDE = 60;

/** A blank ink mask, with a `fill` that paints the half-open box [y0, y1) x [x0, x1). */
function blankInk(): Gray & { fill: (y0: number, y1: number, x0: number, x1: number) => void } {
  const ink = {
    width: SIDE,
    height: SIDE,
    data: new Uint8Array(SIDE * SIDE),
    fill(y0: number, y1: number, x0: number, x1: number) {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink.data[y * SIDE + x] = 255;
    },
  };
  return ink;
}

const marks = (set: Set<number>) => [...set].sort((a, b) => a - b);

test("the whole cell is the default band", async () => {
  // The classic layout centres marks in the cell; that must not change.
  const cv = await loadOpenCV();
  const ink = blankInk();
  ink.fill(2, 18, 2, 18); // top-left sub-cell -> digit 1
  ink.fill(42, 58, 42, 58); // bottom-right    -> digit 9

  assert.deepEqual(marks(positionalMarks(cv, ink)), [1, 9]);
});

test("the sub-grid maps onto a shifted band", async () => {
  // With the grid pushed into the lower part of the cell, the same ink must
  // read as the same digits — under the old full-height thirds it would come
  // out a row too low.
  const cv = await loadOpenCV();
  const ink = blankInk();
  // Marks live in y 20..60 (band (1/3, 1)); this blob is the band's top-left.
  ink.fill(22, 32, 2, 18);

  assert.deepEqual(marks(positionalMarks(cv, ink, [1 / 3, 1])), [1]);
  assert.deepEqual(marks(positionalMarks(cv, ink)), [4]); // the bug the band parameter fixes
});

test("a hairline is not a Pencil mark", async () => {
  // The filter is on shape, not on a raised ink threshold: a line one pixel
  // thick is not a digit however much of the cell it crosses.
  const cv = await loadOpenCV();
  const ink = blankInk();
  ink.fill(59, 60, 0, 60); // the board's outer frame, clipped by the border crop

  assert.deepEqual(marks(positionalMarks(cv, ink)), []);

  ink.fill(42, 58, 42, 58); // a real mark alongside it still reads
  assert.deepEqual(marks(positionalMarks(cv, ink)), [9]);
});
