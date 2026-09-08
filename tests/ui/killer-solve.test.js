// The Killer tab's Solve button, driven end to end.
//
// Solve runs the ported engine (web/sudoku/model.ts, web/sudoku/solver.ts) in
// the page, cage-sum propagation and all — see issue #21. The board comes from
// a real read of a real screenshot; `fetch` is allowed for that read alone and
// counted, so a regression that routes Solve back through the network fails
// here rather than passing by coincidence.

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
  let ui, calls;
  const shownValues = () =>
    Array.from({ length: 81 }, (_, i) => {
      const el = ui.board.children[i].querySelector(".val");
      return el ? Number(el.textContent) : 0;
    });

  before(async () => {
    calls = [];
    ui = await boot({
      fetch: async (url) => {
        calls.push(url);
        return {
          ok: true,
          json: async () => ({
            board: BOARD,
            unsure: [],
            fully_caged: true,
            checksum_ok: true,
            sum_total: 405,
            needs_review: false,
          }),
        };
      },
      setUp(window) {
        window.FormData = class {
          append() {}
        };
        Object.defineProperty(window.document.getElementById("kFile"), "files", {
          value: [{ name: "board3.png" }],
        });
      },
    });
    ui.fire(ui.inPanel("#kFile"), "change");
    await ui.flush();
    ui.fire(ui.inPanel("#kSolve"), "click");
  });

  it("fills every cell, without a further network request", () => {
    assert.equal(ui.inPanel("#kResult").textContent, "Solved.");
    assert.ok(shownValues().every((v) => v >= 1 && v <= 9));
    assert.deepEqual(calls, ["/killer/parse"], "solving must not touch the network");
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
