// The classic Sudoku tab's Undo/Redo, driven end to end through the real page
// (issue #49). Entering a digit, toggling a Pencil mark and clearing a Cell
// are each meant to be a single undoable Edit — this is the tracer bullet for
// the whole undo/redo feature, so what it pins down here is the shape every
// later tab and every bulk Edit follows: one act, one Edit, one keystroke or
// button press to take it back.

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { boot } = require("./harness");

describe("sudoku undo/redo", () => {
  let ui, panel, board, calls;

  const cellAt = (r, c) => board.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  const digitBtn = (d) => panel.querySelector(`#numpad [data-digit="${d}"]`);
  const click = (selector) => ui.fire(panel.querySelector(selector), "click");
  const select = (r, c) => ui.fire(cellAt(r, c), "click");
  const enter = (r, c, d) => {
    select(r, c);
    ui.fire(digitBtn(d), "click");
  };
  const valueAt = (r, c) => cellAt(r, c).querySelector(".val")?.textContent ?? null;
  const marksAt = (r, c) => cellAt(r, c).querySelector(".marks")?.textContent ?? "";
  const isSelected = (r, c) => cellAt(r, c).classList.contains("sel");
  const undoDisabled = () => panel.querySelector("#undo").disabled;
  const redoDisabled = () => panel.querySelector("#redo").disabled;
  const shownHint = () => panel.querySelector("#hint").textContent;

  /** Dispatch the undo/redo shortcut at the board, the way a real keydown
   *  arrives once a cell click has focused it (see `select` in sudoku.tsx). */
  const pressUndoRedo = (redo) =>
    board.dispatchEvent(
      new ui.window.KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        shiftKey: redo,
        bubbles: true,
        cancelable: true,
      }),
    );

  before(async () => {
    calls = [];
    ui = await boot({
      activate: "sudoku",
      fetch: async (...args) => {
        calls.push(args);
        throw new Error("Undo/redo must not touch the network");
      },
    });
    panel = ui.document.querySelector('[data-tab-panel="sudoku"]');
    board = ui.document.getElementById("board");
  });

  it("starts with nothing to undo or redo", () => {
    assert.equal(undoDisabled(), true);
    assert.equal(redoDisabled(), true);
  });

  it("undoes and redoes a single digit entry", () => {
    enter(0, 0, 7);
    assert.equal(valueAt(0, 0), "7");
    assert.equal(undoDisabled(), false);
    assert.equal(redoDisabled(), true);

    click("#undo");
    assert.equal(valueAt(0, 0), null, "the digit was taken back");
    assert.equal(isSelected(0, 0), true, "the selection followed the undo");
    assert.equal(undoDisabled(), true, "that was the only Edit");
    assert.equal(redoDisabled(), false);

    click("#redo");
    assert.equal(valueAt(0, 0), "7", "the digit came back");
    assert.equal(redoDisabled(), true);
  });

  it("undoes and redoes a Pencil mark toggle without touching Pen/Pencil mode", () => {
    click('[data-mode="pencil"]');
    select(1, 1);
    ui.fire(digitBtn(3), "click");
    ui.fire(digitBtn(4), "click");
    assert.equal(marksAt(1, 1), "34");

    click("#undo");
    assert.equal(marksAt(1, 1), "3", "only the second toggle was undone");
    assert.ok(
      panel.querySelector('[data-mode="pencil"]').classList.contains("active"),
      "undo must not flip the player's tool back to Pen",
    );

    click("#undo");
    assert.equal(marksAt(1, 1), "");

    click("#redo");
    click("#redo");
    assert.equal(marksAt(1, 1), "34");
    click('[data-mode="pen"]');
  });

  it("undoes and redoes clearing a Cell", () => {
    enter(2, 2, 9);
    click("#numClear");
    assert.equal(valueAt(2, 2), null);

    click("#undo");
    assert.equal(valueAt(2, 2), "9", "the cleared digit came back");

    click("#redo");
    assert.equal(valueAt(2, 2), null);
    click("#undo"); // leave the cell as it was found
    click("#undo");
  });

  it("does not record an Edit for a change that leaves the Cell as it was", () => {
    select(3, 3);
    click("#numClear"); // already empty: nothing for this to take back

    click("#undo");
    assert.equal(marksAt(1, 1), "3", "undo skipped past the no-op straight to the last real Edit");
    click("#redo");
  });

  describe("keyboard shortcuts", () => {
    beforeEach(() => {
      // A clean slate: undo everything this tab's earlier tests left behind.
      while (!undoDisabled()) click("#undo");
    });

    it("Ctrl+Z undoes and Ctrl+Shift+Z redoes", () => {
      enter(4, 4, 5);
      assert.equal(valueAt(4, 4), "5");

      pressUndoRedo(false);
      assert.equal(valueAt(4, 4), null);

      pressUndoRedo(true);
      assert.equal(valueAt(4, 4), "5");
      click("#undo");
    });

    it("does not fire while another tab is in front", () => {
      enter(4, 4, 6);
      ui.fire(ui.document.querySelector('[data-tab-id="killer"]'), "click");

      pressUndoRedo(false);
      ui.fire(ui.document.querySelector('[data-tab-id="sudoku"]'), "click");

      assert.equal(valueAt(4, 4), "6", "the shortcut reached the tab behind the front one");
      click("#undo");
    });
  });

  it("discards the forward tail once a new Edit is made mid-History", () => {
    enter(5, 5, 1);
    enter(5, 5, 2);
    click("#undo"); // cursor now sits between the two Edits, r6c6 == 1
    assert.equal(valueAt(5, 5), "1");
    assert.equal(redoDisabled(), false);

    enter(6, 6, 3); // a new Edit made mid-History
    assert.equal(redoDisabled(), true, "the discarded Edit can no longer be redone");

    click("#undo");
    assert.equal(valueAt(6, 6), null);
    click("#undo");
    assert.equal(valueAt(5, 5), null);
  });

  it("drops a stale Redo (and Undo) when a whole-board action replaces the board", () => {
    // Solve, Clear board and screenshot import replace every Cell at once and
    // are not Edits of their own yet (issue #50) — but the History predating
    // one must not survive it: an Edit left ahead of the cursor still points
    // at the board that call just threw away, and redoing it would silently
    // splice a stale value onto whatever replaced it.
    enter(7, 7, 4);
    click("#undo");
    assert.equal(redoDisabled(), false, "there is an Edit ahead of the cursor to redo");

    click("#clear");

    assert.equal(redoDisabled(), true, "the stale Edit must not survive a whole-board replacement");
    assert.equal(undoDisabled(), true);
    assert.equal(valueAt(7, 7), null);
  });

  it("clears a displayed Hint on undo and on redo", () => {
    enter(0, 1, 8);
    click("#getHint");
    const beforeUndo = shownHint();
    assert.notEqual(beforeUndo, "No hint yet.");

    click("#undo");
    assert.equal(shownHint(), "No hint yet.", "undo should have cleared the hint");

    click("#getHint");
    assert.notEqual(shownHint(), "No hint yet.");
    click("#redo");
    assert.equal(shownHint(), "No hint yet.", "redo should have cleared the hint");
    click("#undo");
  });

  it("made no network request throughout", () => {
    assert.equal(calls.length, 0);
  });
});
