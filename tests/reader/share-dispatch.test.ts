// Choosing a reader for a shared screenshot, in the browser.
//
// The Android share sheet offers one target but the app has two readers, so
// something has to decide which board it is looking at. That decision used to
// be `/share/parse`'s; these tests are its Python tests moved across, fixture
// for fixture, so the rule is pinned to the same screenshots it was pinned to
// on the server.
//
// Like the reader suites next door, this runs against the same committed
// OpenCV.js artifact the browser loads, and every fixture is decoded by the
// small PNG decoder next door.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MIN_KILLER_CAGES,
  readSharedScreenshot,
  type DispatchedReading,
} from "../../web/reader/share-dispatch.ts";
import { readKillerBoard } from "../../web/reader/killer-board.ts";
import { decodePngFile } from "./png.ts";

const FIXTURE = (name: string) => new URL(`../fixtures/${name}.png`, import.meta.url);

const KILLER = "puzzle_page_killer_board3";
const CLASSIC = "meowdoku_sample_board";

/** Each fixture dispatched once — several tests ask about the same reading. */
const dispatched = new Map<string, Promise<DispatchedReading>>();
function dispatch(name: string): Promise<DispatchedReading> {
  let reading = dispatched.get(name);
  if (!reading) {
    reading = readSharedScreenshot(decodePngFile(FIXTURE(name)));
    dispatched.set(name, reading);
  }
  return reading;
}

/** Narrow a reading to a Killer one, failing with what it actually was.
 *  A ternary in the assertion would report `0 !== 28` and hide the real
 *  cause, which is that the dispatch sent the board to the wrong tab. */
function asKiller(read: DispatchedReading) {
  assert.equal(read.kind, "killer");
  return read as Extract<DispatchedReading, { kind: "killer" }>;
}

test("a shared Killer screenshot goes to the Killer tab", async () => {
  const read = asKiller(await dispatch(KILLER));

  assert.equal(read.board.cages?.length, 28);
  assert.ok(
    read.checksum_ok,
    "the share path must not read the board any worse than the Killer tab does",
  );
});

test("a shared classic screenshot goes to the Sudoku tab instead", async () => {
  // The share sheet offers one target but the app has two readers, so the cage
  // count decides. A board with no cage outlines yields at most a stray one or
  // two from grid artefacts.
  const read = await dispatch(CLASSIC);

  assert.equal(read.kind, "sudoku");
  assert.equal(read.board.cells.length, 81);
});

test("the two kinds are told apart by a wide margin", async () => {
  // The threshold sits in a gap, not on a boundary: if these ever converge the
  // sniff is the thing to revisit, not the constant to nudge.
  const killerCages = asKiller(await dispatch(KILLER)).board.cages?.length ?? 0;
  const classicCages = (await readKillerBoard(decodePngFile(FIXTURE(CLASSIC)))).board.cages.length;

  assert.ok(classicCages < MIN_KILLER_CAGES, `${classicCages} cages on a classic board`);
  assert.ok(MIN_KILLER_CAGES < killerCages, `${killerCages} cages on a Killer board`);
  assert.ok(killerCages - classicCages > 20);
});

test("a shared non-board is refused rather than guessed at", async () => {
  // Flat noise: no grid to find, so neither reader can make a board of it. The
  // page turns the rejection into the same status line a dropped file would
  // have got.
  const noise = {
    width: 64,
    height: 64,
    data: new Uint8ClampedArray(64 * 64 * 4).fill(200),
  };

  await assert.rejects(() => readSharedScreenshot(noise));
});
