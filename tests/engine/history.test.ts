// The History core (web/ui/history.ts): the shell's undo/redo, tested here
// rather than through any one tab's page tests because it is generic over
// the tab's own Edit type. A plain running counter stands in for a puzzle's
// state wherever the shape of the state doesn't matter to the assertion; the
// last test uses cell-shaped objects because it is specifically about
// restoring the exact prior value, not merely an equal one.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HISTORY_CAP,
  canRedo,
  canUndo,
  emptyHistory,
  record,
  redo,
  undo,
  type Edit,
} from "../../web/ui/history.ts";

/** Add `delta` — the simplest Edit that is never a no-op. */
const add = (delta: number): Edit<number> => ({
  apply: (n) => n + delta,
  invert: (n) => n - delta,
});

test("recording moves the cursor to the end and applies the Edit", () => {
  let h = emptyHistory<number>();
  let n = 0;
  ({ history: h, state: n } = record(h, n, add(1)));

  assert.equal(n, 1);
  assert.equal(h.cursor, 1);
  assert.equal(canUndo(h), true);
  assert.equal(canRedo(h), false);
});

test("undo and redo walk the cursor, inverting and reapplying as they go", () => {
  let h = emptyHistory<number>();
  let n = 0;
  ({ history: h, state: n } = record(h, n, add(1)));
  ({ history: h, state: n } = record(h, n, add(10)));
  ({ history: h, state: n } = record(h, n, add(100)));
  assert.equal(n, 111);

  let step = undo(h, n)!;
  ({ history: h, state: n } = step);
  assert.equal(n, 11, "add(100) was inverted");
  assert.equal(h.cursor, 2);
  assert.equal(canUndo(h), true);
  assert.equal(canRedo(h), true);

  step = undo(h, n)!;
  ({ history: h, state: n } = step);
  assert.equal(n, 1, "add(10) was inverted");

  step = redo(h, n)!;
  ({ history: h, state: n } = step);
  assert.equal(n, 11, "add(10) was reapplied");
  assert.equal(h.cursor, 2);
});

test("undo with nothing behind the cursor, and redo with nothing ahead, are null", () => {
  const h0 = emptyHistory<number>();
  assert.equal(undo(h0, 0), null, "nothing recorded yet");
  assert.equal(redo(h0, 0), null, "nothing recorded yet");

  const { history: h1, state: n1 } = record(h0, 0, add(1));
  assert.equal(redo(h1, n1), null, "the cursor is already at the end");

  const back = undo(h1, n1)!;
  assert.equal(undo(back.history, back.state), null, "the cursor is already at the start");
});

test("a new Edit discards everything ahead of the cursor", () => {
  let h = emptyHistory<number>();
  let n = 0;
  ({ history: h, state: n } = record(h, n, add(1)));
  ({ history: h, state: n } = record(h, n, add(10)));
  ({ history: h, state: n } = record(h, n, add(100)));

  const back = undo(h, n)!; // cursor now sits before add(100)
  ({ history: h, state: n } = back);

  ({ history: h, state: n } = record(h, n, add(1000)));

  assert.equal(n, 1011, "the discarded add(100) played no further part");
  assert.equal(h.edits.length, 3, "add(100) was dropped, add(1000) took its place");
  assert.equal(canRedo(h), false);

  const undone = undo(h, n)!;
  assert.equal(undone.state, 11, "undoing lands where add(100) used to, not on it");
});

test("the cap drops the oldest Edit once exceeded", () => {
  let h = emptyHistory<number>();
  let n = 0;
  for (let i = 0; i < HISTORY_CAP + 10; i++) {
    ({ history: h, state: n } = record(h, n, add(1)));
  }

  assert.equal(h.edits.length, HISTORY_CAP);
  assert.equal(h.cursor, HISTORY_CAP);
  assert.equal(n, HISTORY_CAP + 10);

  for (let i = 0; i < HISTORY_CAP; i++) {
    const step = undo(h, n)!;
    ({ history: h, state: n } = step);
  }

  assert.equal(canUndo(h), false);
  assert.equal(n, 10, "the ten dropped Edits' effect on state is not itself undoable");
});

test("invert restores the exact prior state, not merely an equal one", () => {
  interface Cell {
    value: number | null;
    marks: number[];
  }
  const board: Cell[] = [
    { value: null, marks: [1, 2] },
    { value: 5, marks: [] },
  ];

  const setCell = (i: number, before: Cell, after: Cell): Edit<Cell[]> => ({
    apply: (cells) => cells.map((c, idx) => (idx === i ? after : c)),
    invert: (cells) => cells.map((c, idx) => (idx === i ? before : c)),
  });

  const before = board[0];
  const after: Cell = { value: 7, marks: [] };

  let h = emptyHistory<Cell[]>();
  let state = board;
  ({ history: h, state } = record(h, state, setCell(0, before, after)));
  assert.deepEqual(state[0], after);

  const back = undo(h, state)!;
  assert.equal(back.state[0], before, "the exact prior Cell object came back");
  assert.deepStrictEqual(back.state, board);
});
