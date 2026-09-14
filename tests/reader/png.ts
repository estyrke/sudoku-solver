// A small PNG decoder, for the reader tests only.
//
// The reader takes decoded pixels and leaves decoding to its caller: in the
// browser that is the platform's image-bitmap and canvas APIs, which Node does
// not have. Rather than pull in an image library — or a headless browser — to
// look at a handful of committed screenshots, the fixtures are decoded here.
//
// Deliberately narrow: 8-bit, non-interlaced, no palette. That is what the
// committed fixtures are, and anything else should fail loudly rather than
// quietly produce the wrong pixels. This is not a decoder for anything a
// player might share; the browser's own is, and it supports far more.

import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

import type { Pixels } from "../../web/reader/pixels.ts";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channels per pixel, by PNG colour type. Palette (3) is not supported. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePngFile(path: URL | string): Pixels {
  return decodePng(readFileSync(path));
}

export function decodePng(bytes: Uint8Array): Pixels {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error("not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Uint8Array[] = [];

  // Chunks: length (u32), type (4 bytes), data, CRC (u32). The CRC is not
  // checked — a corrupt fixture would fail the read it feeds, loudly enough.
  for (let at = SIGNATURE.length; at + 8 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;

    if (type === "IHDR") {
      const head = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = head.getUint32(0);
      height = head.getUint32(4);
      const [bitDepth, colourType, compression, filter, interlace] = data.subarray(8, 13);
      if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
      if (compression !== 0 || filter !== 0) throw new Error("unsupported PNG compression");
      if (interlace !== 0) throw new Error("interlaced PNGs are not supported");
      channels = CHANNELS[colourType];
      if (!channels) throw new Error(`unsupported PNG colour type ${colourType}`);
    } else if (type === "IDAT") {
      // Split across several chunks for anything bigger than a thumbnail, and
      // it is one zlib stream, so they are joined before inflating.
      parts.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (!channels) throw new Error("PNG has no header chunk");

  const raw = new Uint8Array(inflateSync(Buffer.concat(parts)));
  return toRgba(unfilter(raw, width, height, channels), width, height, channels);
}

/**
 * Undo the per-row filters, returning `height * width * channels` bytes.
 *
 * Every row is prefixed by its filter type, and filters predict a byte from
 * the one to its left (`a`), the one above (`b`) and the one above-left (`c`).
 */
function unfilter(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    const from = row * (stride + 1) + 1;
    const to = row * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[from + i];
      const a = i >= channels ? out[to + i - channels] : 0;
      const b = row > 0 ? out[to - stride + i] : 0;
      const c = row > 0 && i >= channels ? out[to - stride + i - channels] : 0;
      out[to + i] = (x + predict(filter, a, b, c)) & 0xff;
    }
  }
  return out;
}

function predict(filter: number, a: number, b: number, c: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return (a + b) >> 1;
    case 4:
      return paeth(a, b, c);
    default:
      throw new Error(`unknown PNG row filter ${filter}`);
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function toRgba(samples: Uint8Array, width: number, height: number, channels: number): Pixels {
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const from = pixel * channels;
    const to = pixel * 4;
    // Greyscale types carry one colour sample, which all three channels take.
    const grey = channels <= 2;
    data[to] = samples[from];
    data[to + 1] = grey ? samples[from] : samples[from + 1];
    data[to + 2] = grey ? samples[from] : samples[from + 2];
    data[to + 3] = channels === 2 || channels === 4 ? samples[from + channels - 1] : 255;
  }
  return { width, height, data };
}
