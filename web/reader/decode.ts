// Turning a file the player dropped, pasted or chose into pixels.
//
// The reader takes decoded pixels and nothing else (web/reader/read-board.ts),
// which puts this step — and only this step — in charge of what counts as a
// readable screenshot. That is the point: the browser's own codecs decide, so
// whatever a phone's camera roll or share sheet produces is readable, including
// formats OpenCV would refuse.
//
// Browser APIs are reached through `window` rather than as bare globals, like
// the rest of web/, so the jsdom page harness can substitute them per boot —
// see tests/ui/harness.js.

import type { Pixels } from "./pixels.ts";

/**
 * Decode `file` to RGBA pixels.
 *
 * Throws if the platform cannot decode it — an unsupported format, or a file
 * that is not an image at all. The caller turns that into a status line.
 */
export async function decodeImageFile(file: Blob): Promise<Pixels> {
  if (typeof window.createImageBitmap !== "function") {
    throw new Error("this browser cannot decode images in the page");
  }
  const bitmap = await window.createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    // The pixels are read back once and never drawn again, which is exactly
    // the case this hint exists for.
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("this browser gave no 2D canvas to decode into");

    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: image.width, height: image.height, data: image.data };
  } finally {
    // The bitmap holds a decoded copy of the whole screenshot; on a phone that
    // is tens of megabytes waiting on the garbage collector otherwise.
    bitmap.close();
  }
}
