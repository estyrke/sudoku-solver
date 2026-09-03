// Drawing, editing and deleting cages on the Killer board.
//
// The cases run in order against one mounted page and build on each other's
// state, the way a player's session does.

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const { boot } = require("./harness");

describe("killer cage editing", () => {
  let ui;
  const caged = () => ui.board.querySelectorAll(".kcell:not(.uncaged)").length;
  const uncaged = () => ui.board.querySelectorAll(".kcell.uncaged").length;

  /** Drag across `cells`, answering the sum prompt with `sum`. */
  const drawCage = (sum, cells) => {
    ui.window.prompt = () => String(sum);
    const [[r0, c0], ...rest] = cells;
    ui.fire(ui.cellAt(r0, c0), "mousedown");
    for (const [r, c] of rest) ui.fire(ui.cellAt(r, c), "mouseover");
    ui.fireOnDocument("mouseup");
  };

  /** Which of a cell's four cage-outline edges are drawn, as a "tblr" subset. */
  const edgesOf = (r, c) => {
    const edge = ui.cellAt(r, c).querySelector(".cage-edge");
    return edge ? ["t", "b", "l", "r"].filter((s) => edge.classList.contains(s)).join("") : null;
  };

  before(async () => {
    // A second tab, so switching can be exercised without depending on the
    // real sudoku or queens modules.
    ui = await boot({ tabs: [{ id: "other", label: "Other", mount() {} }] });
  });

  it("mounts a tab and an empty 81-cell board", () => {
    assert.ok(ui.document.querySelector('#tabbar .tab[data-tab-id="killer"]'));
    assert.equal(ui.board.querySelectorAll(".kcell").length, 81);
    assert.equal(uncaged(), 81);
  });

  it("builds a cage from a drag, printing the sum in the anchor cell", () => {
    drawCage(15, [[0, 0], [1, 0], [1, 1]]);          // an L, to test the outline
    assert.equal(caged(), 3);

    const tags = ui.board.querySelectorAll(".cage-sum");
    assert.equal(tags.length, 1, "the sum belongs to the cage, not to every cell in it");
    assert.equal(tags[0].textContent, "15");

    const anchor = tags[0].closest(".kcell");
    assert.equal(anchor.dataset.r, "0", "anchor is the topmost cell");
    assert.equal(anchor.dataset.c, "0", "then the leftmost of those");
  });

  it("outlines the cage only where it does not continue", () => {
    // (0,0) has a cage-mate below, so its bottom edge stays open.
    assert.equal(edgesOf(0, 0), "tlr");
    // (1,1) has one to its left only.
    assert.equal(edgesOf(1, 1), "tbr");
    assert.equal(ui.cellAt(1, 1).querySelectorAll(".cage-edge").length, 1,
                 "adjacent edges compose on a single overlay element");
  });

  it("refuses a one-cell cage", () => {
    ui.fire(ui.cellAt(4, 4), "mousedown");
    ui.fireOnDocument("mouseup");
    assert.match(ui.statusText(), /at least 2 cells/);
  });

  it("refuses a sum the cage cannot reach", () => {
    drawCage(40, [[6, 0], [6, 1]]);                  // two digits cap out at 17
    assert.match(ui.statusText(), /must total between 3 and 17/);
    assert.equal(caged(), 3, "the refused cage was not created");
  });

  it("selects a cage when one of its cells is clicked", () => {
    ui.fire(ui.cellAt(0, 0), "mousedown");
    ui.fireOnDocument("mouseup");
    assert.equal(ui.document.getElementById("kSumRow").hidden, false);
  });

  it("edits the selected cage's sum", () => {
    const input = ui.document.getElementById("kSumInput");
    input.value = "20";
    input.dispatchEvent(new ui.window.Event("change", { bubbles: true }));
    assert.equal(ui.board.querySelector(".cage-sum").textContent, "20");
  });

  it("reverts an edit that puts the sum out of reach", () => {
    const input = ui.document.getElementById("kSumInput");
    input.value = "2";                               // three digits total 6 at least
    input.dispatchEvent(new ui.window.Event("change", { bubbles: true }));
    assert.equal(ui.board.querySelector(".cage-sum").textContent, "20");
    assert.match(ui.statusText(), /must total/);
  });

  it("deletes the selected cage", () => {
    ui.fire(ui.document.getElementById("kDeleteCage"), "click");
    assert.equal(uncaged(), 81);
  });

  it("writes a value in pen and candidates in pencil", () => {
    ui.fire(ui.inPanel('[data-kmode="digits"]'), "click");
    assert.equal(ui.document.getElementById("kDigitControls").hidden, false);

    ui.fire(ui.cellAt(3, 3), "click");
    ui.fire(ui.digit(7), "click");
    assert.equal(ui.cellAt(3, 3).querySelector(".val")?.textContent, "7");

    ui.fire(ui.inPanel('[data-kpen="pencil"]'), "click");
    ui.fire(ui.cellAt(4, 5), "click");
    for (const d of [2, 9]) ui.fire(ui.digit(d), "click");
    assert.equal(ui.cellAt(4, 5).querySelector(".marks")?.textContent, "29");
  });

  it("keeps the board across a tab switch", () => {
    const tab = (id) => ui.document.querySelector(`#tabbar .tab[data-tab-id="${id}"]`);
    ui.fire(tab("other"), "click");
    assert.ok(ui.panel.hidden);
    assert.equal(ui.document.querySelector('[data-tab-panel="other"]').hidden, false);

    ui.fire(tab("killer"), "click");
    assert.equal(ui.cellAt(3, 3).querySelector(".val")?.textContent, "7",
                 "panels are hidden and shown, never rebuilt");
  });
});
