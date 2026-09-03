// The three-level hint reveal: nudge, then technique, then the full argument.
//
// This is the file that would have caught the bug it was written after. The
// engine had been producing a precise explanation for a release, the API was
// returning it, and killer.js never read it off the response — so the hint
// stayed as useless on screen as it had been before the fix. Asserting on what
// the DOM says, rather than on what the endpoint returns, is the whole point.

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const { boot } = require("./harness");

// A fixed reply stands in for the API: this file is about presentation, and a
// live engine would let a change in phrasing quietly rewrite the assertions.
const REPLY = {
  ok: true,
  nudge: "Look at the 32-cage at r4c8.",
  technique: "Cage sum",
  hint: {
    technique: "Cage sum",
    level: 3,
    action: "eliminate",
    cells: [{ r: 3, c: 7 }],
    digits: [3],
    units: ["the 32-cage at r4c8"],
    explanation: "the 32-cage at r4c8 needs 31 more across 5 cells. The other 4 cells " +
                 "can total at most 27, so r4c8 must be at least 4 — 3 cannot go there.",
  },
};

describe("killer hint reveal", () => {
  let ui;
  const shown = () => ui.hintEl.textContent;
  const targets = () => ui.board.querySelectorAll(".kcell.target").length;
  const revealTo = (level) => ui.fire(ui.revealEl.querySelector(`[data-level="${level}"]`), "click");

  before(async () => {
    ui = await boot({ fetch: async () => ({ ok: true, json: async () => REPLY }) });

    // Pencil in the marks the hint speaks about, so the reveal has something to
    // strike through.
    ui.fire(ui.inPanel('[data-kmode="digits"]'), "click");
    ui.fire(ui.inPanel('[data-kpen="pencil"]'), "click");
    ui.fire(ui.cellAt(3, 7), "click");
    for (const d of [3, 4, 5]) ui.fire(ui.digit(d), "click");
    assert.equal(ui.cellAt(3, 7).querySelector(".marks")?.textContent, "345");
  });

  it("offers no reveal until there is a hint to reveal", () => {
    assert.ok(ui.revealEl.hidden);
  });

  it("level 1 gives the nudge and nothing else", async () => {
    ui.fire(ui.inPanel("#kGetHint"), "click");
    await ui.flush();

    assert.equal(ui.revealEl.hidden, false);
    assert.match(shown(), /Look at the 32-cage at r4c8/);
    assert.doesNotMatch(shown(), /Cage sum/, "the technique is level 2's to give away");
    assert.doesNotMatch(shown(), /must be at least 4/, "and the argument is level 3's");
    assert.equal(targets(), 0, "pointing at the cell would give away the nudge");
  });

  it("level 2 names the technique but still withholds the argument", () => {
    revealTo(2);
    assert.match(shown(), /Cage sum/);
    assert.doesNotMatch(shown(), /must be at least 4/);
  });

  it("level 3 spells out the argument", () => {
    revealTo(3);
    assert.match(shown(), /The other 4 cells can total at most 27, so r4c8 must be at least 4/);
  });

  it("level 3 points at the cell and reddens just the marks it rules out", () => {
    assert.ok(ui.cellAt(3, 7).classList.contains("target"));
    assert.equal(targets(), 1);

    const hot = [...ui.cellAt(3, 7).querySelectorAll(".marks span.hot")].map((s) => s.textContent);
    assert.deepEqual(hot, ["3"], "4 and 5 survive this elimination");
  });

  it("drops the highlight when the reveal steps back down", () => {
    revealTo(1);
    assert.equal(targets(), 0);
  });

  it("clears a hint the player has just invalidated", () => {
    revealTo(3);
    ui.fire(ui.cellAt(3, 7), "click");
    ui.fire(ui.digit(4), "click");

    assert.equal(shown(), "No hint yet.");
    assert.ok(ui.revealEl.hidden);
    assert.equal(targets(), 0, "a highlight outliving its hint points at nothing");
  });
});
