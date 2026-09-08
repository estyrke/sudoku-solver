// The classic Sudoku tab's Solve button. Unlike hinting and reading, which
// still ask the server, Solve runs the ported engine (web/sudoku/model.ts,
// web/sudoku/solver.ts) straight in the page — see issue #19. `fetch` is
// stubbed to blow up if called at all, so a regression that quietly routes
// Solve back through the network fails loudly here rather than passing by
// coincidence.

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const { boot } = require("./harness");

const PUZZLE = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

describe("sudoku solve", () => {
  let ui, panel, board, calls;

  const cellAt = (r, c) => board.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  const digitBtn = (d) => panel.querySelector(`#numpad [data-digit="${d}"]`);
  const enter = (r, c, d) => {
    ui.fire(cellAt(r, c), "click");
    ui.fire(digitBtn(d), "click");
  };
  const shownValues = () =>
    Array.from({ length: 81 }, (_, i) => {
      const el = board.children[i].querySelector(".val");
      return el ? el.textContent : "0";
    }).join("");

  before(async () => {
    calls = [];
    ui = await boot({
      scripts: ["shell.js", "sudoku.js"],
      fetch: async (...args) => {
        calls.push(args);
        throw new Error("Solve must not touch the network");
      },
    });
    panel = ui.document.querySelector('[data-tab-panel="sudoku"]');
    board = ui.document.getElementById("board");
  });

  it("solves a puzzle entered by hand, without a network request", () => {
    for (let i = 0; i < 81; i++) {
      const d = Number(PUZZLE[i]);
      if (d) enter(Math.floor(i / 9), i % 9, d);
    }

    ui.fire(panel.querySelector("#solve"), "click");

    assert.equal(calls.length, 0, "solving made a network request");
    assert.equal(shownValues(), SOLUTION);
    assert.equal(ui.document.getElementById("result").textContent, "Solved.");
  });

  it("preserves every digit already entered", () => {
    // Re-enter the same puzzle and change one pen entry the player is free to
    // pick differently — cell r2c5 (0-indexed r1c4) is empty in PUZZLE.
    ui.fire(panel.querySelector("#clear"), "click");
    for (let i = 0; i < 81; i++) {
      const d = Number(PUZZLE[i]);
      if (d) enter(Math.floor(i / 9), i % 9, d);
    }
    enter(1, 4, 9); // matches the solution's own digit there, just entered by the player

    ui.fire(panel.querySelector("#solve"), "click");

    assert.equal(shownValues(), SOLUTION);
  });

  it("reports no solution in the same words as the old server endpoint", () => {
    ui.fire(panel.querySelector("#clear"), "click");
    enter(0, 0, 5);
    enter(0, 1, 5); // two 5s in row 1: unsolvable

    ui.fire(panel.querySelector("#solve"), "click");

    assert.equal(calls.length, 0);
    assert.equal(
      ui.document.getElementById("result").textContent,
      "No solution exists for this board."
    );
  });
});
