// Turn one cell image into (value, given?, pencil marks, confidence).
//
// A port of sudoku/reader/cell_parse.py. Every threshold below is that file's
// value, including the ones that are known to be specific to one app: this
// reader is the Python one moved, not the Python one improved.
//
// A cell holds at most one large central glyph (a Pen value or a Given) OR
// several small Pencil marks. Binarize, drop the grid border, then decide by
// the size of the largest component: tall means value, everything small means
// Pencil marks.
//
// Pencil-mark reading is *positional*: the inner cell area is divided into a
// 3x3 sub-grid and each position is checked for enough ink. Position
// (subRow, subCol) is the digit `subRow * 3 + subCol + 1` — top-left 1,
// top-centre 2, ... bottom-right 9. That is far more robust than
// shape-classifying tiny glyphs, and it is the layout digital Sudoku apps use.
//
// Given-versus-entered is guessed from colour saturation: Givens are usually
// black, and digits the player entered are often tinted blue.

import type { OpenCVRuntime } from "../cv/runtime.ts";
import { classifyGlyph } from "./classify.ts";
import { MatScope, matOfGray, matOfPixels, pyRound, type Gray, type Pixels } from "./pixels.ts";

// Size thresholds as a fraction of cell height.
/** A component this tall (or taller) is the cell's value. */
const VALUE_MIN_H = 0.42;
const NOISE_MIN_AREA = 8;
/** Cross-correlation below this flags the value as low-confidence. */
const VALUE_CONF = 0.45;
/** Mean saturation above this means an entered (tinted) digit, not a Given. */
const SAT_GIVEN_MAX = 55;
// `MARK_MIN_H` and `MARK_MAX_H` are not missing: the Python file still declares
// them but nothing reads them — positional detection replaced the size filter
// they belonged to. Porting a threshold no code consults would be porting a
// claim, not a behaviour.
/** Margin discarded from every edge of a cell, to drop the grid lines. */
const BORDER_MARGIN = 0.12;

// The layout of `connectedComponentsWithStats`' stats Mat: one row per label,
// five 32-bit columns.
const STAT_COLUMNS = 5;
const STAT_LEFT = 0;
const STAT_TOP = 1;
const STAT_WIDTH = 2;
const STAT_HEIGHT = 3;
const STAT_AREA = 4;

/** Fraction of ink pixels in a sub-cell required to count as a Pencil mark. */
const MARK_INK_THRESH = 0.04;

// A grid or cage line that survives the border crop shows up as a hairline: one
// or two pixels thick and running most of the width of the cell. Spread across
// three sub-cells it clears the ink threshold on its own, which is how the
// bottom-right cell of a board — where the outer frame sits closest to the crop
// — picked up phantom 7 and 9 marks. Counting ink by the pixel cannot tell that
// apart, so hairlines are dropped before the count. The bound is a fraction of
// cell height so it holds at either reader's warp size; the thinnest real mark
// is several times it.
const MARK_MIN_THICK = 0.03;

/** The vertical slice of a cell the Pencil-mark grid occupies, as (top, bottom)
 *  fractions. The whole cell is what apps that centre their marks need. */
export type MarkBand = readonly [number, number];

export const WHOLE_CELL: MarkBand = [0, 1];

export interface CellRead {
  value: number | null;
  isGiven: boolean;
  pencilMarks: Set<number>;
  lowConfidence: boolean;
}

/** One connected component of an ink mask. */
export interface Component {
  /** The component alone, as ink on black, cropped to its bounding box. */
  mask: Gray;
  x: number;
  y: number;
  height: number;
  area: number;
}

/** Binary ink mask (ink = 255) with the grid border cropped away. */
export function cellInk(cv: OpenCVRuntime, cell: Pixels): Gray {
  const margin = pyRound(BORDER_MARGIN * cell.height);
  const mats = new MatScope();
  try {
    const inner = mats.keep(matOfPixels(cv, trim(cell, margin)));
    const gray = mats.empty(cv);
    cv.cvtColor(inner, gray, cv.COLOR_RGBA2GRAY);
    const ink = mats.empty(cv);
    // Otsu, inverted so darker ink becomes white foreground.
    cv.threshold(gray, ink, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

    const data = Uint8Array.from(ink.data);
    // If Otsu picked the background as foreground (mostly white), flip it back.
    let total = 0;
    for (const v of data) total += v;
    if (total / data.length > 127) {
      for (let i = 0; i < data.length; i++) data[i] = 255 - data[i];
    }
    return { width: ink.cols, height: ink.rows, data };
  } finally {
    mats.release();
  }
}

/** Every non-noise connected component of `ink`, in label order. */
export function components(cv: OpenCVRuntime, ink: Gray): Component[] {
  const mats = new MatScope();
  try {
    const image = mats.keep(matOfGray(cv, ink));
    const labels = mats.empty(cv);
    const stats = mats.empty(cv);
    const centroids = mats.empty(cv);
    const count = cv.connectedComponentsWithStats(image, labels, stats, centroids, 8);

    const out: Component[] = [];
    // Label 0 is the background.
    for (let label = 1; label < count; label++) {
      const at = label * STAT_COLUMNS;
      const x = stats.data32S[at + STAT_LEFT];
      const y = stats.data32S[at + STAT_TOP];
      const width = stats.data32S[at + STAT_WIDTH];
      const height = stats.data32S[at + STAT_HEIGHT];
      if (stats.data32S[at + STAT_AREA] < NOISE_MIN_AREA) continue;
      const area = stats.data32S[at + STAT_AREA];
      const mask = new Uint8Array(width * height);
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          if (labels.data32S[(y + row) * ink.width + (x + col)] === label) mask[row * width + col] = 255;
        }
      }
      out.push({ mask: { width, height, data: mask }, x, y, height, area });
    }
    return out;
  } finally {
    mats.release();
  }
}

/**
 * Read one cell.
 *
 * `markBand` is the vertical slice of the cell its Pencil marks occupy. It
 * defaults to the whole cell, which is what the classic layout needs; Killer
 * boards reserve a strip at the top of every cell for the cage sum and push
 * the marks below it.
 */
export function parseCell(
  cv: OpenCVRuntime,
  cell: Pixels,
  exemplars: ReadonlyMap<number, Float64Array[]>,
  markBand: MarkBand = WHOLE_CELL,
): CellRead {
  const ink = cellInk(cv, cell);
  const comps = components(cv, ink);
  if (comps.length === 0) return emptyRead();

  const valueComp = largestTallerThan(comps, VALUE_MIN_H * ink.height);
  if (valueComp !== null) {
    const { digit, score } = classifyGlyph(cv, valueComp.mask, exemplars);
    return {
      value: digit,
      isGiven: isGiven(cv, cell, ink),
      pencilMarks: new Set<number>(),
      lowConfidence: digit === null || score < VALUE_CONF,
    };
  }

  // No large glyph — read Pencil marks positionally.
  return {
    value: null,
    isGiven: false,
    pencilMarks: positionalMarks(cv, ink, markBand),
    lowConfidence: false,
  };
}

/**
 * Detect Pencil marks by position in a 3x3 sub-grid overlay.
 *
 * Digit d occupies sub-cell ((d-1)/3, (d-1)%3): top-left 1 ... bottom-right 9.
 * Ink pixels are counted in each sub-cell and thresholded by a fraction of its
 * area.
 */
export function positionalMarks(cv: OpenCVRuntime, ink: Gray, band: MarkBand = WHOLE_CELL): Set<number> {
  const clean = withoutHairlines(cv, ink);
  const [top, bottom] = band;
  const yStart = top * clean.height;
  const ySpan = (bottom - top) * clean.height;
  const subH = ySpan / 3;
  const subW = clean.width / 3;

  const marks = new Set<number>();
  for (let subRow = 0; subRow < 3; subRow++) {
    for (let subCol = 0; subCol < 3; subCol++) {
      // Clamped to the image the way a numpy slice is, so a band that reaches
      // past the bottom of the cell shrinks the sub-cell rather than counting
      // area that is not there.
      const y0 = clamp(pyRound(yStart + subRow * subH), clean.height);
      const y1 = clamp(pyRound(yStart + (subRow + 1) * subH), clean.height);
      const x0 = clamp(pyRound(subCol * subW), clean.width);
      const x1 = clamp(pyRound((subCol + 1) * subW), clean.width);
      const area = Math.max(0, y1 - y0) * Math.max(0, x1 - x0);
      if (area === 0) continue;
      let inked = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) if (clean.data[y * clean.width + x] > 0) inked++;
      }
      if (inked / area >= MARK_INK_THRESH) marks.add(subRow * 3 + subCol + 1);
    }
  }
  return marks;
}

/** `ink` with every component too thin in either axis to be a digit removed. */
export function withoutHairlines(cv: OpenCVRuntime, ink: Gray): Gray {
  const floor = Math.max(2, pyRound(MARK_MIN_THICK * ink.height));
  const out = Uint8Array.from(ink.data);
  const mats = new MatScope();
  try {
    const image = mats.keep(matOfGray(cv, ink));
    const labels = mats.empty(cv);
    const stats = mats.empty(cv);
    const centroids = mats.empty(cv);
    const count = cv.connectedComponentsWithStats(image, labels, stats, centroids, 8);

    for (let label = 1; label < count; label++) {
      const at = label * STAT_COLUMNS;
      const x = stats.data32S[at + STAT_LEFT];
      const y = stats.data32S[at + STAT_TOP];
      const width = stats.data32S[at + STAT_WIDTH];
      const height = stats.data32S[at + STAT_HEIGHT];
      const area = stats.data32S[at + STAT_AREA];
      if (Math.min(width, height) >= floor && area >= NOISE_MIN_AREA) continue;
      for (let row = y; row < y + height; row++) {
        for (let col = x; col < x + width; col++) {
          if (labels.data32S[row * ink.width + col] === label) out[row * ink.width + col] = 0;
        }
      }
    }
    return { width: ink.width, height: ink.height, data: out };
  } finally {
    mats.release();
  }
}

function emptyRead(): CellRead {
  return { value: null, isGiven: false, pencilMarks: new Set<number>(), lowConfidence: false };
}

/** The largest-area component at least `minHeight` tall, or `null`. */
function largestTallerThan(comps: Component[], minHeight: number): Component | null {
  let best: Component | null = null;
  for (const comp of comps) {
    if (comp.height < minHeight) continue;
    // Strictly greater, so the first of equal-area components wins, as
    // Python's `max` over the components in label order does.
    if (best === null || comp.area > best.area) best = comp;
  }
  return best;
}

/** Heuristic: a black glyph is a Given; a tinted one was entered by the player. */
function isGiven(cv: OpenCVRuntime, cell: Pixels, ink: Gray): boolean {
  const margin = pyRound(BORDER_MARGIN * cell.height);
  const mats = new MatScope();
  try {
    const inner = mats.keep(matOfPixels(cv, trim(cell, margin)));
    const rgb = mats.empty(cv);
    cv.cvtColor(inner, rgb, cv.COLOR_RGBA2RGB);
    const hsv = mats.empty(cv);
    // Saturation is (max - min) / max over the colour channels, so it does not
    // care that these pixels are RGB where the Python reader's are BGR.
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

    let inked = 0;
    let saturation = 0;
    for (let i = 0; i < ink.data.length; i++) {
      if (ink.data[i] === 0) continue;
      inked++;
      saturation += hsv.data[i * 3 + 1];
    }
    if (inked < 5) return true;
    return saturation / inked <= SAT_GIVEN_MAX;
  } finally {
    mats.release();
  }
}

const clamp = (value: number, limit: number): number => Math.min(Math.max(value, 0), limit);

/** `cell` with `margin` pixels taken off every edge. */
function trim(cell: Pixels, margin: number): Pixels {
  const width = cell.width - 2 * margin;
  const height = cell.height - 2 * margin;
  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((margin + row) * cell.width + margin) * 4;
    data.set(cell.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data };
}
