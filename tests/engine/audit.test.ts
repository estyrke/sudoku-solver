// The board audit: telling a player's mistake apart from an exhausted catalogue.
// Ported assertion-for-assertion from tests/test_audit.py.
//
// The Python original read its board from a screenshot through the CV reader.
// The reader is still Python and still server-side, so what comes across here is
// its output: tests/fixtures/killer_boards/*.json holds a real read of the same
// screenshot, and tests/test_reader.py pins the reader to it, so the two halves
// cannot drift apart without a test saying so.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { Board, Cage, type WireBoard } from "../../web/sudoku/model.ts";
import { audit } from "../../web/sudoku/audit.ts";
import { solutions } from "../../web/sudoku/solver.ts";
import { applyToCandidates, findHint, workingCandidates } from "../../web/sudoku/hint.ts";

const FIXTURE3 = path.join(
  import.meta.dirname,
  "..",
  "fixtures",
  "killer_boards",
  "puzzle_page_killer_board3.json",
);
const wire = JSON.parse(readFileSync(FIXTURE3, "utf8")) as WireBoard;

/** A real read of a real screenshot — clean, and known to have one solution. */
const killerBoard = (): Board => Board.fromWire(wire);

test("a clean board audits clean", () => {
  const report = audit(killerBoard());
  assert.equal(report.verdict, "ok", report.message);
  assert.ok(report.clean);
  assert.deepEqual(report.cells, []);
});

test("the audit stays clean through a whole solve", () => {
  // A sound technique must never make the board look like a mistake.
  //
  // The audit gates every hint, so a false accusation would be worse than the
  // silence it replaced: it would stop the engine dead on a board that is fine.
  // Walk the catalogue from the read board to a finished one, auditing each step.
  const work = killerBoard();
  const cg = workingCandidates(work);
  let steps = 0;
  for (;;) {
    const hint = findHint(work, cg);
    if (hint === null || steps >= 500) break;
    steps++;
    if (hint.action === "place") {
      const [r, c] = hint.cells[0];
      work.setValue(r, c, hint.digits[0]);
    } else {
      for (const [r, c] of hint.cells) {
        for (const d of hint.digits) work.cell(r, c).pencilMarks.delete(d);
      }
    }
    applyToCandidates(work, cg, hint);
    const report = audit(work);
    assert.ok(report.clean, `step ${steps} (${hint.technique}): ${report.message}`);
  }

  assert.ok(work.isSolved(), `stalled after ${steps} steps`);
});

test("a wrong entry is named", () => {
  // A digit that conflicts with nothing, and is simply not the answer.
  //
  // Nothing else on the board flags this: isValid passes, no unit repeats, no
  // cage overshoots. It only shows up as the puzzle quietly becoming unsolvable.
  const answer = solutions(killerBoard(), 1)[0];
  // legal where it sits, just not the answer — so no rule catches it
  const wrong = [...killerBoard().candidates(0, 0)]
    .filter((d) => d !== answer.value(0, 0))
    .sort((a, b) => a - b)[0];

  const board = killerBoard();
  board.setValue(0, 0, wrong);
  assert.ok(board.isValid(), "the point is a mistake that isn't a rule violation");

  const report = audit(board);
  assert.equal(report.verdict, "wrong-value");
  assert.deepEqual(report.cells, [[0, 0]]);
  assert.match(report.message, /r1c1/);
});

test("a rubbed-out pencil mark is named but not spelled out", () => {
  // Naming the digit would be handing over the answer for that cell.
  const answer = solutions(killerBoard(), 1)[0];
  const needed = answer.value(0, 0)!;

  const board = killerBoard();
  assert.ok(board.cell(0, 0).pencilMarks.has(needed));
  board.cell(0, 0).pencilMarks.delete(needed);

  const report = audit(board);
  assert.equal(report.verdict, "missing-mark");
  assert.deepEqual(report.cells, [[0, 0]]);
  assert.match(report.message, /r1c1/);
  assert.doesNotMatch(report.message, new RegExp(String(needed)));
});

test("a cell with no marks at all is not a missing mark", () => {
  // An empty cell means "I haven't pencilled this yet", not "I ruled it out".
  // `workingCandidates` falls back to the legal candidates there, so nothing has
  // been lost and there is nothing to report.
  const board = killerBoard();
  board.cell(0, 0).pencilMarks.clear();
  assert.ok(audit(board).clean);
});

test("a misread cage sum is caught by arithmetic, not search", () => {
  // 405 localises the *kind* of mistake for free, which search cannot do.
  const original = killerBoard();
  const cages = original.cages.map((cage, i) =>
    i === 0 ? new Cage(cage.cells, cage.sum + 1) : cage,
  );
  const board = new Board(killerBoard().cells, cages);

  const report = audit(board);
  assert.equal(report.verdict, "wrong-cage");
  assert.match(report.message, /406/);
  assert.match(report.message, /405/);
  assert.match(report.message, /1 too high/);
});

test("an ambiguous board blocks the pencil-mark check", () => {
  // With several solutions, a digit missing from one cell's marks may be
  // exactly right — so the mark check must not run and claim a mistake.
  const board = new Board();
  board.cell(0, 0).pencilMarks = new Set([1, 2]);
  assert.equal(solutions(board, 2).length, 2);

  const report = audit(board);
  assert.equal(report.verdict, "ambiguous");
  assert.match(report.message, /more than one solution/);
});

test("a half-drawn cage layout is not judged", () => {
  // Mid-way through drawing cages every verdict would be about the ones that
  // aren't there yet, so the audit declines to have an opinion.
  const board = new Board(undefined, [new Cage([[0, 0], [0, 1]], 5)]);
  const report = audit(board);
  assert.equal(report.verdict, "incomplete");
  assert.ok(!report.clean);
});

test("an unsolvable board with nothing entered blames the cages", () => {
  // Two sums moved in opposite directions: 405 still checks out, but no
  // arrangement of digits satisfies them, and nothing has been entered to blame.
  const cages = killerBoard().cages.map((cage, i) => {
    if (i === 0) return new Cage(cage.cells, cage.sum + 1);
    if (i === 1) return new Cage(cage.cells, cage.sum - 1);
    return cage;
  });
  const board = new Board(undefined, cages);
  assert.equal(
    board.cages.reduce((n, cage) => n + cage.sum, 0),
    405,
  );

  const report = audit(board);
  assert.equal(report.verdict, "wrong-value");
  assert.deepEqual(report.cells, []);
  assert.match(report.message, /nothing has been entered/);
});

test("two wrong entries are reported as such", () => {
  // When no single entry explains it, saying which one is wrong would be a lie.
  const answer = solutions(killerBoard(), 1)[0];
  const board = killerBoard();
  let swapped = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board.value(r, c) === null && swapped < 2) {
        board.setValue(r, c, (answer.value(r, c)! % 9) + 1);
        swapped++;
      }
    }
  }
  assert.equal(swapped, 2);

  const report = audit(board);
  assert.equal(report.verdict, "wrong-value");
  assert.match(report.message, /at least two/);
});
