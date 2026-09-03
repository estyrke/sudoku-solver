// The receiving half of the Android share target.
//
// The OS side of this cannot be tested off-device: there is no share sheet, no
// install, and jsdom has no service worker. What *is* testable is everything
// after the redirect — and that is where the logic lives. sw.js stashes the
// file and sends the browser to /?shared=1; from there it is ordinary page
// code, so the cache is stubbed and the rest runs for real.

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const { boot } = require("./harness");

// All four modules, in page order. sudoku.js registers first and so owns the
// opening tab, which is what makes "the share switched tabs" mean anything.
const SCRIPTS = ["shell.js", "sudoku.js", "queens.js", "killer.js", "pwa.js"];

const cells = () => Array.from({ length: 81 }, () => ({ value: null, pencil_marks: [] }));
const cage = (sum, coords) => ({ sum, cells: coords.map(([r, c]) => ({ r, c })) });

const KILLER_REPLY = {
  kind: "killer",
  ok: true,
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
 * @param {string} state  the ?shared= marker sw.js redirects with
 * @param {object} opts   stashed:false to mimic a cache that lost the file
 */
async function share(state, { reply = KILLER_REPLY, stashed = true } = {}) {
  const deleted = [];
  const posted = [];
  const ui = await boot({
    scripts: SCRIPTS,
    url: `http://localhost/?shared=${state}`,
    fetch: async (url, options) => {
      posted.push({ url, body: options?.body });
      return { ok: true, status: 200, json: async () => reply };
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
  return { ui, deleted, posted };
}

describe("android share target", () => {
  describe("a shared killer screenshot", () => {
    let ui, deleted, posted;
    before(async () => ({ ui, deleted, posted } = await share("1")));

    it("is sent to the endpoint that works out which puzzle it is", () => {
      assert.equal(posted.length, 1);
      assert.equal(posted[0].url, "/share/parse");
      assert.equal(posted[0].body.get("image").type, "image/png",
                   "the stashed blob is rebuilt as a file the reader can take");
    });

    it("brings the tab the screenshot belongs to to the front", () => {
      // sudoku.js registered first, so this is a switch, not a coincidence.
      assert.equal(ui.panel.hidden, false);
      assert.equal(ui.document.querySelector('[data-tab-panel="sudoku"]').hidden, true);
      assert.ok(ui.document.querySelector('.tab[data-tab-id="killer"]').classList.contains("active"));
    });

    it("loads the board through the same path a dropped file takes", () => {
      assert.equal(ui.board.querySelectorAll(".kcell:not(.uncaged)").length, 4);
      assert.equal(ui.board.querySelectorAll(".cage-sum").length, 2);
      assert.match(ui.document.getElementById("kDropStatus").textContent, /Read 2 cages/);
    });

    it("still reports what the reader was unhappy about", () => {
      // The share path must not quietly swallow the warnings the drop path
      // gives: this reading left cells out of every cage.
      assert.match(ui.document.getElementById("kDropStatus").textContent,
                   /aren't in a cage/);
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

  describe("a shared classic screenshot", () => {
    it("goes to the sudoku tab instead", async () => {
      const board = { cells: cells().map((c) => ({ ...c, low_confidence: false })) };
      const { ui } = await share("1", { reply: { kind: "sudoku", ok: true, board } });

      assert.equal(ui.document.querySelector('[data-tab-panel="sudoku"]').hidden, false);
      assert.equal(ui.panel.hidden, true, "the killer tab stays out of the way");
      assert.match(ui.document.getElementById("dropStatus").textContent, /Read board/);
    });
  });

  describe("when the handoff breaks down", () => {
    it("says so if the share carried no image", async () => {
      const { ui, posted } = await share("error");
      assert.match(ui.document.getElementById("kDropStatus").textContent, /didn't contain an image/);
      assert.equal(posted.length, 0, "nothing to send");
    });

    it("says so if the stash lost the file", async () => {
      const { ui, posted } = await share("1", { stashed: false });
      assert.match(ui.document.getElementById("kDropStatus").textContent, /went missing/);
      assert.equal(posted.length, 0);
    });

    it("leaves an ordinary visit completely alone", async () => {
      const ui = await boot({ scripts: SCRIPTS, url: "http://localhost/" });
      await ui.flush();
      assert.equal(ui.document.getElementById("kDropStatus").textContent, "");
      assert.equal(ui.document.querySelector('[data-tab-panel="sudoku"]').hidden, false);
    });
  });
});
