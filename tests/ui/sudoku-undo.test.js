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

  it("discards a stale Redo when a whole-board action replaces the board, but is itself undoable", () => {
    // Solve, Clear board and screenshot import each replace every Cell as a
    // single Edit of their own (issue #50). The History predating one must
    // still not survive it: an Edit left ahead of the cursor points at the
    // board that call just replaced, and redoing it would silently splice a
    // stale value onto whatever replaced it. But the replacement itself is
    // now on the History, so it is one Undo away rather than the last word.
    enter(7, 7, 4);
    click("#undo");
    assert.equal(redoDisabled(), false, "there is an Edit ahead of the cursor to redo");

    click("#clear");

    assert.equal(redoDisabled(), true, "the stale Edit must not survive a whole-board replacement");
    assert.equal(undoDisabled(), false, "Clear board is itself undoable");
    assert.equal(valueAt(7, 7), null);

    click("#undo"); // leave things as this test found them
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

  describe("bulk Edits: Solve, Clear board and screenshot import (issue #50)", () => {
    // A screenshot import lands through `applyParsed`, the function both the
    // drop zone and the share target call — see web/sudoku.tsx. Delivering it
    // through `PuzzleShell` here, the way pwa.ts hands a share to a tab (see
    // tests/ui/share-target.test.js), exercises exactly that shared path
    // without needing an image to decode.
    const boardIdx = (r, c) => r * 9 + c;
    const importBoard = (patches) => {
      const cells = Array.from({ length: 81 }, () => ({ value: null, pencil_marks: [] }));
      for (const [i, patch] of patches) cells[i] = { ...cells[i], ...patch };
      ui.window.PuzzleShell.get("sudoku").acceptShared({ kind: "sudoku", board: { cells } });
    };
    const isGiven = (r, c) => cellAt(r, c).querySelector(".val")?.classList.contains("given") ?? false;

    beforeEach(() => {
      // A clean slate: undoing every Edit ever recorded replays every
      // `invert()` back to back, which lands exactly on the pristine empty
      // board the tab booted with.
      while (!undoDisabled()) click("#undo");
    });

    it("undoes and redoes Solve as one Edit, Pencil marks included", () => {
      enter(0, 0, 5);
      click('[data-mode="pencil"]');
      select(1, 1);
      ui.fire(digitBtn(7), "click");
      ui.fire(digitBtn(8), "click");
      click('[data-mode="pen"]');
      assert.equal(marksAt(1, 1), "78");

      click("#solve");
      assert.notEqual(valueAt(1, 1), null, "solving filled the Pencilled Cell in");
      assert.equal(undoDisabled(), false);

      click("#undo");
      assert.equal(valueAt(0, 0), "5", "the player's earlier entry came back");
      assert.equal(marksAt(1, 1), "78", "the Pencil marks Solve overwrote came back too");
      assert.equal(valueAt(1, 1), null, "Solve's placement in that Cell was undone");

      click("#redo");
      assert.notEqual(valueAt(1, 1), null, "Solve's placement came back");
      assert.equal(marksAt(1, 1), "", "Solve's redo cleared the marks again");
    });

    it("undoes and redoes Clear board as one Edit, values, Pencil marks and Givens included", () => {
      importBoard([[boardIdx(0, 0), { value: 5, is_given: true }]]);
      enter(0, 1, 3);
      click('[data-mode="pencil"]');
      select(0, 2);
      ui.fire(digitBtn(9), "click");
      click('[data-mode="pen"]');

      click("#clear");
      assert.equal(valueAt(0, 0), null);
      assert.equal(undoDisabled(), false);

      click("#undo");
      assert.equal(valueAt(0, 0), "5", "the Given came back");
      assert.equal(isGiven(0, 0), true, "and it is a Given again, not a player Cell");
      assert.equal(valueAt(0, 1), "3", "the player's entry came back");
      assert.equal(marksAt(0, 2), "9", "the Pencil mark came back");

      click("#redo");
      assert.equal(valueAt(0, 0), null);
      assert.equal(valueAt(0, 1), null);
      assert.equal(marksAt(0, 2), "");
    });

    it("undoes and redoes a screenshot import as one Edit, restoring prior Givens", () => {
      // Before the second import: r2c2 is a Given left by an earlier reading,
      // r2c3 is an ordinary player Cell.
      importBoard([[boardIdx(1, 1), { value: 4, is_given: true }]]);
      enter(1, 2, 6);

      // The second import — arriving from a drop or, on the same terms, the
      // Android share sheet — flips which of the two is the Given.
      importBoard([[boardIdx(1, 2), { value: 2, is_given: true }]]);
      assert.equal(valueAt(1, 1), null);
      assert.equal(valueAt(1, 2), "2");
      assert.equal(undoDisabled(), false);

      click("#undo");
      assert.equal(valueAt(1, 1), "4", "the board from before the second import came back");
      assert.equal(valueAt(1, 2), "6");
      assert.equal(isGiven(1, 1), true, "the earlier Given came back");
      assert.equal(isGiven(1, 2), false, "the earlier player Cell is not a Given");

      click("#redo");
      assert.equal(valueAt(1, 1), null, "the second import's board came back");
      assert.equal(valueAt(1, 2), "2");
      assert.equal(isGiven(1, 2), true);

      click("#undo"); // back to just after the first import

      // Editability, not just the rendered class: a Given cannot be typed
      // over, and a Cell that is editable again must accept a digit.
      select(1, 1);
      ui.fire(digitBtn(9), "click");
      assert.equal(valueAt(1, 1), "4", "still a Given — the digit press did nothing");
      select(1, 2);
      ui.fire(digitBtn(9), "click");
      assert.equal(valueAt(1, 2), "9", "a player Cell again — the digit press landed");
    });
  });

  it("made no network request throughout", () => {
    assert.equal(calls.length, 0);
  });
});
