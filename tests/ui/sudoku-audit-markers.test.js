// The classic Sudoku tab's mistake audit, driven end to end (issue #59).
//
// killer.tsx has always audited the board before hinting; the Sudoku tab now
// does the same, on a cage-less board — the same `audit()` the Killer tab
// calls, run against the same `Board` this tab already builds for `isValid`.
// `fetch` is stubbed to blow up, so a regression that routes hinting back
// through the network fails here rather than passing by coincidence. See
// tests/ui/audit-markers.test.js for the Killer-tab tests this mirrors.

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { boot } = require("./harness");

// Same puzzle tests/ui/sudoku-hint.test.js hints from: one solution, and r1c3
// has two other legal-but-wrong candidates (1 and 2) besides its real digit
// (4), so entering one there is a mistake no unit-repeat check catches.
const PUZZLE = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";

// Easter Monster: one solution, and famously immune to everything short of
// chain logic — audits clean, but no technique in the catalogue starts on it.
// Moved here from tests/ui/audit-markers.test.js now that the Sudoku tab
// audits on its own terms, rather than needing a cage-less board routed
// through the Killer tab to exercise this message.
const EASTER_MONSTER =
  "100000002090400050006000700050903000000070000000850040700000600030009080002000001";

describe("sudoku audit markers", () => {
  let ui, panel, board;

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
  const marked = () => board.querySelectorAll(".cell.mistake").length;

  before(async () => {
    ui = await boot({
      activate: "sudoku",
      fetch: async () => {
        throw new Error("Sudoku auditing and hinting must not touch the network");
      },
    });
    panel = ui.document.querySelector('[data-tab-panel="sudoku"]');
    board = ui.document.getElementById("board");
  });

  beforeEach(() => click("#clear"));

  it("flags the cell the audit blames, instead of claiming no technique applies", () => {
    fill(PUZZLE);
    enter(0, 2, 1); // r1c3 is 4 in the solution; 1 is legal there but wrong

    click("#getHint");

    assert.match(shown(), /r1c3 is wrong/);
    assert.ok(panel.querySelector("#reveal").hidden, "a mistake has no staged reveal");
    assert.ok(cellAt(0, 2).classList.contains("mistake"));
    assert.equal(marked(), 1);
  });

  it("clears the marker as soon as the cell is edited", () => {
    fill(PUZZLE);
    enter(0, 2, 1);
    click("#getHint");
    assert.equal(marked(), 1);

    enter(0, 2, 1); // typing the same digit again clears the cell
    assert.equal(marked(), 0);
  });

  it("shows a real hint again once the mistake is behind it, never alongside it", () => {
    fill(PUZZLE);
    enter(0, 2, 1);
    click("#getHint");
    assert.equal(marked(), 1);

    enter(0, 2, 1); // back to empty
    click("#getHint");

    assert.equal(panel.querySelector("#reveal").hidden, false);
    assert.equal(marked(), 0, "a hint and a mistake marker must never show together");
  });

  it("does not treat a part-entered board as a mistake", () => {
    fill(PUZZLE); // just the givens: correct, but far from solved

    click("#getHint");

    assert.equal(marked(), 0);
    assert.equal(
      panel.querySelector("#reveal").hidden,
      false,
      "a part-entered board still gets a hint",
    );
  });

  it("reports the audit's message when Solve fails", () => {
    fill(PUZZLE);
    enter(0, 2, 1);

    click("#solve");

    assert.match(ui.document.getElementById("result").textContent, /r1c3 is wrong/);
  });

  it("says so plainly when the board is clean but nothing applies", () => {
    // The one case where "no hint" is the honest answer rather than a hidden
    // mistake — and, since Easter Monster is never pencilled here, the
    // player's (empty) marks trivially match what the catalogue itself
    // derives, so the audit can tell this apart from a rubbed-out mark it
    // can't account for (issue #60).
    fill(EASTER_MONSTER);

    click("#getHint");

    assert.match(shown(), /technique catalogue would derive on its own/);
    assert.match(shown(), /isn't implemented yet/);
    assert.ok(panel.querySelector("#reveal").hidden);
    assert.equal(marked(), 0);
  });

  it("hints a clean board exactly as it did before auditing landed", () => {
    fill(PUZZLE);

    click("#getHint");

    assert.equal(panel.querySelector("#reveal").hidden, false);
    assert.match(shown(), /Look at r5c5\./);
    assert.equal(marked(), 0);
  });
});
