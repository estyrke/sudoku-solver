// The Queens tab's Get hint and Solve buttons, driven end to end.
//
// Like tests/ui/sudoku-hint.test.js, this runs the real ported engine
// (web/queens/) through the real page — the only way to catch "the engine was
// right but the page dropped it" now that there is no endpoint in between.
// `fetch` is stubbed to blow up, so a regression that routes Queens hinting or
// solving back through the network fails loudly rather than passing by
// coincidence.

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { boot } = require("./harness");

// A 4x4 board split into four 2x2 quadrant regions, the layout the engine tests
// use. Its one non-attacking placement is r1c2, r2c4, r3c1, r4c3.
const QUADRANTS = [
  [0, 0, 1, 1],
  [0, 0, 1, 1],
  [2, 2, 3, 3],
  [2, 2, 3, 3],
];
const SOLUTION = [[0, 1], [1, 3], [2, 0], [3, 2]];

describe("queens hint and solve", () => {
  let ui, panel, board, calls;

  const cellAt = (r, c) => board.querySelector(`.qcell[data-r="${r}"][data-c="${c}"]`);
  const click = (selector) => ui.fire(panel.querySelector(selector), "click");
  const shown = () => panel.querySelector("#qHint").textContent;
  const revealTo = (level) =>
    ui.fire(panel.querySelector(`#qReveal [data-level="${level}"]`), "click");
  const queens = () => board.querySelectorAll(".qmark.queen").length;
  const placeQueen = (r, c) => ui.fire(cellAt(r, c), "dblclick");

  /** Palette swatches, minus the cursor tool and the "+" button. */
  const regionSwatches = () =>
    [...panel.querySelectorAll("#qPalette .swatch")].filter(
      (el) => !el.classList.contains("cursor") && !el.classList.contains("add"),
    );

  /** Size the board to 4x4 and paint QUADRANTS onto it. */
  const paintQuadrants = () => {
    const size = panel.querySelector("#qSize");
    size.value = "4";
    size.dispatchEvent(new ui.window.Event("input", { bubbles: true }));
    click("#qNew");

    for (let region = 0; region < 4; region++) {
      const swatches = regionSwatches();
      // Region 0 has a swatch from the start; the rest are added on demand, and
      // adding one also selects it.
      if (region < swatches.length) ui.fire(swatches[region], "click");
      else click("#qPalette .swatch.add");

      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          if (QUADRANTS[r][c] === region) ui.fire(cellAt(r, c), "mousedown");
        }
      }
      ui.fireOnDocument("mouseup");
    }
    // Back to the mark/queen tool, so clicks place rather than paint.
    ui.fire(panel.querySelector("#qPalette .swatch.cursor"), "click");
  };

  before(async () => {
    calls = [];
    ui = await boot({
      activate: "queens",
      fetch: async (...args) => {
        calls.push(args);
        throw new Error("Queens must not touch the network");
      },
    });
    panel = ui.document.querySelector('[data-tab-panel="queens"]');
    board = ui.document.getElementById("qBoard");
  });

  beforeEach(() => {
    click("#qClear");
    calls.length = 0;
  });

  it("hints without a network request", () => {
    paintQuadrants();
    placeQueen(0, 1);
    click("#qGetHint");

    assert.equal(calls.length, 0, "getting a hint made a network request");
    assert.equal(panel.querySelector("#qReveal").hidden, false);
    // With r1c2 taken, row 2 is down to its last live cell.
    assert.match(shown(), /Look at row 2\./);
  });

  it("walks the reveal ladder: nudge, technique, then the full argument", () => {
    paintQuadrants();
    placeQueen(0, 1);
    click("#qGetHint");

    assert.doesNotMatch(shown(), /Forced placement/, "the technique is level 2's to give away");
    assert.equal(board.querySelectorAll(".qcell.target").length, 0);

    revealTo(2);
    assert.match(shown(), /Forced placement/);
    assert.doesNotMatch(shown(), /must go there/, "the argument is level 3's");

    revealTo(3);
    assert.match(
      shown(),
      /In row 2, r2c4 is the only cell left that can hold a queen, so the queen must go there\./,
    );
    assert.ok(cellAt(1, 3).classList.contains("target"));
  });

  it("applies a placement to the board", () => {
    paintQuadrants();
    placeQueen(0, 1);
    click("#qGetHint");
    click("#qApply");

    assert.ok(cellAt(1, 3).querySelector(".qmark.queen"));
    assert.equal(shown(), "No hint yet.");
    assert.ok(panel.querySelector("#qReveal").hidden);
  });

  it("reports an invalid board in the same words as the old endpoint", () => {
    paintQuadrants();
    placeQueen(0, 0);
    placeQueen(0, 2); // two queens in row 1
    click("#qGetHint");

    assert.equal(
      shown(),
      "The board is invalid — two queens share a row, column, " +
        "or region, or sit adjacent to each other.",
    );
    assert.ok(panel.querySelector("#qReveal").hidden);
  });

  it("congratulates an already-solved board", () => {
    paintQuadrants();
    for (const [r, c] of SOLUTION) placeQueen(r, c);
    click("#qGetHint");

    assert.equal(shown(), "This board is already solved. 🎉");
  });

  it("says so honestly when nothing implemented applies", () => {
    // A wide-open painted board: valid, unsolved, and every unit still has four
    // live cells, so no technique can bite.
    paintQuadrants();
    click("#qGetHint");

    assert.equal(
      shown(),
      "No technique in the current set applies. The board may need a " +
        "more advanced strategy than is implemented yet.",
    );
    assert.ok(panel.querySelector("#qReveal").hidden);
  });

  it("solves in the page, without a network request", () => {
    paintQuadrants();
    click("#qSolve");

    assert.equal(calls.length, 0, "solving made a network request");
    assert.equal(panel.querySelector("#qResult").textContent, "Solved!");
    assert.equal(queens(), 4);
    for (const [r, c] of SOLUTION) {
      assert.ok(cellAt(r, c).querySelector(".qmark.queen"), `expected a queen at r${r + 1}c${c + 1}`);
    }
  });

  it("reports an unsolvable board", () => {
    paintQuadrants();
    placeQueen(0, 0);
    placeQueen(1, 1); // two queens in region 0 — no completion exists
    click("#qSolve");

    assert.equal(panel.querySelector("#qResult").textContent, "No solution exists for this board.");
  });

  it("works at a size other than the default", () => {
    const size = panel.querySelector("#qSize");
    size.value = "6";
    size.dispatchEvent(new ui.window.Event("input", { bubbles: true }));
    click("#qNew");

    assert.equal(board.querySelectorAll(".qcell").length, 36);
    click("#qSolve");

    // An unpainted 6x6 still has the row/column and adjacency rules to satisfy.
    assert.equal(panel.querySelector("#qResult").textContent, "Solved!");
    assert.equal(queens(), 6);
  });
});
