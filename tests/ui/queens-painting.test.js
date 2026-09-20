// Painting Regions on the Queens board, driven through the real page.
//
// The board a player sees is the whole subject here: which cells carry which
// region colour, and *when* the paint reaches the board. A drag is one act of
// painting, committed on release (issue #48), so that it can later become one
// undoable Edit rather than one per cell the pointer happened to enter — and
// the only way to tell a pending paint from a committed one from outside is
// that a committed one clears the hint on display.

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { boot } = require("./harness");

const NO_HINT = "No hint yet.";

describe("queens region painting", () => {
  let ui, panel, board, calls;

  const cellAt = (r, c) => board.querySelector(`.qcell[data-r="${r}"][data-c="${c}"]`);
  const click = (selector) => ui.fire(panel.querySelector(selector), "click");
  const shown = () => panel.querySelector("#qHint").textContent;
  const paintOf = (r, c) => cellAt(r, c).style.background;

  /** Palette swatches, minus the cursor tool and the "+" button. */
  const regionSwatches = () =>
    [...panel.querySelectorAll("#qPalette .swatch")].filter(
      (el) => !el.classList.contains("cursor") && !el.classList.contains("add"),
    );

  /** Select region `id` for painting, adding swatches until it exists. */
  const useRegion = (id) => {
    while (regionSwatches().length <= id) click("#qPalette .swatch.add");
    ui.fire(regionSwatches()[id], "click");
  };

  /** The colour region `id` paints with, read off its own swatch. */
  const colorOf = (id) => regionSwatches()[id].style.background;

  const sizeTo = (size) => {
    const input = panel.querySelector("#qSize");
    input.value = String(size);
    input.dispatchEvent(new ui.window.Event("input", { bubbles: true }));
    click("#qNew");
  };

  /** Press on a cell, run the pointer over the rest, and release off the board. */
  const drag = ([head, ...rest]) => {
    ui.fire(cellAt(...head), "mousedown");
    for (const cell of rest) ui.fire(cellAt(...cell), "mouseenter");
    ui.fireOnDocument("mouseup");
  };

  before(async () => {
    calls = [];
    ui = await boot({
      activate: "queens",
      // Like tests/ui/queens-hint.test.js: nothing here may reach a host that
      // no longer exists, so a request fails loudly rather than silently.
      fetch: async (...args) => {
        calls.push(args);
        throw new Error("Queens must not touch the network");
      },
    });
    panel = ui.document.querySelector('[data-tab-panel="queens"]');
    board = ui.document.getElementById("qBoard");
  });

  // `#qNew` is a full reset, palette included, so it leaves nothing to clear.
  beforeEach(() => {
    sizeTo(4);
    calls.length = 0;
  });

  it("paints every cell a drag crosses", () => {
    useRegion(0);
    drag([[0, 0], [0, 1], [0, 2]]);

    for (const [r, c] of [[0, 0], [0, 1], [0, 2]]) {
      assert.equal(paintOf(r, c), colorOf(0), `expected r${r + 1}c${c + 1} painted`);
    }
    assert.equal(paintOf(0, 3), "", "the pointer never reached r1c4");
  });

  it("applies the paint once, on release, and not per cell entered", () => {
    // Any message in the hint panel will do: the point is that it survives
    // exactly as long as the board it was written about does.
    click("#qGetHint");
    const beforePainting = shown();
    assert.notEqual(beforePainting, NO_HINT, "expected the hint panel to say something");

    useRegion(0);
    ui.fire(cellAt(0, 0), "mousedown");
    ui.fire(cellAt(0, 1), "mouseenter");
    ui.fire(cellAt(0, 2), "mouseenter");

    // The cells follow the pointer, so the drag looks exactly as it always has…
    assert.equal(paintOf(0, 2), colorOf(0));
    // …but nothing has reached the board yet, so the hint still stands.
    assert.equal(shown(), beforePainting, "the paint was committed before the pointer came up");

    ui.fireOnDocument("mouseup");
    assert.equal(shown(), NO_HINT, "releasing the pointer should have changed the board");
    assert.equal(paintOf(0, 2), colorOf(0), "the paint should outlive the drag");
  });

  it("paints a single cell when the paint tool is only clicked", () => {
    useRegion(0);
    ui.fire(cellAt(2, 2), "mousedown");
    ui.fireOnDocument("mouseup");

    assert.equal(paintOf(2, 2), colorOf(0));
    assert.equal(paintOf(2, 1), "");
  });

  it("commits a drag released off the board", () => {
    useRegion(0);
    ui.fire(cellAt(1, 0), "mousedown");
    ui.fire(cellAt(1, 1), "mouseenter");
    // Released anywhere but a cell, the way Killer's cage drag is.
    ui.fire(ui.document.body, "mouseup");

    assert.equal(paintOf(1, 0), colorOf(0));
    assert.equal(paintOf(1, 1), colorOf(0));
  });

  it("repaints cells that already belong to a region", () => {
    useRegion(0);
    drag([[3, 0], [3, 1], [3, 2]]);

    // One drag, over cells region 0 already holds, doubling back over r4c2 —
    // the pointer wanders during a real paint and must not undo its own work.
    useRegion(1);
    drag([[3, 1], [3, 2], [3, 1]]);

    assert.equal(paintOf(3, 0), colorOf(0), "r4c1 was outside the second drag");
    assert.equal(paintOf(3, 1), colorOf(1));
    assert.equal(paintOf(3, 2), colorOf(1));
  });

  // A drag is only ever closed by a mouseup, and a pointer released outside the
  // window sends none — so an abandoned drag can still be open when the board it
  // addressed is replaced. Its cell indices then point into a board that is gone.
  describe("a drag abandoned outside the window", () => {
    /** Press on a cell and never release: the pointer left the window. */
    const pressAndLeave = (r, c) => {
      useRegion(0);
      ui.fire(cellAt(r, c), "mousedown");
    };

    it("does not survive Clear board", () => {
      pressAndLeave(2, 2);
      click("#qClear");

      assert.equal(paintOf(2, 2), "", "Clear board left the abandoned paint on the grid");
      ui.fireOnDocument("mouseup");
      assert.equal(paintOf(2, 2), "", "the abandoned paint landed on the cleared board");
    });

    it("does not wedge the board after a resize has moved out from under it", () => {
      sizeTo(8);
      pressAndLeave(7, 7); // r8c8 exists on the 8x8 and not on the 4x4
      sizeTo(4);

      // Committing the abandoned drag would reach for a cell that is gone, and
      // a throw here leaves it open — wedging every paint that follows.
      ui.fireOnDocument("mouseup");

      useRegion(0);
      drag([[0, 0], [0, 1]]);
      assert.equal(paintOf(0, 0), colorOf(0), "painting stopped working after the resize");
      assert.equal(paintOf(0, 1), colorOf(0));
    });
  });

  it("leaves the board alone when the cursor tool is the one in hand", () => {
    useRegion(0);
    click("#qPalette .swatch.cursor");
    drag([[0, 0], [0, 1]]);

    assert.equal(paintOf(0, 0), "");
    assert.equal(paintOf(0, 1), "");
  });
});
