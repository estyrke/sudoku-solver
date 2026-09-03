// How the board shows what the audit found.
//
// A mistake is not a hint: it gets the message, the red cell outline and no
// reveal buttons, because there is nothing to reveal in stages. The marker has
// to be as easy to clear as it is to raise — one left behind on a cell the
// player has since fixed is worse than none at all.

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

const { boot } = require("./harness");

describe("killer audit markers", () => {
  let ui;
  let reply = null;                                  // swapped per case
  const marked = () => ui.board.querySelectorAll(".kcell.mistake").length;
  const getHint = async () => {
    ui.fire(ui.inPanel("#kGetHint"), "click");
    await ui.flush();
  };

  before(async () => {
    ui = await boot({ fetch: async () => ({ ok: true, json: async () => reply }) });
  });

  it("flags the cell the audit blames", async () => {
    reply = {
      ok: false,
      reason: "r1c1 is wrong — clear it and the board solves.",
      audit: { verdict: "wrong-value", cells: [{ r: 0, c: 0 }], message: "x" },
    };
    await getHint();

    assert.match(ui.hintEl.textContent, /r1c1 is wrong/);
    assert.ok(ui.revealEl.hidden, "a mistake has no staged reveal");
    assert.ok(ui.cellAt(0, 0).classList.contains("mistake"));
    assert.equal(marked(), 1);
  });

  it("clears the markers when the audit comes back clean", async () => {
    reply = {
      ok: false,
      reason: "No mistakes on the board — needs a technique.",
      audit: { verdict: "ok", cells: [], message: "clean" },
    };
    await getHint();

    assert.equal(marked(), 0);
    assert.match(ui.hintEl.textContent, /needs a technique/);
  });

  it("moves the marker when a later audit blames a different cell", async () => {
    reply = {
      ok: false,
      reason: "r5c5 is wrong.",
      audit: { verdict: "wrong-value", cells: [{ r: 4, c: 4 }], message: "x" },
    };
    await getHint();

    assert.ok(ui.cellAt(4, 4).classList.contains("mistake"));
    assert.ok(!ui.cellAt(0, 0).classList.contains("mistake"), "the stale marker is gone");
  });

  it("clears the marker as soon as the cell is edited", () => {
    ui.fire(ui.inPanel('[data-kmode="digits"]'), "click");
    ui.fire(ui.cellAt(4, 4), "click");
    ui.fire(ui.digit(7), "click");
    assert.equal(marked(), 0);
  });

  it("shows a real hint again once the mistake is behind it", async () => {
    reply = {
      ok: true,
      nudge: "Look at the 9-cage at r3c7.",
      technique: "Cage sum",
      hint: { action: "eliminate", cells: [{ r: 2, c: 7 }], digits: [6], explanation: "e" },
    };
    await getHint();

    assert.equal(ui.revealEl.hidden, false);
    assert.match(ui.hintEl.textContent, /Look at the 9-cage/);
    assert.equal(marked(), 0, "a hint and a mistake marker must never show together");
  });
});
