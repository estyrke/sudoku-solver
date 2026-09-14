// Reading a Puzzle Page Killer Sudoku screenshot into a Board with cages, in
// the browser.
//
// A port of sudoku/reader/killer.py. Scoped to that one app's layout, the way
// the Queens reader is scoped to Meowdoku. Three things differ from the
// classic reader (web/reader/read-board.ts):
//
// *Cages come from coloured borders, not shading.* Puzzle Page tints alternate
// 3x3 boxes light blue — a checkerboard that has nothing to do with cages — so
// fill colour says nothing about cage membership. Each cage is instead
// outlined with a saturated blue (or green) line drawn a little way inside its
// perimeter. Two neighbouring cells belong to the same cage exactly when
// neither shows that line on the side they share.
//
// *Border colour is state, not structure.* A cage whose digits are complete
// and correct is drawn green instead of blue. Both are treated identically
// here.
//
// *The mark grid is pushed down.* Every cell reserves a strip at the top for a
// cage sum, so pencil marks occupy roughly the lower two-thirds — see
// MARK_BAND.
//
// Like the classic reader, this takes decoded pixels and nothing else; the
// page decodes through the platform's image-bitmap and canvas APIs
// (web/reader/decode.ts), and in tests a fixture is decoded by the small PNG
// decoder next door.

import { loadOpenCV, type OpenCVRuntime } from "../cv/runtime.ts";
import { Board, Cage, DIGITS, N, sumBounds, type Cell, type Coord, type WireBoard } from "../sudoku/model.ts";
import { parseCell, withLabels, type MarkBand } from "./cell-parse.ts";
import { classifyGlyph } from "./classify.ts";
import { findGridQuad } from "./grid-detect.ts";
import {
  MatScope,
  cropGray,
  cropPixels,
  matOfPixels,
  pixelsOfMat,
  type Gray,
  type Pixels,
} from "./pixels.ts";
import { loadGlyphSeeds } from "./seeds.ts";

// Cage sums render only ~16px tall in a typical screenshot, so the board is
// warped larger than the classic reader's 486 to keep them legible.
export const WARP = 972;
export const CELL = WARP / 9;

// Where the pencil-mark 3x3 grid sits, as a fraction of the *ink* crop
// `cellInk` (cell-parse.ts) returns (it has already trimmed a 12% border).
// Measured from the reference screenshot: the marks occupy ~0.31..0.95 of the
// full cell height.
const MARK_BAND: MarkBand = [0.25, 1.0];

// The cage sum's box within a cell, as fractions of cell size. The left edge
// used to sit at 0.12 to dodge the cage outline, but that clipped the leading
// digit of some sums; the outline is now excluded by shape instead (see
// SUM_MIN_WIDTH), so the crop can start wider and catch the whole number.
const SUM_TOP = 0.1;
const SUM_BOTTOM = 0.34;
const SUM_LEFT = 0.1;
const SUM_RIGHT = 0.44;

// A cage outline sits a few percent inside the cell edge rather than on the
// grid line, so its presence is probed across a range of insets.
const BORDER_INSET: readonly [number, number] = [0.035, 0.1];
const BORDER_SPAN: readonly [number, number] = [0.22, 0.78]; // the middle of a side, clear of the corners
const BORDER_COVERAGE = 0.5; // fraction of the side that must be coloured

// A cage outline clipping into the sum crop leaves a hairline vertical
// sliver, which is tall enough and narrow enough to pass for a digit — and a
// tall thin stroke classifies as a 1, turning a 9 into a 19. Real digits are
// far chunkier: the narrowest is 1 itself at ~6px wide and aspect ~0.35,
// against a sliver's 1px and 0.04.
const SUM_MIN_WIDTH = 0.03; // fraction of cell width
const SUM_MIN_ASPECT = 0.15; // width / height

const SUM_CONF = 0.45; // NCC below this marks the sum as needing a look

const UNIT_TOTAL = DIGITS.reduce((a, b) => a + b, 0); // 45; a full partition's cage sums total 9 x 45

/** The digits a cage sum can start or contain a zero in; unlike a cell's
 *  value, a cage sum of 10, 20, 30 or 40 certainly holds one. */
const SUM_DIGITS = [0, ...DIGITS];

/**
 * What a screenshot yielded, plus what to be suspicious of.
 *
 * Cage *structure* comes from the outlines and is reliable; the *sums* are
 * OCR from ~16px glyphs and are not. So the read reports where to look rather
 * than pretending to certainty.
 */
export class KillerRead {
  readonly board: Board;
  /** Cage anchors whose sum needs a human glance. */
  readonly unsure: Coord[];
  readonly sumTotal: number;

  constructor(board: Board, unsure: Coord[], sumTotal: number) {
    this.board = board;
    this.unsure = unsure;
    this.sumTotal = sumTotal;
  }

  /**
   * Whether the cage sums total 45 per unit, as a full partition must.
   *
   * Only meaningful on a fully-caged board. This detects a misread; it
   * deliberately doesn't try to *fix* one — many combinations reach 405, and
   * picking the cheapest rewrites sums that were already right.
   */
  get checksumOk(): boolean {
    return this.sumTotal === UNIT_TOTAL * N;
  }

  get needsReview(): boolean {
    return this.unsure.length > 0 || (this.board.isFullyCaged() && !this.checksumOk);
  }
}

/**
 * Read a Killer board from decoded pixels.
 *
 * The first call pays for the reader's assets — the OpenCV runtime and the
 * digit exemplars — and later calls do not.
 */
export async function readKillerBoard(image: Pixels): Promise<KillerRead> {
  const [cv, seeds] = await Promise.all([loadOpenCV(), loadGlyphSeeds()]);
  const cellExemplars = new Map(DIGITS.map((digit) => [digit, seeds.byDigit.get(digit) ?? []]));
  const sumExemplars = new Map(SUM_DIGITS.map((digit) => [digit, seeds.byDigit.get(digit) ?? []]));

  const boardImg = warpBoard(cv, image);
  const coloured = inkColourMask(cv, boardImg);
  const labels = labelCages(coloured);

  const cells: Cell[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const crop = cropPixels(boardImg, c * CELL, r * CELL, CELL, CELL);
      const read = parseCell(cv, crop, cellExemplars, MARK_BAND);
      cells.push({
        value: read.value,
        isGiven: false, // Killer boards start empty; every digit is the player's
        pencilMarks: read.pencilMarks,
        lowConfidence: read.lowConfidence,
      });
    }
  }

  let maxLabel = -1;
  for (const row of labels) for (const label of row) if (label > maxLabel) maxLabel = label;

  const cages: Cage[] = [];
  const unsure: Coord[] = [];
  for (let cageId = 0; cageId <= maxLabel; cageId++) {
    const coords: Coord[] = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (labels[r][c] === cageId) coords.push([r, c]);
    if (coords.length < 2) continue; // a lone cell means the outline was misread; drop it rather than guess

    // `coords` was built by a row-major scan, so its first entry is already
    // the topmost-then-leftmost cell — Python's `min(coords)`.
    const [ar, ac] = coords[0];
    const { total: read, worst: score } = readSum(cv, coloured, ar, ac, sumExemplars);
    const [low, high] = sumBounds(coords.length);
    let total = read;
    if (total === null || !(low <= total && total <= high)) {
      // The outline is trustworthy even when the sum isn't, so keep the cage
      // and clamp to something legal rather than discarding real structure.
      // It's flagged either way, and the user retypes the number.
      total = Math.min(high, Math.max(low, total || low));
      unsure.push([ar, ac]);
    } else if (score < SUM_CONF) {
      unsure.push([ar, ac]);
    }
    cages.push(new Cage(coords, total));
  }

  const sumTotal = cages.reduce((n, cage) => n + cage.sum, 0);
  return new KillerRead(new Board(cells, cages), unsure, sumTotal);
}

/** A Killer reading in the shape the Killer tab takes, however it arrived.
 *
 * The tab renders a dropped screenshot and a shared one through one
 * `applyParsed`, which is what keeps the two paths from drifting (ADR 0003).
 * That only holds if there is one shaping too, so it lives here beside the
 * read it shapes rather than in either caller. The field names are the
 * server's, from when this payload came over HTTP; they stay until the tab's
 * own wire form is revisited. */
export interface KillerReading {
  board: WireBoard;
  unsure: { r: number; c: number }[];
  fully_caged: boolean;
  checksum_ok: boolean;
  sum_total: number;
  needs_review: boolean;
}

/** What the Killer tab shows for `read`. */
export function killerReading(read: KillerRead): KillerReading {
  return {
    board: read.board.toWire(),
    unsure: read.unsure.map(([r, c]) => ({ r, c })),
    fully_caged: read.board.isFullyCaged(),
    checksum_ok: read.checksumOk,
    sum_total: read.sumTotal,
    needs_review: read.needsReview,
  };
}

/** Crop the board out of the app chrome and square it up.
 *
 * Reimplemented rather than sharing grid-detect.ts's `warpBoard`: that helper
 * is fixed to the classic reader's 486 warp, and this reader's sums need the
 * larger 972 to stay legible (see `WARP`). `findGridQuad` is shared — corner
 * detection has nothing app-specific about it, and it already hands back
 * ordered corners, so there is no separate ordering step here the way
 * killer.py's `_warp_board` still has one. */
function warpBoard(cv: OpenCVRuntime, image: Pixels): Pixels {
  const mats = new MatScope();
  try {
    const src = mats.keep(matOfPixels(cv, image));
    const gray = mats.empty(cv);
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    const quad = findGridQuad(cv, gray);
    const board = mats.empty(cv);
    if (quad !== null) {
      const from = mats.keep(cv.matFromArray(4, 1, cv.CV_32FC2, quad.flat()));
      const to = mats.keep(
        cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, WARP - 1, 0, WARP - 1, WARP - 1, 0, WARP - 1]),
      );
      const transform = mats.keep(cv.getPerspectiveTransform(from, to));
      cv.warpPerspective(src, board, transform, new cv.Size(WARP, WARP));
    } else {
      cv.resize(src, board, new cv.Size(WARP, WARP));
    }
    return pixelsOfMat(board);
  } finally {
    mats.release();
  }
}

/**
 * Mask of saturated blue/green pixels — cage outlines, sums and placed
 * digits.
 *
 * Deliberately catches both border colours: green means "this cage is
 * already satisfied", which is a rendering state and must not change the
 * structure read.
 */
function inkColourMask(cv: OpenCVRuntime, board: Pixels): Gray {
  const mats = new MatScope();
  try {
    const rgba = mats.keep(matOfPixels(cv, board));
    const rgb = mats.empty(cv);
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    const hsv = mats.empty(cv);
    // Saturation and value are the same numbers whether the source channels
    // were RGB or BGR, so this does not care that the Python reader's are.
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

    const data = new Uint8Array(board.width * board.height);
    for (let i = 0; i < data.length; i++) {
      const s = hsv.data[i * 3 + 1];
      const v = hsv.data[i * 3 + 2];
      if (s > 70 && v > 90) data[i] = 255;
    }
    return { width: board.width, height: board.height, data };
  } finally {
    mats.release();
  }
}

/** Whether cell `(r, c)` is outlined on `side` ('t', 'b', 'l' or 'r'). */
function hasOutline(coloured: Gray, r: number, c: number, side: "t" | "b" | "l" | "r"): boolean {
  const y0 = r * CELL;
  const x0 = c * CELL;
  const a = Math.trunc(BORDER_SPAN[0] * CELL);
  const b = Math.trunc(BORDER_SPAN[1] * CELL);
  const lo = Math.trunc(BORDER_INSET[0] * CELL);
  const hi = Math.trunc(BORDER_INSET[1] * CELL);
  let best = 0;
  for (let d = lo; d <= hi; d++) {
    let coverage: number;
    if (side === "t") coverage = bandCoverage(coloured, y0 + d, y0 + d + 2, x0 + a, x0 + b, "row");
    else if (side === "b")
      coverage = bandCoverage(coloured, y0 + CELL - d - 2, y0 + CELL - d, x0 + a, x0 + b, "row");
    else if (side === "l") coverage = bandCoverage(coloured, y0 + a, y0 + b, x0 + d, x0 + d + 2, "col");
    else coverage = bandCoverage(coloured, y0 + a, y0 + b, x0 + CELL - d - 2, x0 + CELL - d, "col");
    best = Math.max(best, coverage);
  }
  return best > BORDER_COVERAGE;
}

/**
 * The fraction of a thin band that is coloured somewhere across its short
 * axis — numpy's `coloured[y0:y1, x0:x1].any(axis=...).mean()`.
 *
 * `"row"` collapses the (2px-tall) row axis, for the top/bottom sides;
 * `"col"` collapses the (2px-wide) column axis, for the left/right sides.
 */
function bandCoverage(coloured: Gray, y0: number, y1: number, x0: number, x1: number, collapse: "row" | "col"): number {
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return 0;
  if (collapse === "row") {
    let hit = 0;
    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        if (coloured.data[y * coloured.width + x] !== 0) {
          hit++;
          break;
        }
      }
    }
    return hit / width;
  }
  let hit = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (coloured.data[y * coloured.width + x] !== 0) {
        hit++;
        break;
      }
    }
  }
  return hit / height;
}

/** A 9x9 grid of cage ids, flood-filled across un-outlined edges. */
function labelCages(coloured: Gray): number[][] {
  const splitRight: boolean[][] = Array.from({ length: N }, (_, r) =>
    Array.from({ length: N - 1 }, (_, c) => hasOutline(coloured, r, c, "r") || hasOutline(coloured, r, c + 1, "l")),
  );
  const splitDown: boolean[][] = Array.from({ length: N - 1 }, (_, r) =>
    Array.from({ length: N }, (_, c) => hasOutline(coloured, r, c, "b") || hasOutline(coloured, r + 1, c, "t")),
  );

  const labels: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(-1));
  let next = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (labels[r][c] >= 0) continue;
      labels[r][c] = next;
      const stack: Coord[] = [[r, c]];
      while (stack.length) {
        const [a, b] = stack.pop()!;
        const nbrs: Coord[] = [];
        if (b < N - 1 && !splitRight[a][b]) nbrs.push([a, b + 1]);
        if (b > 0 && !splitRight[a][b - 1]) nbrs.push([a, b - 1]);
        if (a < N - 1 && !splitDown[a][b]) nbrs.push([a + 1, b]);
        if (a > 0 && !splitDown[a - 1][b]) nbrs.push([a - 1, b]);
        for (const [na, nb] of nbrs) {
          if (labels[na][nb] < 0) {
            labels[na][nb] = next;
            stack.push([na, nb]);
          }
        }
      }
      next++;
    }
  }
  return labels;
}

/**
 * The cage sum's individual digit glyphs in cell `(r, c)`, left to right,
 * unclassified — ink-on-black crops ready for `classifyGlyph`.
 */
function sumGlyphCrops(cv: OpenCVRuntime, coloured: Gray, r: number, c: number): Gray[] {
  const y0 = r * CELL;
  const x0 = c * CELL;
  const bandY0 = y0 + Math.trunc(SUM_TOP * CELL);
  const bandY1 = y0 + Math.trunc(SUM_BOTTOM * CELL);
  const bandX0 = x0 + Math.trunc(SUM_LEFT * CELL);
  const bandX1 = x0 + Math.trunc(SUM_RIGHT * CELL);
  const band = cropGray(coloured, bandX0, bandY0, bandX1 - bandX0, bandY1 - bandY0);
  if (band.width <= 0 || band.height <= 0) return [];

  return withLabels(cv, band, (blobs, labelData) => {
    const glyphs: [number, Gray][] = [];
    for (const { label, x, y, width, height, area } of blobs) {
      // The outline leaves long thin runs in this crop; digits are compact.
      if (!(0.09 * CELL <= height && height <= 0.26 * CELL) || width > 0.2 * CELL || area < 20) continue;
      if (width < SUM_MIN_WIDTH * CELL || width / height < SUM_MIN_ASPECT) continue; // an outline sliver, not a digit

      const mask = new Uint8Array(width * height);
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          if (labelData[(y + row) * band.width + (x + col)] === label) mask[row * width + col] = 255;
        }
      }
      glyphs.push([x, { width, height, data: mask }]);
    }
    return glyphs.sort((p, q) => p[0] - q[0]).map(([, glyph]) => glyph);
  });
}

/** The cage sum printed in cell `(r, c)`, plus the weakest digit's NCC. */
function readSum(
  cv: OpenCVRuntime,
  coloured: Gray,
  r: number,
  c: number,
  exemplars: ReadonlyMap<number, Float64Array[]>,
): { total: number | null; worst: number } {
  const glyphs = sumGlyphCrops(cv, coloured, r, c);
  if (glyphs.length === 0) return { total: null, worst: 0 };

  let digits = "";
  let worst = 1;
  for (const glyph of glyphs) {
    const { digit, score } = classifyGlyph(cv, glyph, exemplars);
    if (digit === null) return { total: null, worst: 0 };
    digits += String(digit);
    worst = Math.min(worst, score);
  }
  return { total: Number(digits), worst };
}
