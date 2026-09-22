// How the board shows what the audit found.
//
// A mistake is not a hint: it gets the message, the red cell outline and no
// reveal buttons, because there is nothing to reveal in stages. The marker has
// to be as easy to clear as it is to raise — one left behind on a cell the
// player has since fixed is worse than none at all.
//
// The audit and the hint engine both run in the page now, so there is no reply
// left to stub: the board is one the reader has already read (tests/fixtures/
// killer_boards, pinned against the Python reader — see tests/reader/) and
// every verdict below is the engine's own. It is loaded through the same
// `acceptShared` entry point a shared screenshot uses (web/pwa.ts), which
// hands the tab an already-parsed reading directly — the reading itself is
// what tests/reader/killer-board.test.ts covers, and jsdom has no image
// decoder to run the drop path end to end. `fetch` throws, so a regression
// that routes hinting back through the network fails here rather than passing
// by coincidence.

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { boot, ROOT } = require("./harness");

const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(ROOT, "tests/fixtures/killer_boards", `${name}.json`), "utf8"),
  );

/** An already-parsed reading, the shape `acceptShared` and the old
 *  /killer/parse reply both carry. */
const reading = (board) => ({
  board,
  unsure: [],
  fully_caged: true,
  checksum_ok: true,
  sum_total: 405,
  needs_review: false,
});

// board3 is clean, fully caged and has exactly one solution: r1c1 is 6 and
// r5c5 is 3, so any other legal digit there is a mistake no rule catches — the
// board simply stops having an answer, which is what the audit is for.
const WRONG_AT_R1C1 = 3;
const WRONG_AT_R5C5 = 1;

describe("killer audit markers", () => {
  let ui;
  const marked = () => ui.board.querySelectorAll(".kcell.mistake").length;
  const getHint = () => ui.fire(ui.inPanel("#kGetHint"), "click");
  const enter = (r, c, d) => {
    ui.fire(ui.cellAt(r, c), "click");
    ui.fire(ui.digit(d), "click");
  };

  /** Hand the tab an already-read `board`, the way a shared screenshot does,
   * and let the page's own engine take it from there. */
  const load = async (board) => {
    ui.window.PuzzleShell.get("killer").acceptShared(reading(board));
    await ui.flush();
    assert.equal(ui.inPanel("#kDropStatus").textContent.startsWith("Read 2"), true);
    ui.fire(ui.inPanel('[data-kmode="digits"]'), "click");
  };

  before(async () => {
    ui = await boot({
      fetch: async () => {
        throw new Error("Killer auditing and hinting must not touch the network");
      },
    });
    await load(fixture("puzzle_page_killer_board3"));
  });

  it("flags the cell the audit blames", () => {
    enter(0, 0, WRONG_AT_R1C1);
    getHint();

    assert.match(ui.hintEl.textContent, /r1c1 is wrong/);
    assert.ok(ui.revealEl.hidden, "a mistake has no staged reveal");
    assert.ok(ui.cellAt(0, 0).classList.contains("mistake"));
    assert.equal(marked(), 1);
  });

  it("moves the marker when a later audit blames a different cell", () => {
    enter(0, 0, WRONG_AT_R1C1); // typing the same digit again clears the cell
    enter(4, 4, WRONG_AT_R5C5);
    getHint();

    assert.match(ui.hintEl.textContent, /r5c5 is wrong/);
    assert.ok(ui.cellAt(4, 4).classList.contains("mistake"));
    assert.ok(!ui.cellAt(0, 0).classList.contains("mistake"), "the stale marker is gone");
    assert.equal(marked(), 1);
  });

  it("clears the marker as soon as the cell is edited", () => {
    enter(4, 4, 7);
    assert.equal(marked(), 0);
  });

  it("shows a real hint again once the mistake is behind it", () => {
    enter(4, 4, 7); // back to empty
    getHint();

    assert.equal(ui.revealEl.hidden, false);
    assert.match(ui.hintEl.textContent, /Look at the 9-cage at r3c7/);
    assert.equal(marked(), 0, "a hint and a mistake marker must never show together");
  });

  // "says so plainly when the board is clean but nothing applies" used to live
  // here, driving a cage-less classic board through this tab because the
  // Killer tab was the only one that audited. Now that the Sudoku tab audits
  // on its own terms (issue #59), that case has a proper home in
  // tests/ui/sudoku-audit-markers.test.js instead.

  it("does not treat a board still being drawn as a mistake", () => {
    // Half-drawn cages make every verdict an artefact of the ones not there
    // yet, so the audit declines to have an opinion — and a board being entered
    // must still be able to ask for a hint rather than meet a running stream of
    // complaints.
    ui.fire(ui.inPanel("#kClear"), "click");
    ui.fire(ui.inPanel('[data-kmode="cages"]'), "click");
    ui.window.prompt = () => "4";
    ui.fire(ui.cellAt(0, 0), "mousedown");
    ui.fire(ui.cellAt(0, 1), "mouseover");
    ui.fireOnDocument("mouseup");

    getHint();

    assert.equal(marked(), 0);
    assert.equal(ui.revealEl.hidden, false, "a part-caged board still gets a hint");
    assert.match(ui.hintEl.textContent, /Look at the 4-cage at r1c1/);
  });
});
