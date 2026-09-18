// Locate the 9x9 grid in an image and split it into 81 cell crops.
//
// A port of the deleted Python reader's sudoku/reader/grid_detect.py (ADR
// 0006). Two paths: if a strong 4-corner quad is found (a photo, or a
// screenshot with margins around the board) it is perspective-warped to a
// square; otherwise the image is assumed to be the board already and simply
// resized. Either way the output is 81 cell images in row-major order.

import type { OpenCVMat, OpenCVRuntime } from "../cv/runtime.ts";
import { MatScope, cropPixels, matOfPixels, pixelsOfMat, type Pixels } from "./pixels.ts";

/** Warped board side. Divisible by 9, giving 54px cells. */
export const SIZE = 486;
export const CELL = SIZE / 9;

/** A quad's corners, top-left, top-right, bottom-right, bottom-left. */
type Corners = readonly [number, number][];

/** Smallest share of the image a contour must cover to be the board. */
const MIN_QUAD_AREA = 0.2;

/** Return 81 cell images, row-major. */
export function detectAndSplit(cv: OpenCVRuntime, image: Pixels): Pixels[] {
  const mats = new MatScope();
  try {
    const src = mats.keep(matOfPixels(cv, image));
    const gray = mats.empty(cv);
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    const quad = findGridQuad(cv, gray);
    const board = mats.empty(cv);
    if (quad !== null) {
      warpBoard(cv, src, quad, board);
    } else {
      cv.resize(src, board, new cv.Size(SIZE, SIZE));
    }

    const warped = pixelsOfMat(board);
    const cells: Pixels[] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) cells.push(cropPixels(warped, c * CELL, r * CELL, CELL, CELL));
    }
    return cells;
  } finally {
    mats.release();
  }
}

/** The board's 4 corner points, ordered, or `null` if there is no convincing
 *  quad. (The Python reader orders them a step later, in `warp_board`; the
 *  difference is not observable, since nothing else looks at a raw quad.) */
export function findGridQuad(cv: OpenCVRuntime, gray: OpenCVMat): Corners | null {
  const mats = new MatScope();
  try {
    // Every call below leaves the optional arguments off, so each one takes the
    // same defaults its Python counterpart takes — the blur's reflected border
    // and the dilation's "no border" sentinel are not the constants a caller
    // would guess, and both change pixels at the edge of the image.
    const blur = mats.empty(cv);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const thresh = mats.empty(cv);
    cv.adaptiveThreshold(blur, thresh, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 11, 2);
    const kernel = mats.keep(cv.Mat.ones(3, 3, cv.CV_8UC1));
    const dilated = mats.empty(cv);
    cv.dilate(thresh, dilated, kernel);

    const contours = new cv.MatVector();
    const hierarchy = mats.empty(cv);
    try {
      cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const imageArea = gray.rows * gray.cols;
      let best: Corners | null = null;
      let bestArea = 0;
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        try {
          const area = cv.contourArea(contour, false);
          if (area < MIN_QUAD_AREA * imageArea) continue;
          const peri = cv.arcLength(contour, true);
          const approx = mats.empty(cv);
          cv.approxPolyDP(contour, approx, 0.02 * peri, true);
          // Strictly greater, so the first of two equal-area quads wins, as the
          // Python loop's `area > best_area` does.
          if (approx.rows === 4 && area > bestArea) {
            best = orderCorners(pointsOf(approx));
            bestArea = area;
          }
        } finally {
          contour.delete();
        }
      }
      return best;
    } finally {
      contours.delete();
    }
  } finally {
    mats.release();
  }
}

/** Perspective-warp the quad of `src` onto a `SIZE x SIZE` square in `dst`. */
export function warpBoard(cv: OpenCVRuntime, src: OpenCVMat, quad: Corners, dst: OpenCVMat): void {
  const mats = new MatScope();
  try {
    const from = mats.keep(cv.matFromArray(4, 1, cv.CV_32FC2, quad.flat()));
    const to = mats.keep(
      cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, SIZE - 1, 0, SIZE - 1, SIZE - 1, 0, SIZE - 1]),
    );
    const transform = mats.keep(cv.getPerspectiveTransform(from, to));
    cv.warpPerspective(src, dst, transform, new cv.Size(SIZE, SIZE));
  } finally {
    mats.release();
  }
}

/** The (x, y) vertices of a CV_32SC2 contour. */
function pointsOf(contour: OpenCVMat): readonly [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < contour.rows; i++) points.push([contour.data32S[i * 2], contour.data32S[i * 2 + 1]]);
  return points;
}

/**
 * Order 4 points top-left, top-right, bottom-right, bottom-left.
 *
 * Top-left has the smallest x + y and bottom-right the largest; top-right has
 * the smallest y - x and bottom-left the largest. Ties go to the earlier point,
 * which is what numpy's `argmin`/`argmax` do.
 */
export function orderCorners(points: readonly [number, number][]): Corners {
  const pick = (score: (p: readonly [number, number]) => number, want: "min" | "max") => {
    let chosen = points[0];
    let bestScore = score(points[0]);
    for (const point of points.slice(1)) {
      const value = score(point);
      if (want === "min" ? value < bestScore : value > bestScore) {
        chosen = point;
        bestScore = value;
      }
    }
    return chosen;
  };
  const sum = (p: readonly [number, number]) => p[0] + p[1];
  const diff = (p: readonly [number, number]) => p[1] - p[0];
  return [pick(sum, "min"), pick(diff, "min"), pick(sum, "max"), pick(diff, "max")];
}
