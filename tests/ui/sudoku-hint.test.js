// The classic Sudoku tab's Get hint button, driven end to end.
//
// Unlike tests/ui/hint-reveal.test.js — which stubs the reply because it is
// about presentation of a fixed hint — this file runs the real ported engine
// through the real page, which is the only way to catch "the engine was right
// but the page dropped it" now that there is no endpoint in between. `fetch` is
// stubbed to blow up, so a regression that routes hinting back through the
// network fails loudly rather than passing by coincidence.

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { boot } = require("./harness");

// r5c5 has one candidate left, 5: a naked single, and the first hint this
// board offers. Which technique fires first is the escalation order speaking,
// and tests/engine/techniques.test.ts pins that order.
const PUZZLE = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLVED = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

describe("sudoku hint", () => {
  let ui, panel, board, calls;

  const cellAt = (r, c) => board.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  const digitBtn = (d) => panel.querySelector(`#numpad [data-digit="${d}"]`);
  const click = (selector) => ui.fire(panel.querySelector(selector), "click");
  const enter = (r, c, d) => {
    ui.fire(cellAt(r, c), "click");
    ui.fire(digitBtn(d), "click");
  };
  const fill = (digits) => {
    for (let i = 0; i < 81; i++) {
      const d = Number(digits[i]);
      if (d) enter(Math.floor(i / 9), i % 9, d);
    }
  };
  const shown = () => panel.querySelector("#hint").textContent;
  const revealTo = (level) =>
    ui.fire(panel.querySelector(`#reveal [data-level="${level}"]`), "click");
  const targets = () => board.querySelectorAll(".cell.target").length;

  before(async () => {
    calls = [];
    ui = await boot({
      scripts: ["shell.js", "sudoku.js"],
      fetch: async (...args) => {
        calls.push(args);
        throw new Error("Hinting must not touch the network");
      },
    });
    panel = ui.document.querySelector('[data-tab-panel="sudoku"]');
    board = ui.document.getElementById("board");
  });

  beforeEach(() => click("#clear"));

  it("hints without a network request", () => {
    fill(PUZZLE);
    click("#getHint");

    assert.equal(calls.length, 0, "getting a hint made a network request");
    assert.equal(panel.querySelector("#reveal").hidden, false);
    assert.match(shown(), /Look at r5c5\./);
  });

  it("walks the reveal ladder: nudge, technique, then the full argument", () => {
    fill(PUZZLE);
    click("#getHint");

    assert.doesNotMatch(shown(), /Naked single/, "the technique is level 2's to give away");
    assert.equal(targets(), 0, "pointing at the cell would give away the nudge");

    revealTo(2);
    assert.match(shown(), /Naked single/);
    assert.doesNotMatch(shown(), /must go there/, "the argument is level 3's");

    revealTo(3);
    assert.match(shown(), /r5c5 has only one remaining candidate, 5, so it must go there\./);
    assert.ok(cellAt(4, 4).classList.contains("target"));
    assert.equal(targets(), 1);
  });

  it("applies a placement to the board", () => {
    fill(PUZZLE);
    click("#getHint");
    click("#apply");

    assert.equal(cellAt(4, 4).querySelector(".val").textContent, "5");
    assert.equal(shown(), "No hint yet.");
    assert.ok(panel.querySelector("#reveal").hidden);
  });

  it("applies an elimination to the player's pencil marks", () => {
    // A stale mark is the simplest hint of all, and the one whose Apply step
    // touches marks rather than a value: r1c3 cannot be a 5, r1c1 holds one.
    fill(PUZZLE);
    ui.fire(panel.querySelector('[data-mode="pencil"]'), "click");
    ui.fire(cellAt(0, 2), "click");
    for (const d of [4, 5]) ui.fire(digitBtn(d), "click");
    assert.equal(cellAt(0, 2).querySelector(".marks").textContent, "45");

    click("#getHint");
    revealTo(3);
    assert.match(shown(), /Impossible pencil mark|is already in r1c1/);

    click("#apply");
    assert.equal(cellAt(0, 2).querySelector(".marks").textContent, "4");
    ui.fire(panel.querySelector('[data-mode="pen"]'), "click");
  });

  it("reports an invalid board in the same words as the old endpoint", () => {
    enter(0, 0, 5);
    enter(0, 1, 5);
    click("#getHint");

    assert.equal(shown(), "The board is invalid — a digit repeats in a unit.");
    assert.ok(panel.querySelector("#reveal").hidden);
  });

  it("congratulates an already-solved board", () => {
    fill(SOLVED);
    click("#getHint");

    assert.equal(shown(), "This board is already solved. 🎉");
  });

  it("says so honestly when nothing implemented applies", () => {
    // An empty board is valid, unsolved, and gives every technique nothing to
    // bite on: every cell holds all nine candidates.
    click("#getHint");

    assert.equal(
      shown(),
      "No technique in the current set applies. The board may need a " +
        "more advanced strategy than is implemented yet."
    );
    assert.ok(panel.querySelector("#reveal").hidden);
  });
});
