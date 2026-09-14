// Where a shared screenshot's reading becomes a tab.
//
// This is three lines of web/pwa.ts — take the `kind` the dispatcher decided,
// bring that tab to the front, hand it the reading — and until this file
// existed it was the one step of the share path nothing covered. The reason is
// worth recording, because it is the reason this suite is not simply part of
// tests/ui: a share driven through the real page under jsdom dies at
// `decodeImageFile`, since jsdom has no image decoder and no way to start the
// OpenCV runtime, so it never gets this far. Either side of the step was
// tested and the join between them was not; a `kind` read from the wrong
// field, or a hardcoded one, would have passed every suite in the repo.
//
// So the page is not booted here at all. `handToTab` talks to the tabs through
// `window.PuzzleShell` (the compat surface in web/app.tsx) and says what it
// has to say through web/ui/shared-reading.ts, and both are stood up by hand.

import test from "node:test";
import assert from "node:assert/strict";

import { handToTab } from "../../web/pwa.ts";
import { onShareStatus } from "../../web/ui/shared-reading.ts";
import type { DispatchedReading } from "../../web/reader/share-dispatch.ts";

const cells = () => Array.from({ length: 81 }, () => ({ value: null, pencil_marks: [] }));

const KILLER_READING = {
  kind: "killer",
  board: {
    cells: cells(),
    cages: [{ sum: 15, cells: [{ r: 0, c: 0 }, { r: 1, c: 0 }] }],
  },
  unsure: [],
  fully_caged: false,
  checksum_ok: false,
  sum_total: 15,
  needs_review: false,
} as DispatchedReading;

const CLASSIC_READING = { kind: "sudoku", board: { cells: cells() } } as DispatchedReading;

/**
 * A shell with the tabs the app has, recording what it was asked to do.
 *
 * `acceptsShared` mirrors the real registry: a tab that never opted in has no
 * `acceptShared`, which is the case the last test is about.
 */
function shell({ accepting = ["sudoku", "killer", "queens"] } = {}) {
  const activated: string[] = [];
  const delivered: { id: string; file: File; reading: unknown }[] = [];

  (globalThis as Record<string, any>).window = {
    PuzzleShell: {
      activate: (id: string) => activated.push(id),
      get: (id: string) =>
        ["sudoku", "queens", "killer"].includes(id)
          ? {
              id,
              acceptShared: accepting.includes(id)
                ? (file: File, reading: unknown) => delivered.push({ id, file, reading })
                : undefined,
            }
          : null,
    },
  };
  return { activated, delivered };
}

/** What the share's status line was told, if anything. */
function status() {
  const said: { message: string; isError: boolean }[] = [];
  onShareStatus((message, isError) => said.push({ message, isError }));
  return said;
}

const FILE = new File([new Uint8Array([137, 80, 78, 71])], "shared-screenshot.png", {
  type: "image/png",
});

test("a Killer reading brings the Killer tab to the front and lands there", () => {
  const { activated, delivered } = shell();

  handToTab(KILLER_READING, FILE);

  assert.deepEqual(activated, ["killer"]);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].id, "killer");
  assert.equal(delivered[0].reading, KILLER_READING, "the reading arrives whole, not rebuilt");
});

test("a classic reading goes to the Sudoku tab instead", () => {
  const { activated, delivered } = shell();

  handToTab(CLASSIC_READING, FILE);

  assert.deepEqual(activated, ["sudoku"]);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].id, "sudoku");
});

test("the tab is handed the original file, not only the reading", () => {
  // "Confirm reading" teaches the digit recognizer by re-extracting glyphs from
  // the image, so a shared board that arrived without its file would silently
  // lose the ability to learn from corrections.
  const { delivered } = shell();

  handToTab(KILLER_READING, FILE);

  assert.equal(delivered[0].file, FILE);
});

test("a reading no tab can open says so rather than vanishing", () => {
  // Queens is a real tab that does not accept screenshots. Nothing dispatches
  // to it today, and if something ever does, the player should be told rather
  // than left looking at a board that never changed.
  const { activated, delivered } = shell({ accepting: [] });
  const said = status();

  handToTab({ kind: "queens" } as unknown as DispatchedReading, FILE);

  assert.deepEqual(activated, [], "no tab is brought forward for a reading it cannot take");
  assert.deepEqual(delivered, []);
  assert.equal(said.length, 1);
  assert.match(said[0].message, /Nothing here can open a queens board/);
  assert.equal(said[0].isError, true);
});
