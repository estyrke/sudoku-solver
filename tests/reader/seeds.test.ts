// The digit exemplars, as the browser reader gets them.
//
// These are the bytes recognition actually runs on, and they are committed
// bitmaps rather than anything rendered, precisely so that a developer's
// machine and a CI box agree (see docs/reader-assets.md). So what is worth
// asserting is not that the file parses but that it still carries the exemplars
// the Python reader classified against — an edit that quietly dropped or
// rescaled a digit would leave every other test in this suite testing a
// different classifier, and pass.

import test from "node:test";
import assert from "node:assert/strict";

import { NORM } from "../../web/reader/classify.ts";
import { loadGlyphSeeds } from "../../web/reader/seeds.ts";

test("every digit arrives, at the size the classifier normalises to", async () => {
  const seeds = await loadGlyphSeeds();

  assert.equal(seeds.side, NORM);
  // Zero included: a Sudoku cell never holds one, but a Killer cage sum does,
  // and the asset is the whole baked set rather than the classic reader's slice.
  assert.deepEqual([...seeds.byDigit.keys()].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const [digit, exemplars] of seeds.byDigit) {
    assert.ok(exemplars.length > 0, `digit ${digit} has no exemplars`);
    for (const exemplar of exemplars) {
      assert.equal(exemplar.length, NORM * NORM, `digit ${digit} exemplar is not ${NORM}x${NORM}`);
    }
  }
});

test("the exemplar counts still match the set the Python reader shipped", async () => {
  const seeds = await loadGlyphSeeds();

  // 5 fonts x 6 scale/thickness pairs, upright and slanted (the slant is what
  // resolves the app's italic 1), plus the real-glyph exemplars lifted from the
  // reference screenshots: two open-topped 4s and one cage-sum 6.
  const counts = Object.fromEntries([...seeds.byDigit].map(([d, e]) => [d, e.length]));
  assert.deepEqual(counts, { 0: 60, 1: 60, 2: 60, 3: 60, 4: 62, 5: 60, 6: 61, 7: 60, 8: 60, 9: 60 });
});

test("the same seeds are handed to every caller", async () => {
  // Parsing 347KB into 600-odd typed arrays once per cell would dominate a read.
  const [first, second] = await Promise.all([loadGlyphSeeds(), loadGlyphSeeds()]);
  assert.equal(first, second);
});
