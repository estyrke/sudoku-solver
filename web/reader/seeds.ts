// The digit exemplars recognition matches against.
//
// These are not rendered here, or anywhere at run time. They are the committed
// bitmaps in static/reader/glyph-seeds.bin, which is the source of truth for
// them rather than a copy of one: text rasterisation differs across platforms
// and classifying a ~16px glyph is sensitive enough to notice — macOS and Linux
// once disagreed on more than half the cage sums of one screenshot. Shipping
// the bitmaps is what makes a developer's run and a CI run the same run, and
// docs/reader-assets.md is where changing one is written down.
//
// Format (little-endian):
//
//     "GLYPHS01"      8 bytes, magic and version
//     side            u8, the square side of every exemplar
//     groups          u8, how many digits follow
//     groups x { digit u8, count u16 }
//     then, in that order, count x side x side bytes per group
//
// Digit 0 is in the file. A Sudoku cell never holds one, but a Killer cage sum
// does, so the asset is the whole baked set rather than one reader's slice of
// it; callers take the digits they classify against.

import { loadAsset } from "./asset.ts";

/** Where the asset is served from. The whole front end lives under this prefix
 *  (see vercel.json, which maps only four URLs out of it). */
const ASSET_PATH = "/static/reader/glyph-seeds.bin";

const MAGIC = "GLYPHS01";
const HEADER_BYTES = MAGIC.length + 2;
const GROUP_BYTES = 3;

export interface GlyphSeeds {
  /** Side of every exemplar; the size `normalizeGlyph` scales a crop to. */
  side: number;
  /** Exemplars per digit, each `side * side` intensities in [0, 1], row-major. */
  byDigit: Map<number, Float64Array[]>;
}

/** One parse per process, whoever asks.
 *
 * Parsing a few hundred kilobytes into six hundred typed arrays once per cell
 * would cost more than the whole rest of a read, and the result is immutable,
 * so the *promise* is memoised — concurrent first callers wait on one load
 * rather than starting a second. */
let pending: Promise<GlyphSeeds> | null = null;

export function loadGlyphSeeds(): Promise<GlyphSeeds> {
  if (!pending) {
    pending = loadAsset(ASSET_PATH)
      .then(parseGlyphSeeds)
      .catch((err: unknown) => {
        // A failed load must not poison every later attempt.
        pending = null;
        throw err;
      });
  }
  return pending;
}

/** Forget the loaded seeds. Tests only. */
export function resetGlyphSeedsForTests(): void {
  pending = null;
}

export function parseGlyphSeeds(bytes: Uint8Array): GlyphSeeds {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new Error(`${ASSET_PATH} is not a glyph seed asset`);

  const side = view.getUint8(MAGIC.length);
  const groups = view.getUint8(MAGIC.length + 1);
  const glyphBytes = side * side;

  const counts: [number, number][] = [];
  for (let g = 0; g < groups; g++) {
    const at = HEADER_BYTES + g * GROUP_BYTES;
    counts.push([view.getUint8(at), view.getUint16(at + 1, true)]);
  }

  const byDigit = new Map<number, Float64Array[]>();
  let at = HEADER_BYTES + groups * GROUP_BYTES;
  for (const [digit, count] of counts) {
    const exemplars: Float64Array[] = [];
    for (let i = 0; i < count; i++, at += glyphBytes) {
      // The Python reader divides the stored uint8 by 255 the same way. The
      // arithmetic downstream is float64 rather than numpy's float32; the
      // margins that decide a digit are a hundredth apart, not a millionth.
      const exemplar = new Float64Array(glyphBytes);
      for (let p = 0; p < glyphBytes; p++) exemplar[p] = bytes[at + p] / 255;
      exemplars.push(exemplar);
    }
    byDigit.set(digit, exemplars);
  }
  if (at !== bytes.length) {
    throw new Error(`${ASSET_PATH} is ${bytes.length} bytes, but its header describes ${at}`);
  }
  return { side, byDigit };
}
