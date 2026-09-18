// The receiving half of the Android share target.
//
// The OS side of this cannot be tested off-device: there is no share sheet, no
// install, and jsdom has no service worker. What *is* testable is everything
// after the redirect — and that is where the logic lives. sw.js stashes the
// file and sends the browser to /?shared=1; from there it is ordinary page
// code, so the cache is stubbed and the rest runs for real.
//
// One thing it cannot run for real is the read itself: jsdom has no image
// decoder and no way to start the OpenCV runtime, so a shared screenshot never
// gets past `decodeImageFile` here. That splits the share path across three
// suites. What a share does *around* the read — uploading nothing, failing in
// the drop path's words, consuming the stash, clearing the marker — is
// asserted here, and so is what a tab *shows* once it is handed a reading,
// since showing it needs the real page. Which puzzle a screenshot is belongs
// to tests/reader/share-dispatch.test.ts, against real fixtures; the step
// between the two, where a reading picks its tab, belongs to tests/share/.

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { boot, ROOT } = require("./harness");

const cells = () => Array.from({ length: 81 }, () => ({ value: null, pencil_marks: [] }));
const cage = (sum, coords) => ({ sum, cells: coords.map(([r, c]) => ({ r, c })) });

const KILLER_READING = {
  kind: "killer",
  board: { cells: cells(), cages: [cage(15, [[0, 0], [1, 0]]), cage(7, [[0, 1], [0, 2]])] },
  unsure: [],
  fully_caged: false,
  sum_total: 22,
  checksum_ok: false,
  needs_review: false,
};

/**
 * Boot the page as though a screenshot had just been shared into it.
 *
 * Sudoku is first in the app's PUZZLES list and so owns the opening tab, which
 * is what makes "the share switched tabs" mean anything — hence `activate:
 * null`, leaving it up rather than jumping to the harness's Killer default.
 *
 * `fetch` is recorded rather than answered: the share path must not reach it at
 * all now that the reader and the choice of reader both run here.
 *
 * @param {string} state  the ?shared= marker sw.js redirects with
 * @param {object} opts   stashed:false to mimic a cache that lost the file
 */
async function share(state, { stashed = true } = {}) {
  const deleted = [];
  const requested = [];
  const ui = await boot({
    activate: null,
    url: `http://localhost/?shared=${state}`,
    fetch: async (url) => {
      requested.push(url);
      throw new Error(`the share path must not call the network (asked for ${url})`);
    },
    setUp(window) {
      const blob = new window.Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
      window.caches = {
        open: async () => ({
          match: async () => (stashed ? { blob: async () => blob } : undefined),
          delete: async (key) => deleted.push(key),
        }),
      };
    },
  });
  await ui.flush();
  await ui.flush();
  return { ui, deleted, requested };
}

/**
 * Hand a tab a reading the way pwa.ts does once it knows which puzzle it has.
 *
 * This drives the same compat surface `handToTab` drives — `PuzzleShell`,
 * from app.tsx — rather than `handToTab` itself, because what these tests are
 * about is what the tab then *renders*, which needs the real page. That the
 * right tab is picked in the first place is tests/share/'s job.
 */
async function deliver(kind, reading) {
  const ui = await boot({ activate: null });

  ui.window.PuzzleShell.activate(kind);
  ui.window.PuzzleShell.get(kind).acceptShared(reading);
  await ui.flush();
  return ui;
}

describe("android share target", () => {
  describe("a shared screenshot", () => {
    let ui, deleted, requested;
    before(async () => ({ ui, deleted, requested } = await share("1")));

    it("is read on the device, not uploaded anywhere", () => {
      // The whole point of this slice: the screenshot the player shared stays
      // on the phone, and works out which puzzle it is without a connection.
      // The upload was the first thing the old path did, so its absence is the
      // assertion — the read itself then stops at `decodeImageFile`, which
      // jsdom has no decoder for.
      assert.deepEqual(requested, [], "sharing a screenshot must not upload it");
    });

    it("consumes the stashed screenshot", () => {
      assert.deepEqual(deleted, ["/shared-image"],
                       "a leftover would be adopted again on some later launch");
    });

    it("takes the marker out of the address bar", () => {
      // Otherwise a reload tries to adopt a screenshot that is already gone.
      assert.equal(ui.window.location.search, "");
    });
  });

  describe("a shared screenshot the reader cannot read", () => {
    it("says so in the same words a dropped one would", async () => {
      // Same reader, same failure, same sentence — "Could not read that
      // screenshot: …". A share that reported it differently would send the
      // player looking for a difference that is not there.
      const { ui } = await share("1");
      const status = ui.document.getElementById("kDropStatus").textContent;

      assert.match(status, /could not read that screenshot/i);
      assert.doesNotMatch(status, /offline|connection/i,
                          "nothing about reading a share needs the network now");
    });
  });

  describe("handing the reading to a tab", () => {
    it("brings the tab the screenshot belongs to to the front", async () => {
      // Sudoku is the tab in front on boot, so this is a switch, not a
      // coincidence.
      const ui = await deliver("killer", KILLER_READING);

      assert.equal(ui.panel.hidden, false);
      assert.equal(ui.document.querySelector('[data-tab-panel="sudoku"]').hidden, true);
      assert.ok(ui.document.querySelector('.tab[data-tab-id="killer"]').classList.contains("active"));
    });

    it("loads the board through the same path a dropped file takes", async () => {
      const ui = await deliver("killer", KILLER_READING);

      assert.equal(ui.board.querySelectorAll(".kcell:not(.uncaged)").length, 4);
      assert.equal(ui.board.querySelectorAll(".cage-sum").length, 2);
      assert.match(ui.document.getElementById("kDropStatus").textContent, /Read 2 cages/);
    });

    it("still reports what the reader was unhappy about", async () => {
      // The share path must not quietly swallow the warnings the drop path
      // gives: this reading left cells out of every cage.
      const ui = await deliver("killer", KILLER_READING);

      assert.match(ui.document.getElementById("kDropStatus").textContent, /aren't in a cage/);
    });

    it("sends a classic reading to the sudoku tab instead", async () => {
      const board = { cells: cells().map((c) => ({ ...c, low_confidence: false })) };
      const ui = await deliver("sudoku", { kind: "sudoku", board });

      assert.equal(ui.document.querySelector('[data-tab-panel="sudoku"]').hidden, false);
      assert.equal(ui.panel.hidden, true, "the killer tab stays out of the way");
      assert.match(ui.document.getElementById("dropStatus").textContent, /Read board/);
    });

    it("outlines the Cells the reader was not sure of", async () => {
      // The reader moved into the page, but what it says about its own doubt
      // still has to arrive on screen: an unflagged misread is one the player
      // trusts and hints from. Both readings — this one and a dropped file —
      // land through the same `applyParsed`, so this covers the drop path too,
      // which jsdom cannot exercise end to end for want of an image decoder.
      const wire = cells().map((c) => ({ ...c, low_confidence: false }));
      wire[0] = { value: 7, pencil_marks: [], low_confidence: true };
      const ui = await deliver("sudoku", { kind: "sudoku", board: { cells: wire } });

      const low = ui.document.querySelectorAll("#board .cell.low");
      assert.equal(low.length, 1, "exactly the one flagged Cell should be outlined");
      assert.equal(low[0].textContent, "7");
      assert.match(ui.document.getElementById("dropStatus").textContent, /1 cell\(s\) flagged/);
    });
  });

  describe("when the handoff breaks down", () => {
    it("says so if the share carried no image", async () => {
      const { ui, requested } = await share("error");
      assert.match(ui.document.getElementById("kDropStatus").textContent, /didn't contain an image/);
      assert.deepEqual(requested, [], "nothing to read");
    });

    it("says so if the stash lost the file", async () => {
      const { ui, requested } = await share("1", { stashed: false });
      assert.match(ui.document.getElementById("kDropStatus").textContent, /went missing/);
      assert.deepEqual(requested, []);
    });

    it("leaves an ordinary visit completely alone", async () => {
      const ui = await boot({ activate: null, url: "http://localhost/" });
      await ui.flush();
      assert.equal(ui.document.getElementById("kDropStatus").textContent, "");
      assert.equal(ui.document.querySelector('[data-tab-panel="sudoku"]').hidden, false);
    });
  });

  describe("the form field the screenshot arrives under", () => {
    // The manifest names the field, Chrome posts under it and sw.js reads it
    // back. Three places, one string — and nothing that runs on a developer's
    // machine would notice them disagreeing, since the OS side is the one that
    // posts. This assertion used to live in tests/test_app.py, against the
    // endpoint that used to be the fourth place; there is no server in this
    // path any more, so it lives here with the rest of the share target.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, "static/manifest.webmanifest"), "utf8"),
    );
    const worker = fs.readFileSync(path.join(ROOT, "static/sw.js"), "utf8");

    it("is posted to the path the worker intercepts", () => {
      const target = manifest.share_target;
      assert.equal(target.action, "/share");
      assert.equal(target.method.toUpperCase(), "POST");
      assert.equal(target.enctype, "multipart/form-data");
    });

    it("is the field the worker reads back", () => {
      const [field] = manifest.share_target.params.files;
      assert.equal(field.name, "image");
      assert.ok(field.accept.includes("image/png"), "Android screenshots are PNGs");
      assert.ok(worker.includes(`get("${field.name}")`),
                "sw.js must read the form field the manifest declares");
    });
  });
});
