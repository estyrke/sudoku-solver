// The technique catalogue, ported assertion-for-assertion from the classic half
// of tests/test_techniques.py.
//
// The synthetic candidate grids come across unchanged: a board with no values,
// driven purely by the `cg` each test passes, so a technique is exercised in
// isolation from every other. The Cage-sum and 45-rule tests stay in Python
// until the Killer slice ports those techniques (issue #21).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { Board, idx, type Coord } from "../../web/sudoku/model.ts";
import * as T from "../../web/sudoku/techniques.ts";
import type { CandGrid } from "../../web/sudoku/techniques.ts";
import {
  applyHint,
  applyToCandidates,
  findHint,
  solveWithTechniques,
  workingCandidates,
} from "../../web/sudoku/hint.ts";
import { solve } from "../../web/sudoku/solver.ts";

/** A candidate grid from `[r, c, digits]` triples, in the order given — the
 * literal equivalent of the Python tests' `cg` dicts. */
function grid(entries: [number, number, number[]][]): CandGrid {
  return new Map(entries.map(([r, c, ds]) => [idx(r, c), new Set(ds)]));
}

const has = (cells: Coord[], cell: Coord): boolean =>
  cells.some(([r, c]) => r === cell[0] && c === cell[1]);

// A board with no values; techniques are driven purely by the synthetic cg we pass.
const EMPTY = new Board();

describe("techniques", () => {
  it("naked single", () => {
    const cg = grid([
      [0, 0, [5]],
      [0, 1, [3, 7]],
    ]);
    const hint = T.nakedSingle(EMPTY, cg);
    assert.ok(hint);
    assert.equal(hint.action, "place");
    assert.deepEqual(hint.cells, [[0, 0]]);
    assert.deepEqual(hint.digits, [5]);
  });

  it("hidden single in a row", () => {
    // In row 0, digit 7 is a candidate only in r1c4, which also holds 1,2.
    const entries: [number, number, number[]][] = [];
    for (let c = 0; c < 9; c++) entries.push([0, c, c === 3 ? [1, 2, 7] : [1, 2]]);
    const hint = T.hiddenSingle(EMPTY, grid(entries));
    assert.ok(hint);
    assert.equal(hint.action, "place");
    assert.deepEqual(hint.cells, [[0, 3]]);
    assert.deepEqual(hint.digits, [7]);
  });

  it("naked pair eliminates", () => {
    const cg = grid([
      [0, 0, [1, 2]],
      [0, 1, [1, 2]],
      [0, 2, [1, 2, 3]],
      [0, 3, [3, 4]],
    ]);
    const hint = T.nakedPair(EMPTY, cg);
    assert.ok(hint);
    assert.equal(hint.action, "eliminate");
    assert.ok(has(hint.cells, [0, 2]));
    assert.ok([1, 2].every((d) => hint.digits.includes(d)));
  });

  it("hidden pair eliminates", () => {
    // In row 0, digits 8 and 9 appear only in r1c1 and r1c2 (each cluttered with extras).
    const entries: [number, number, number[]][] = [];
    for (let c = 0; c < 9; c++) entries.push([0, c, [1, 2, 3]]);
    entries[0] = [0, 0, [1, 8, 9]];
    entries[1] = [0, 1, [2, 8, 9]];
    const hint = T.hiddenPair(EMPTY, grid(entries));
    assert.ok(hint);
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.cells, [
      [0, 0],
      [0, 1],
    ]);
    // the extras (1 and 2) get removed, leaving the hidden pair
    assert.deepEqual(hint.digits, [1, 2]);
  });

  it("pointing, box to line", () => {
    // In box 0, digit 4 is a candidate only in row 0 (r1c1, r1c2). r1c6 holds 4 too.
    const cg = grid([
      [0, 0, [4, 5]],
      [0, 1, [4, 6]],
      [2, 2, [7]], // box 0, no 4 -> doesn't break the row-confinement
      [0, 5, [4, 1]], // same row, outside box -> elimination target
    ]);
    const hint = T.pointing(EMPTY, cg);
    assert.ok(hint);
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.digits, [4]);
    assert.ok(has(hint.cells, [0, 5]));
  });

  it("claiming, line to box", () => {
    // In row 0, digit 3 only appears inside box 0 (cols 0,1). r3c1 (box 0) also has 3.
    const cg = grid([
      [0, 0, [3, 5]],
      [0, 1, [3, 6]],
      [2, 0, [3, 9]], // box 0, different row -> elimination target
    ]);
    const hint = T.claiming(EMPTY, cg);
    assert.ok(hint);
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.digits, [3]);
    assert.ok(has(hint.cells, [2, 0]));
  });

  it("x-wing across rows", () => {
    // Digit 4 in rows 0 and 4 appears in exactly columns 2 and 6 -> eliminate 4
    // from those columns elsewhere (r9c3).
    const cg = grid([
      [0, 2, [4, 1]],
      [0, 6, [4, 1]],
      [4, 2, [4, 5]],
      [4, 6, [4, 5]],
      [8, 2, [4, 9]], // col 2, other row -> elimination target
    ]);
    const hint = T.xWing(EMPTY, cg);
    assert.ok(hint);
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.digits, [4]);
    assert.ok(has(hint.cells, [8, 2]));
  });
});

// ---------------------------------------------------------------------------
// End-to-end
// ---------------------------------------------------------------------------

const EASY =
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION =
  "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

describe("hint pipeline", () => {
  it("solves the easy board", () => {
    const solved = solve(Board.fromString(EASY));
    assert.ok(solved);
    assert.ok(solved.isSolved());
    const flat = solved.cells.map((cell) => String(cell.value)).join("");
    assert.equal(flat, SOLUTION);
  });

  it("is consistent with the solution", () => {
    const board = Board.fromString(EASY);
    const solution = Board.fromString(SOLUTION);
    const { board: final, steps } = solveWithTechniques(board);
    assert.ok(steps.length > 0, "expected at least one hint");
    // every placement the engine made must match the true solution
    for (let i = 0; i < 81; i++) {
      const v = final.cells[i].value;
      if (v !== null) assert.equal(v, solution.cells[i].value, `wrong placement at ${i}`);
    }
    assert.ok(final.isValid());
  });

  it("finds no hint on a solved board", () => {
    assert.equal(findHint(Board.fromString(SOLUTION)), null);
  });
});

// ---------------------------------------------------------------------------
// The player's own notes
// ---------------------------------------------------------------------------

const cgOf = (board: Board) => workingCandidates(board);

describe("impossible pencil mark", () => {
  it("flags a row conflict", () => {
    const board = Board.fromString(EASY);
    board.cell(0, 2).pencilMarks = new Set([1, 2, 4, 5]); // r1c1 already holds the 5
    const hint = T.impossiblePencilMark(board, cgOf(board));
    assert.ok(hint);
    assert.equal(hint.technique, "Impossible pencil mark");
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.cells, [[0, 2]]);
    assert.ok(hint.digits.includes(5));
    assert.match(hint.explanation, /r1c1/);
  });

  it("is silent when the marks are legal", () => {
    const board = Board.fromString(EASY);
    board.cell(0, 2).pencilMarks = new Set(board.candidates(0, 2));
    assert.equal(T.impossiblePencilMark(board, cgOf(board)), null);
  });

  it("is silent without marks", () => {
    const board = Board.fromString(EASY);
    assert.equal(T.impossiblePencilMark(board, cgOf(board)), null);
  });

  it("runs before everything else", () => {
    // It has to come first: a deduction drawn from corrected candidates is
    // unreadable to someone still looking at the uncorrected marks.
    assert.equal(T.TECHNIQUES[0], T.impossiblePencilMark);
  });

  it("is reported before the single it hides", () => {
    // Regression for the reported bug: the engine offered a hidden single that
    // the player could not see, because it had quietly dropped the mark that
    // made the digit ambiguous.
    const board = Board.fromString(EASY);
    board.cell(0, 2).pencilMarks = new Set([1, 2, 4, 5]);
    assert.equal(findHint(board)?.technique, "Impossible pencil mark");
  });

  it("does not stop a technique run from terminating", () => {
    // A stale mark is already absent from the candidate grid, so eliminating it
    // changes nothing there — the run must strip it from the board's marks too
    // or the same hint is re-found forever.
    const board = Board.fromString(EASY);
    board.cell(0, 2).pencilMarks = new Set([1, 2, 4, 5]);
    const { board: final, steps, solved } = solveWithTechniques(board);
    assert.ok(solved);
    assert.ok(steps.some((s) => s.technique === "Impossible pencil mark"));
    assert.ok(!final.cell(0, 2).pencilMarks.has(5));
  });
});

// ---------------------------------------------------------------------------
// The escalation order is behaviour, not an implementation detail
// ---------------------------------------------------------------------------

describe("escalation order", () => {
  it("matches the Python catalogue's classic entries, in order", () => {
    assert.deepEqual(
      T.TECHNIQUES.map((t) => t.name),
      [
        "impossiblePencilMark",
        "nakedSingle",
        "hiddenSingle",
        "nakedPair",
        "nakedTriple",
        "hiddenPair",
        "nakedQuad",
        "hiddenTriple",
        "pointing",
        "claiming",
        "xWing",
      ],
    );
  });

  it("offers the simpler single before the subset that also applies", () => {
    // Both a hidden single and a naked pair fire on this unit; the catalogue's
    // order is what decides, so a reshuffle changes which hint the player gets.
    const cg = grid([
      [0, 0, [1, 2]],
      [0, 1, [1, 2]],
      [0, 2, [1, 2, 3]],
      [0, 3, [3, 4]],
    ]);
    assert.ok(T.nakedPair(EMPTY, cg));
    assert.equal(findHint(EMPTY, cg)?.technique, "Hidden single");
  });
});

// ---------------------------------------------------------------------------
// Applying a hint
// ---------------------------------------------------------------------------

describe("applying a hint", () => {
  it("writes a placement onto the board", () => {
    const board = Board.fromString(EASY);
    const hint = findHint(board);
    assert.ok(hint);
    assert.equal(hint.action, "place");

    const after = applyHint(board, hint);
    const [r, c] = hint.cells[0];
    assert.equal(after.value(r, c), hint.digits[0]);
    assert.equal(board.value(r, c), null, "the original board is left alone");
  });

  it("rubs an elimination out of the player's own marks", () => {
    const board = Board.fromString(EASY);
    board.cell(0, 2).pencilMarks = new Set([1, 2, 4, 5]);
    const hint = findHint(board);
    assert.ok(hint);
    assert.equal(hint.action, "eliminate");

    const after = applyHint(board, hint);
    assert.deepEqual([...after.cell(0, 2).pencilMarks], [1, 2, 4]);
  });

  it("keeps eliminations in the candidate grid, so a later single unlocks", () => {
    // r1c3 holds 1,2,4 once the 5 is gone; strip the 1 and 2 and the 4 is a
    // naked single that only a persisted grid can see.
    const board = Board.fromString(EASY);
    const cg = workingCandidates(board);
    assert.deepEqual([...cg.get(idx(0, 2))!].sort(), [1, 2, 4]);

    applyToCandidates(board, cg, {
      technique: "test",
      level: 0,
      action: "eliminate",
      cells: [[0, 2]],
      digits: [1, 2],
      units: [],
      explanation: "",
    });

    const hint = findHint(board, cg);
    assert.equal(hint?.technique, "Naked single");
    assert.deepEqual(hint?.cells, [[0, 2]]);
    assert.deepEqual(hint?.digits, [4]);
  });

  it("clears a placement's digit from its peers", () => {
    const board = Board.fromString(EASY);
    const cg = workingCandidates(board);
    const hint = findHint(board, cg);
    assert.ok(hint);

    applyToCandidates(board, cg, hint);
    const [r, c] = hint.cells[0];
    assert.ok(!cg.has(idx(r, c)), "a placed cell leaves the grid");
    for (const p of board.peers(r, c)) {
      assert.ok(!cg.get(p)?.has(hint.digits[0]));
    }
  });
});
