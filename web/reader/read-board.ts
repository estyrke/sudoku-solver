// Reading a classic Sudoku screenshot, in the browser.
//
// A port of sudoku/reader/read_board.py: grid detection, per-cell parsing and
// template classification, tied together. This is the whole classic reader's
// way in.
//
// It takes *decoded pixels*, not an encoded file. Decoding is the caller's
// problem on purpose: in the browser the page decodes through the platform's
// image-bitmap and canvas APIs (web/reader/decode.ts), so the browser's own
// codec support is what decides which screenshots can be read — including
// formats OpenCV itself would not decode. In tests, fixtures are decoded by a
// small PNG decoder.
//
// The Killer reader is a sibling port, web/reader/killer-board.ts. The share
// dispatcher is still server-side.

import { loadOpenCV } from "../cv/runtime.ts";
import { Board, type Cell } from "../sudoku/model.ts";
import { parseCell } from "./cell-parse.ts";
import { detectAndSplit } from "./grid-detect.ts";
import { loadGlyphSeeds } from "./seeds.ts";
import type { Pixels } from "./pixels.ts";

/** The digits a Sudoku cell can hold. A cage sum's zero is not one of them,
 *  and leaving it out of the classifier is what keeps a 0 exemplar from
 *  winning a cell. */
const CELL_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Read a classic board from decoded pixels.
 *
 * The first call pays for the reader's assets — the OpenCV runtime and the
 * digit exemplars — and later calls do not.
 */
export async function readClassicBoard(image: Pixels): Promise<Board> {
  const [cv, seeds] = await Promise.all([loadOpenCV(), loadGlyphSeeds()]);
  const exemplars = new Map(CELL_DIGITS.map((digit) => [digit, seeds.byDigit.get(digit) ?? []]));

  const cells: Cell[] = detectAndSplit(cv, image).map((cell) => {
    const read = parseCell(cv, cell, exemplars);
    return {
      value: read.value,
      isGiven: read.isGiven,
      pencilMarks: read.pencilMarks,
      lowConfidence: read.lowConfidence,
    };
  });
  return new Board(cells);
}
