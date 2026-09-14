// The Killer tab's Solve button, driven end to end.
//
// Solve runs the ported engine (web/sudoku/model.ts, web/sudoku/solver.ts) in
// the page, cage-sum propagation and all — see issue #21. The board is a
// pinned reading (tests/fixtures/killer_boards — see tests/reader/) handed to
// the tab through the same `acceptShared` entry point a shared screenshot uses
// (web/pwa.ts); the reading itself is what tests/reader/killer-board.test.ts
// covers, and jsdom has no image decoder to run the drop path end to end.
// `fetch` throws, so a regression that routes Solve back through the network
// fails here rather than passing by coincidence.

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { boot, ROOT } = require("./harness");

const BOARD = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "tests/fixtures/killer_boards/puzzle_page_killer_board3.json"),
    "utf8",
  ),
);

describe("killer solve", () => {
  let ui;
  const shownValues = () =>
    Array.from({ length: 81 }, (_, i) => {
      const el = ui.board.children[i].querySelector(".val");
      return el ? Number(el.textContent) : 0;
    });

  before(async () => {
    ui = await boot({
      fetch: async () => {
        throw new Error("Killer solve must not touch the network");
      },
    });
    ui.window.PuzzleShell.get("killer").acceptShared(
      new ui.window.File([], "board3.png", { type: "image/png" }),
      {
        board: BOARD,
        unsure: [],
        fully_caged: true,
        checksum_ok: true,
        sum_total: 405,
        needs_review: false,
      },
    );
    await ui.flush();
    ui.fire(ui.inPanel("#kSolve"), "click");
  });

  it("fills every cell, without touching the network", () => {
    assert.equal(ui.inPanel("#kResult").textContent, "Solved.");
    assert.ok(shownValues().every((v) => v >= 1 && v <= 9));
  });

  it("satisfies every cage sum", () => {
    const values = shownValues();
    for (const cage of BOARD.cages) {
      const total = cage.cells.reduce((n, { r, c }) => n + values[r * 9 + c], 0);
      assert.equal(total, cage.sum, `the ${cage.sum}-cage totals ${total}`);
    }
  });

  it("keeps every digit the board already had", () => {
    const values = shownValues();
    BOARD.cells.forEach((cell, i) => {
      if (cell.value !== null) assert.equal(values[i], cell.value, `cell ${i} moved`);
    });
  });
});
