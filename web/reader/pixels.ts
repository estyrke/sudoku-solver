// The reader's own picture types, and the crossing into OpenCV's.
//
// Two shapes travel through the pipeline: `Pixels`, decoded RGBA as the
// platform's canvas hands it over, and `Gray`, a single-channel image — an ink
// mask, a component. Both are plain arrays, which is deliberate: everything
// the Python reader does in numpy is done here on plain arrays too, so those
// steps can be read against their originals, tested without a runtime, and
// cannot leak WebAssembly memory. OpenCV is reached for only where it is doing
// real work (blur, threshold, contours, warp, resize, connected components),
// and a Mat never outlives the function that made it.
//
// Nothing here is a copy the Python does not also make: `detect_and_split`
// copies every cell out of the warped board, and numpy slicing of a component
// out of a label image allocates too.

import type { OpenCVMat, OpenCVRuntime } from "../cv/runtime.ts";

/** A decoded image: RGBA, 4 bytes per pixel, row-major, no padding. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** A single-channel 8-bit image: an ink mask, a glyph, a component. */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Every Mat opened inside one step, so the step can free them all at once.
 *
 * A Mat holds memory in the WebAssembly heap, which the JavaScript garbage
 * collector cannot see and will never reclaim. An early `return` in the middle
 * of a pipeline step is the easy way to leak one, and the reader is full of
 * early returns — an empty cell, a glyph with no ink. Opening through a scope
 * and releasing in a `finally` makes the leak impossible rather than unlikely.
 */
export class MatScope {
  private readonly open: OpenCVMat[] = [];

  /** Track `mat` and hand it back. */
  keep<M extends OpenCVMat>(mat: M): M {
    this.open.push(mat);
    return mat;
  }

  /** An empty Mat for an output argument. */
  empty(cv: OpenCVRuntime): OpenCVMat {
    return this.keep(new cv.Mat());
  }

  release(): void {
    for (const mat of this.open) mat.delete();
    this.open.length = 0;
  }
}

/** `pixels` as an RGBA Mat. */
export function matOfPixels(cv: OpenCVRuntime, pixels: Pixels): OpenCVMat {
  const mat = new cv.Mat(pixels.height, pixels.width, cv.CV_8UC4);
  mat.data.set(pixels.data);
  return mat;
}

/** `gray` as a single-channel Mat. */
export function matOfGray(cv: OpenCVRuntime, gray: Gray): OpenCVMat {
  const mat = new cv.Mat(gray.height, gray.width, cv.CV_8UC1);
  mat.data.set(gray.data);
  return mat;
}

/** An RGBA Mat's bytes, copied out of the heap. */
export function pixelsOfMat(mat: OpenCVMat): Pixels {
  return { width: mat.cols, height: mat.rows, data: Uint8Array.from(mat.data) };
}

/** The rectangle `[y, y + height) x [x, x + width)` of `pixels`, copied. */
export function cropPixels(pixels: Pixels, x: number, y: number, width: number, height: number): Pixels {
  const out = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * pixels.width + x) * 4;
    out.set(pixels.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data: out };
}

/** The rectangle `[y, y + height) x [x, x + width)` of `gray`, copied. Killer's
 *  cage-sum crop is cut from a whole-board ink mask this way, the same shape
 *  as `cropPixels` cuts a cell out of a whole-board RGBA image. */
export function cropGray(gray: Gray, x: number, y: number, width: number, height: number): Gray {
  const out = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const from = (y + row) * gray.width + x;
    out.set(gray.data.subarray(from, from + width), row * width);
  }
  return { width, height, data: out };
}

/**
 * Python's `round`, which breaks a tie towards the even number rather than
 * away from zero — `round(2.5)` is 2, not 3.
 *
 * Used wherever the ported pipeline rounds, because the sizes it rounds (a
 * border margin, a resized glyph, a sub-cell boundary) land on an exact half
 * often enough at these small integers to move a crop by a pixel, and a pixel
 * is enough to change what a 16px glyph classifies as.
 */
export function pyRound(value: number): number {
  const below = Math.floor(value);
  const fraction = value - below;
  if (fraction > 0.5) return below + 1;
  if (fraction < 0.5) return below;
  return below % 2 === 0 ? below : below + 1;
}
