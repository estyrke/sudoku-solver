// How the board shows what the audit found.
//
// A mistake is not a hint: it gets the message, the red cell outline and no
// reveal buttons, because there is nothing to reveal in stages. The marker has
// to be as easy to clear as it is to raise — one left behind on a cell the
// player has since fixed is worse than none at all.
//
// The audit and the hint engine both run in the page now, so there is no reply
// left to stub: the board is loaded from a real read of a real screenshot
// (tests/fixtures/killer_boards, produced by the Python reader) and every
// verdict below is the engine's own. `fetch` is allowed only for that load, and
// counted, so a regression that routes hinting back through the network fails
// here rather than passing by coincidence.

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { boot, ROOT } = require("./harness");

const fixture = (name) =>
  JSON.parse(
    fs.readFileSync(path.join(ROOT, "tests/fixtures/killer_boards", `${name}.json`), "utf8"),
  );

/** A /killer/parse reply carrying an already-read board. */
const reading = (board) => ({
  board,
  unsure: [],
  fully_caged: true,
  checksum_ok: true,
  sum_total: 405,
  needs_review: false,
});

/** A cage-less board from an 81-character puzzle string, in reader wire shape. */
const classic = (puzzle) => ({
  cells: [...puzzle].map((ch) => ({
    value: ch === "0" ? null : Number(ch),
    is_given: ch !== "0",
    pencil_marks: [],
    low_confidence: false,
  })),
  cages: [],
});

// Easter Monster: one solution, and famously immune to everything short of
// chain logic. Used below as a board the catalogue honestly cannot start on.
const EASTER_MONSTER = classic(
  "100000002090400050006000700050903000000070000000850040700000600030009080002000001",
);

// board3 is clean, fully caged and has exactly one solution: r1c1 is 6 and
// r5c5 is 3, so any other legal digit there is a mistake no rule catches — the
// board simply stops having an answer, which is what the audit is for.
const WRONG_AT_R1C1 = 3;
const WRONG_AT_R5C5 = 1;

describe("killer audit markers", () => {
  let ui;
  let calls;
  const marked = () => ui.board.querySelectorAll(".kcell.mistake").length;
  const getHint = () => ui.fire(ui.inPanel("#kGetHint"), "click");
  const enter = (r, c, d) => {
    ui.fire(ui.cellAt(r, c), "click");
    ui.fire(ui.digit(d), "click");
  };

  /** Drop a screenshot on the page and let the (stubbed) reader answer with
   * `board`. Everything after this point is the page's own engine. */
  const load = async () => {
    ui.fire(ui.inPanel("#kFile"), "change");
    await ui.flush();
    assert.equal(ui.inPanel("#kDropStatus").textContent.startsWith("Read 2"), true);
    ui.fire(ui.inPanel('[data-kmode="digits"]'), "click");
  };

  before(async () => {
    calls = [];
    let board = fixture("puzzle_page_killer_board3");
    ui = await boot({
      fetch: async (url) => {
        calls.push(url);
        return { ok: true, json: async () => reading(board) };
      },
      setUp(window) {
        // jsdom gives a file input no files; the page only ever passes the
        // first one straight to FormData, which the stub above ignores.
        window.FormData = class {
          append() {}
        };
        Object.defineProperty(window.document.getElementById("kFile"), "files", {
          value: [{ name: "board3.png" }],
        });
      },
    });
    await load();
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

  it("says so plainly when the board is clean but nothing applies", async () => {
    // The one case where "no hint" is the honest answer rather than a hidden
    // mistake. This used to be one of the Killer fixtures, until the catalogue
    // learned to enumerate cage and 45-rule combinations and started solving all
    // of them outright. A cage-less classic stands in instead: Easter Monster
    // has one solution, audits clean, and needs chain logic that nothing in
    // TECHNIQUES attempts — and no amount of further Killer work will change
    // that, which a fixture with cages on it could not promise.
    ui.window.fetch = async (url) => {
      calls.push(url);
      return { ok: true, json: async () => reading(EASTER_MONSTER) };
    };
    ui.fire(ui.inPanel('[data-kmode="cages"]'), "click");
    ui.fire(ui.inPanel("#kFile"), "change");
    await ui.flush();
    assert.match(ui.inPanel("#kDropStatus").textContent, /^Read 0 cages\./);
    ui.fire(ui.inPanel('[data-kmode="digits"]'), "click");
    getHint();

    assert.match(ui.hintEl.textContent, /needs a technique that isn't implemented yet/);
    assert.ok(ui.revealEl.hidden);
    assert.equal(marked(), 0);
  });

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

  it("asked the network for nothing but the screenshot", () => {
    assert.deepEqual(calls, ["/killer/parse", "/killer/parse"]);
  });
});
