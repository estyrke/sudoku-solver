// Digit classification by template matching.
//
// A port of sudoku/reader/classify.py, thresholds and all. A glyph crop
// (ink-on-black, 8-bit) is normalised to a fixed square and compared against
// the stored exemplars by normalised cross-correlation; the best-matching
// exemplar wins, whichever digit it belongs to.
//
// The exemplars are the baked seeds (web/reader/seeds.ts). The Python reader
// could also learn exemplars from a player's confirmed corrections; that loop
// is still server-side and is not part of this reader.

import type { OpenCVRuntime } from "../cv/runtime.ts";
import { MatScope, pyRound, type Gray } from "./pixels.ts";

/** Normalised glyph side length. */
export const NORM = 24;

/** Ink threshold for finding a glyph's bounding box. */
const INK_LEVEL = 60;

/** Fewest ink pixels a crop needs before it is worth normalising at all. */
const MIN_INK_PIXELS = 4;

export interface Classification {
  digit: number | null;
  /** The best normalised cross-correlation, in [-1, 1]. */
  score: number;
}

/**
 * Crop `glyph` to its ink, scale it into a centred `NORM x NORM` image and
 * return the intensities in [0, 1]. `null` if there is effectively no ink.
 *
 * The aspect ratio is kept, which is not a detail: it is why a slanted stroke
 * reads as a different shape from an upright one, and so why the seeds ship a
 * slanted copy of every exemplar.
 */
export function normalizeGlyph(cv: OpenCVRuntime, glyph: Gray): Float64Array | null {
  let x0 = glyph.width;
  let x1 = -1;
  let y0 = glyph.height;
  let y1 = -1;
  let inkPixels = 0;
  for (let y = 0; y < glyph.height; y++) {
    for (let x = 0; x < glyph.width; x++) {
      if (glyph.data[y * glyph.width + x] <= INK_LEVEL) continue;
      inkPixels++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (inkPixels < MIN_INK_PIXELS) return null;

  const h = y1 - y0 + 1;
  const w = x1 - x0 + 1;
  const scale = (NORM - 4) / Math.max(h, w);
  const nh = Math.max(1, pyRound(h * scale));
  const nw = Math.max(1, pyRound(w * scale));

  const mats = new MatScope();
  try {
    // Resized as floats in [0, 1], exactly as the Python does: INTER_AREA on
    // the 0..255 bytes and INTER_AREA on the scaled floats are the same
    // arithmetic, but the exemplars were baked from the float path.
    const crop = mats.keep(new cv.Mat(h, w, cv.CV_32FC1));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        crop.data32F[y * w + x] = glyph.data[(y0 + y) * glyph.width + (x0 + x)] / 255;
      }
    }
    const resized = mats.empty(cv);
    cv.resize(crop, resized, new cv.Size(nw, nh), 0, 0, cv.INTER_AREA);

    const canvas = new Float64Array(NORM * NORM);
    const oy = Math.floor((NORM - nh) / 2);
    const ox = Math.floor((NORM - nw) / 2);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        canvas[(oy + y) * NORM + (ox + x)] = resized.data32F[y * nw + x];
      }
    }
    return canvas;
  } finally {
    mats.release();
  }
}

/** Zero-mean normalised cross-correlation of two equal-length images, in [-1, 1]. */
export function ncc(a: Float64Array, b: Float64Array): number {
  let aMean = 0;
  let bMean = 0;
  for (let i = 0; i < a.length; i++) {
    aMean += a[i];
    bMean += b[i];
  }
  aMean /= a.length;
  bMean /= b.length;

  let dot = 0;
  let aSquares = 0;
  let bSquares = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] - aMean;
    const bv = b[i] - bMean;
    dot += av * bv;
    aSquares += av * av;
    bSquares += bv * bv;
  }
  const denom = Math.sqrt(aSquares) * Math.sqrt(bSquares);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * The digit `glyph` looks most like, and how much.
 *
 * `exemplars` is iterated in its own order and a tie goes to whichever digit
 * came first, which is how the Python store behaves — its dictionary is built
 * in ascending digit order. Callers pass the digits they are willing to read,
 * so the classic reader never has a cage sum's zero to lose a tie to.
 */
export function classifyGlyph(
  cv: OpenCVRuntime,
  glyph: Gray,
  exemplars: ReadonlyMap<number, Float64Array[]>,
): Classification {
  const norm = normalizeGlyph(cv, glyph);
  if (norm === null) return { digit: null, score: 0 };

  let digit: number | null = null;
  let score = -1;
  for (const [forDigit, shapes] of exemplars) {
    for (const exemplar of shapes) {
      const s = ncc(norm, exemplar);
      if (s > score) {
        digit = forDigit;
        score = s;
      }
    }
  }
  return { digit, score };
}
