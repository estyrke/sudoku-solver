// The technique catalogue, ported assertion-for-assertion from the classic half
// of tests/test_techniques.py.
//
// The synthetic candidate grids come across unchanged: a board with no values,
// driven purely by the `cg` each test passes, so a technique is exercised in
// isolation from every other.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { Board, Cage, idx, rc, type Coord } from "../../web/sudoku/model.ts";
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

/** A reference Killer board as the reader read it — the same files
 * solver.test.ts solves and tests/test_reader.py pins the read of. */
const fixture = (name: string): Board =>
  Board.fromWire(
    JSON.parse(
      readFileSync(
        path.join(import.meta.dirname, "..", "fixtures", "killer_boards", `${name}.json`),
        "utf8",
      ),
    ),
  );

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

  it("cage pointing, cage to line", () => {
    // A 2-cell cage totalling 17 can only be {8, 9} — so unlike a plain box, a
    // digit being confined to one line inside it only means something because
    // every workable set uses it. Both cells sit in row 0; r0c5 also has an 8.
    const board = new Board(undefined, [new Cage([[0, 0], [0, 1]], 17)]);
    const hint = T.cagePointing(board, cgOf(board));
    assert.ok(hint);
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.digits, [8]);
    assert.ok(has(hint.cells, [0, 5]));
  });

  it("cage pointing stays quiet when the digit could be left out of the cage", () => {
    // A 4-cell cage totalling 22 has {2,3,8,9} among its workable sets, but also
    // {4,5,6,7} — no 2 in that one — so a 2 confined to one line inside the cage
    // still proves nothing about the rest of that line.
    const board = new Board(undefined, [
      new Cage([[0, 0], [0, 1], [0, 2], [1, 1]], 22),
    ]);
    assert.equal(T.cagePointing(board, cgOf(board)), null);
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
  it("matches the Python catalogue, in order", () => {
    assert.deepEqual(
      T.TECHNIQUES.map((t) => t.name),
      [
        "impossiblePencilMark",
        "nakedSingle",
        "hiddenSingle",
        "cageSum",
        "fortyFiveRule",
        "nakedPair",
        "nakedTriple",
        "hiddenPair",
        "nakedQuad",
        "hiddenTriple",
        "pointing",
        "claiming",
        "cagePointing",
        "xWing",
        "fortyFiveSets",
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

// ---------------------------------------------------------------------------
// Killer Sudoku: cage-aware solving
// ---------------------------------------------------------------------------

const SPANS: [number, number][] = [
  [0, 2],
  [2, 4],
  [4, 6],
  [6, 9],
];

/** Tile each row of SOLUTION with contiguous runs of 2,2,2,3 cells — a full
 * 81-cell partition whose cages are legal by construction (same-row digits
 * differ) and consistent with EASY's unique solution. */
function cagesFromSolution(): Cage[] {
  const solved = Board.fromString(SOLUTION);
  const out: Cage[] = [];
  for (let r = 0; r < 9; r++) {
    for (const [a, b] of SPANS) {
      const cells: Coord[] = [];
      let total = 0;
      for (let c = a; c < b; c++) {
        cells.push([r, c]);
        total += solved.value(r, c)!;
      }
      out.push(new Cage(cells, total));
    }
  }
  return out;
}

describe("cage-aware solving", () => {
  it("satisfies every cage sum", () => {
    const solved = solve(new Board(undefined, cagesFromSolution()));
    assert.ok(solved);
    assert.ok(solved.isSolved());
    for (const cage of solved.cages) {
      const total: number = cage.cells.reduce((n, [r, c]) => n + solved.value(r, c)!, 0);
      assert.equal(total, cage.sum);
    }
  });

  it("rejects a classically valid but sum-invalid board", () => {
    // EASY has a unique classic solution in which r1c1+r1c2 = 5+3 = 8. Pinning
    // that pair to any other total leaves the board classically solvable but
    // with no cage-satisfying solution, so solve() must return null. Without
    // cage-sum pruning in the backtracker it would return the classic solution.
    const classic = solve(Board.fromString(EASY));
    assert.ok(classic);
    assert.equal(classic.value(0, 0)! + classic.value(0, 1)!, 8);

    const contradictory = new Board(Board.fromString(EASY).cells, [
      new Cage([[0, 0], [0, 1]], 9),
    ]);
    assert.equal(solve(contradictory), null);
  });

  it("still solves with a cage-consistent sum", () => {
    const board = new Board(Board.fromString(EASY).cells, [new Cage([[0, 0], [0, 1]], 8)]);
    const solved = solve(board);
    assert.ok(solved);
    assert.ok(solved.isSolved());
    assert.equal(solved.value(0, 0)! + solved.value(0, 1)!, 8);
  });
});

// ---------------------------------------------------------------------------
// Killer Sudoku: cage-sum candidate restriction
// ---------------------------------------------------------------------------

describe("cage sum", () => {
  it("reads a two-cell cage of four", () => {
    // The canonical case: two cells totalling 4 can only be {1,3}. The first
    // thing to say about it is the bound — its partner can't go below 1, so
    // this cell can't go above 3 — which takes out six digits in one line.
    const board = new Board(undefined, [new Cage([[0, 0], [0, 1]], 4)]);
    const hint = T.cageSum(board, cgOf(board));
    assert.ok(hint);
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.cells, [[0, 0]]);
    assert.deepEqual(hint.digits, [4, 5, 6, 7, 8, 9]);
    assert.match(hint.explanation, /must be at most 3/);
  });

  it("still reaches what the bound cannot", () => {
    // The bound leaves 2 standing — only the no-repeat rule kills it. A clearer
    // first step is worth having only if the rest still follows, so once the
    // squeeze is applied the combination list must pick up the remainder.
    const board = new Board(undefined, [new Cage([[0, 0], [0, 1]], 4)]);
    const cg = cgOf(board);
    const seen: T.Hint[] = [];
    for (;;) {
      const hint = T.cageSum(board, cg);
      if (hint === null || seen.length >= 10) break;
      seen.push(hint);
      applyToCandidates(board, cg, hint);
    }

    assert.deepEqual([...cg.get(idx(0, 0))!], [1, 3]);
    assert.deepEqual([...cg.get(idx(0, 1))!], [1, 3]);
    const byRepeat = seen.filter((h) => h.explanation.includes("{13}"));
    assert.ok(byRepeat.length > 0);
    assert.ok(byRepeat.every((h) => h.digits.length === 1 && h.digits[0] === 2));
  });

  it("handles a partially filled cage", () => {
    // A 15-cage with a 9 already placed needs 6 from two cells: {1,5} or {2,4}.
    const board = new Board(undefined, [new Cage([[0, 0], [0, 1], [0, 2]], 15)]);
    board.setValue(0, 0, 9);
    const hint = T.cageSum(board, cgOf(board));
    assert.ok(hint);
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.cells, [[0, 1]]);
    assert.deepEqual(hint.digits, [6, 7, 8]);
  });

  it("places a forced digit", () => {
    // A 17-cage must be {8,9}; if one cell can't be 9, it has to be the 8.
    const board = new Board(undefined, [new Cage([[0, 0], [0, 1]], 17)]);
    board.setValue(3, 0, 9); // column peer removes 9 from r1c1
    const hint = T.cageSum(board, cgOf(board));
    assert.ok(hint);
    assert.equal(hint.action, "place");
    assert.deepEqual(hint.cells, [[0, 0]]);
    assert.deepEqual(hint.digits, [8]);
    assert.ok(hint.units.includes("the 17-cage at r1c1"));
  });

  it("names the cage and its combinations in the explanation", () => {
    const board = new Board(undefined, [new Cage([[0, 0], [0, 1]], 17)]);
    board.setValue(3, 0, 9);
    const hint = T.cageSum(board, cgOf(board));
    assert.ok(hint);
    assert.match(hint.explanation, /the 17-cage at r1c1/);
    assert.match(hint.explanation, /\{89\}/);
    assert.deepEqual(hint.units, ["the 17-cage at r1c1"]);
  });

  it("keeps quiet when a cage with many sets rules nothing out", () => {
    // An empty 5-cell cage totalling 25 has dozens of workable sets, no useful
    // bound, and — because 25 sits squarely in the middle of what five distinct
    // digits can reach — no digit that every set avoids. Silence here is the
    // absence of a deduction, not a refusal to state one.
    const cells: Coord[] = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]];
    const board = new Board(undefined, [new Cage(cells, 25)]);
    const cg = cgOf(board);
    const options = T.cageOptions(board, cg, board.cages[0]);
    assert.ok(options);
    assert.ok(options.combos.length > T.MAX_LISTED_COMBOS);
    assert.equal(T.squeezedOut(cells[0], cells, cg, 25), null);

    assert.equal(T.cageSum(board, cg), null);
  });

  // An 18-cage down column 1 whose middle cell has lost its 8 and 9. Seven sets
  // reach 18, too many to print, and no bound catches anything — but only one of
  // them holds a 1, and that set needs r2c1 to take an 8 or a 9 the moment the 1
  // goes anywhere else. So r1c1 and r3c1 cannot be 1.
  const unlistableCage = (): [Board, CandGrid] => {
    const board = new Board(undefined, [new Cage([[0, 0], [1, 0], [2, 0]], 18)]);
    const cg = cgOf(board);
    cg.get(idx(1, 0))!.delete(8);
    cg.get(idx(1, 0))!.delete(9);
    return [board, cg];
  };

  it("still eliminates when there are too many sets to list", () => {
    // The deduction that carries a hard Killer board. Capping the *deduction* at
    // MAX_LISTED_COMBOS rather than the wording left boards like this one dead.
    const [board, cg] = unlistableCage();
    const options = T.cageOptions(board, cg, board.cages[0]);
    assert.ok(options);
    assert.ok(options.combos.length > T.MAX_LISTED_COMBOS, "wanted an unlistable cage");
    for (const cell of board.cages[0].cells) {
      assert.equal(T.squeezedOut(cell, board.cages[0].cells, cg, 18), null, "a bound would do");
    }

    const hint = T.cageSum(board, cg);
    assert.ok(hint, "an unlistable cage must still speak");
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.cells, [[0, 0]]);
    assert.deepEqual(hint.digits, [1]);
  });

  it("states its conclusion rather than listing sets nobody would check", () => {
    // The wording is the point: one claim to verify, plus how much work it
    // stands on, instead of seven sets to re-derive.
    const [board, cg] = unlistableCage();
    const hint = T.cageSum(board, cg);
    assert.ok(hint);
    assert.match(hint.explanation, /There are 7 ways to do that/);
    assert.match(hint.explanation, /not one of them puts 1 in r1c1/);
    assert.doesNotMatch(hint.explanation, /\{/, "no set list past the cap");
  });

  it("offers the shortest argument first", () => {
    // Two cages both have something to say; the two-set one is the checkable one.
    const tight = new Cage([[0, 0], [0, 1]], 4); // {13} only
    const loose = new Cage([[4, 0], [4, 1], [4, 2], [4, 3]], 20); // dozens of sets
    const board = new Board(undefined, [loose, tight]);
    const cg = cgOf(board);
    for (const [r, c] of loose.cells) {
      // leave the loose cage nothing a bound can catch
      cg.get(idx(r, c))!.delete(1);
      cg.get(idx(r, c))!.delete(9);
    }

    const hint = T.cageSum(board, cg);
    assert.ok(hint);
    assert.deepEqual(hint.units, ["the 4-cage at r1c1"]);
  });

  it("is silent on a classic board", () => {
    const board = Board.fromString(EASY);
    assert.equal(T.cageSum(board, cgOf(board)), null);
  });

  it("ignores combinations its cells cannot take", () => {
    // {1,3} totals 4, but if neither cell can hold a 3 the cage is unsatisfiable
    // and the technique stays quiet rather than eliminating everything.
    const board = new Board(undefined, [new Cage([[0, 0], [0, 1]], 4)]);
    const cg = cgOf(board);
    cg.get(idx(0, 0))!.delete(3);
    cg.get(idx(0, 1))!.delete(3);
    assert.equal(T.cageSum(board, cg), null);
  });

  it("loses to a classic single that also applies", () => {
    const board = new Board(Board.fromString(EASY).cells, [new Cage([[0, 1], [0, 2]], 4)]);
    const hint = findHint(board);
    assert.ok(hint);
    assert.ok(["Naked single", "Hidden single"].includes(hint.technique));
  });

  it("sits between the singles and the subsets", () => {
    const names = T.TECHNIQUES.map((t) => t.name);
    assert.ok(names.indexOf("hiddenSingle") < names.indexOf("cageSum"));
    assert.ok(names.indexOf("cageSum") < names.indexOf("nakedPair"));
  });

  it("never contradicts a known solution", () => {
    // Soundness: SOLUTION satisfies every cage, so it is a live witness that
    // each of its digits is possible. cageSum must therefore never eliminate
    // one, nor place anything that disagrees with it.
    const solution = Board.fromString(SOLUTION);
    const board = new Board(Board.fromString(EASY).cells, cagesFromSolution());
    const cg = workingCandidates(board);

    let fired = 0;
    for (;;) {
      const hint = T.cageSum(board, cg);
      if (hint === null || fired >= 300) break;
      fired++;
      if (hint.action === "place") {
        const [r, c] = hint.cells[0];
        assert.equal(hint.digits[0], solution.value(r, c), `placed wrongly at ${r},${c}`);
        board.setValue(r, c, hint.digits[0]);
      } else {
        for (const [r, c] of hint.cells) {
          assert.ok(
            !hint.digits.includes(solution.value(r, c)!),
            `eliminated the solution's digit at ${r},${c}`,
          );
        }
      }
      applyToCandidates(board, cg, hint);
    }

    assert.ok(fired > 0, "expected cageSum to find at least one deduction");
  });
});

// ---------------------------------------------------------------------------
// Killer Sudoku: the 45-rule
// ---------------------------------------------------------------------------

// Box 1 is rows 1-3 x columns 1-3. These three cages sit wholly inside it and
// cover six of its nine cells, totalling 30.
const box1Partial = (): Cage[] => [
  new Cage([[0, 0], [0, 1]], 10),
  new Cage([[1, 0], [1, 1]], 11),
  new Cage([[2, 0], [2, 1]], 9),
];

describe("45-rule", () => {
  it("finds an innie", () => {
    // Cages inside box 1 total 38 and cover all but r1c3, so it must be 45-38.
    const board = new Board(undefined, [...box1Partial(), new Cage([[1, 2], [2, 2]], 8)]);
    const hint = T.fortyFiveRule(board, cgOf(board));
    assert.ok(hint);
    assert.equal(hint.technique, "45-rule (innie)");
    assert.equal(hint.action, "place");
    assert.deepEqual(hint.cells, [[0, 2]]);
    assert.deepEqual(hint.digits, [7]);
    assert.deepEqual(hint.units, ["box 1"]);
    assert.match(hint.explanation, /45 − 38 = 7/);
  });

  it("finds an outie", () => {
    // Cages meeting box 1 cover it and spill into r3c4 alone, so that cell is
    // pinned by their total minus 45.
    const board = new Board(undefined, [
      ...box1Partial(),
      new Cage([[0, 2], [1, 2], [2, 2], [2, 3]], 22),
    ]);
    const hint = T.fortyFiveRule(board, cgOf(board));
    assert.ok(hint);
    assert.equal(hint.technique, "45-rule (outie)");
    assert.equal(hint.action, "place");
    assert.deepEqual(hint.cells, [[2, 3]]);
    assert.deepEqual(hint.digits, [7]);
    assert.deepEqual(hint.units, ["box 1"]);
    assert.match(hint.explanation, /52 − 45 = 7/);
  });

  it("applies to a row", () => {
    // Four cages inside row 1 total 38 and leave only r1c9.
    const board = new Board(undefined, [
      new Cage([[0, 0], [0, 1]], 10),
      new Cage([[0, 2], [0, 3]], 11),
      new Cage([[0, 4], [0, 5]], 9),
      new Cage([[0, 6], [0, 7]], 8),
    ]);
    const hint = T.fortyFiveRule(board, cgOf(board));
    assert.ok(hint);
    assert.deepEqual(hint.cells, [[0, 8]]);
    assert.deepEqual(hint.digits, [7]);
    assert.deepEqual(hint.units, ["row 1"]);
  });

  it("applies to a column", () => {
    const board = new Board(undefined, [
      new Cage([[0, 0], [1, 0]], 10),
      new Cage([[2, 0], [3, 0]], 11),
      new Cage([[4, 0], [5, 0]], 9),
      new Cage([[6, 0], [7, 0]], 8),
    ]);
    const hint = T.fortyFiveRule(board, cgOf(board));
    assert.ok(hint);
    assert.deepEqual(hint.cells, [[8, 0]]);
    assert.deepEqual(hint.digits, [7]);
    assert.deepEqual(hint.units, ["column 1"]);
  });

  it("is silent when two cells are unaccounted for", () => {
    // Two cells short of a full unit, the difference constrains a set rather
    // than pinning a value — out of scope for the single-cell rule.
    const board = new Board(undefined, box1Partial());
    assert.equal(T.fortyFiveRule(board, cgOf(board)), null);
  });

  it("is silent on a classic board", () => {
    const board = Board.fromString(EASY);
    assert.equal(T.fortyFiveRule(board, cgOf(board)), null);
  });

  it("runs after the cage sum", () => {
    const names = T.TECHNIQUES.map((t) => t.name);
    assert.ok(names.indexOf("cageSum") < names.indexOf("fortyFiveRule"));
  });

  it("never contradicts a known solution", () => {
    // Every cage sum comes from SOLUTION, so SOLUTION satisfies them all; an
    // innie's value is forced by those sums, so it must agree with SOLUTION.
    const solution = Board.fromString(SOLUTION);
    const board = new Board(undefined, boxCagesLeavingOneInnie());
    const cg = workingCandidates(board);
    let fired = 0;
    for (;;) {
      const hint = T.fortyFiveRule(board, cg);
      if (hint === null || fired >= 300) break;
      fired++;
      const [r, c] = hint.cells[0];
      assert.equal(hint.digits[0], solution.value(r, c), `placed wrongly at ${r},${c}`);
      board.setValue(r, c, hint.digits[0]);
      applyToCandidates(board, cg, hint);
    }
    assert.equal(fired, 9, "expected one innie per box");
  });
});

/**
 * Four cages wholly inside each box, covering eight of its nine cells.
 *
 * The row-aligned tiling used elsewhere never yields a single innie (every box
 * comes up three cells short), so the 45-rule needs its own layout. The ninth
 * cell of each box is deliberately left uncaged — a part-caged board is legal,
 * and the innie arithmetic doesn't care whether that cell belongs to a cage.
 */
function boxCagesLeavingOneInnie(): Cage[] {
  const solved = Board.fromString(SOLUTION);
  const total = (group: Coord[]) => group.reduce((n, [r, c]) => n + solved.value(r, c)!, 0);
  const cages: Cage[] = [];
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const r0 = br * 3;
      const c0 = bc * 3;
      const groups: Coord[][] = [
        [[r0, c0], [r0, c0 + 1]],
        [[r0 + 1, c0], [r0 + 1, c0 + 1]],
        [[r0 + 2, c0], [r0 + 2, c0 + 1]],
        [[r0, c0 + 2], [r0 + 1, c0 + 2]],
      ];
      for (const group of groups) cages.push(new Cage(group, total(group)));
    }
  }
  return cages;
}

// ---------------------------------------------------------------------------
// Killer Sudoku: the 45-rule over bands, and over several cells at once
// ---------------------------------------------------------------------------

/**
 * Cages filling all of rows 1-2 except r1c9, none of them inside one row.
 *
 * Seven vertical dominoes straddle the two rows and an L takes r1c8/r2c8/r2c9,
 * so no single row, column or box has a cage lying wholly inside it that leaves
 * exactly one cell over. Only the two-row band closes the arithmetic.
 */
function rowsOneAndTwoButOne(): Cage[] {
  const dominoes: Cage[] = [];
  for (let c = 0; c < 7; c++) dominoes.push(new Cage([[0, c], [1, c]], 11));
  return [...dominoes, new Cage([[0, 7], [1, 7], [1, 8]], 9)];
}

describe("45-rule over bands", () => {
  it("reads a two-row band", () => {
    // 77 + 9 = 86 across seventeen cells; two rows total 90, so r1c9 is 4.
    const board = new Board(undefined, rowsOneAndTwoButOne());
    const hint = T.fortyFiveRule(board, cgOf(board));
    assert.ok(hint, "the band was not considered");
    assert.equal(hint.technique, "45-rule (innie)");
    assert.deepEqual(hint.cells, [[0, 8]]);
    assert.deepEqual(hint.digits, [4]);
    assert.deepEqual(hint.units, ["rows 1-2"]);
    assert.match(hint.explanation, /90 − 86 = 4/);
  });

  it("finds what a single unit alone would not have", () => {
    // The point of bands: every one of the nine rows, columns and boxes is
    // silent on this board, so without them the deduction is invisible.
    const board = new Board(undefined, rowsOneAndTwoButOne());
    const cg = cgOf(board);
    for (const { label, cells, total } of T.spans(board)) {
      if (total !== T.UNIT_TOTAL) continue;
      for (const { cells: leftover, owed } of T.unaccounted(board, cells, total)) {
        const only =
          leftover.size === 1 && T.fortyFivePlacement(cg, rc([...leftover][0]), owed);
        assert.ok(!only, `${label} would have found it`);
      }
    }
  });

  it("stops at three units", () => {
    const board = new Board(undefined, [new Cage([[0, 0], [0, 1]], 5)]);
    const labels = new Set([...T.spans(board)].map((s) => s.label));
    assert.ok(labels.has("rows 1-2") && labels.has("rows 1-3"));
    assert.ok(labels.has("columns 7-9"));
    assert.ok(![...labels].some((label) => label.includes("1-4")));
  });

  it("pairs up boxes that share a band or a stack", () => {
    const board = new Board(undefined, [new Cage([[0, 0], [0, 1]], 5)]);
    const spans = new Map([...T.spans(board)].map((s) => [s.label, s]));
    assert.ok(spans.has("boxes 1+2"), "boxes across a band");
    assert.ok(spans.has("boxes 1+4"), "boxes down a stack");
    assert.ok(spans.has("boxes 1+3"), "the two ends of a band");
    // Boxes sharing neither band nor stack are too far apart to close on.
    assert.ok(!spans.has("boxes 1+5"));

    const pair = spans.get("boxes 1+2")!;
    assert.equal(pair.cells.size, 18);
    assert.equal(pair.total, 2 * T.UNIT_TOTAL);
    // Rows 1-3 are boxes 1+2+3, so a whole band adds nothing a pair doesn't.
    assert.ok(![...spans.keys()].some((label) => label === "boxes 1+2+3"));
  });

  it("finds an innie set no row, column or single box would have", () => {
    // Boxes 1+2 total 90. Six cages lie wholly inside them and total 83, leaving
    // r3c1, r3c2 and r3c6 to make 7 between them — the deduction that unlocked
    // tests/fixtures/killer_boards/puzzle_page_killer_board4.json, on which
    // every row, column and single box was silent.
    const board = fixture("puzzle_page_killer_board4");
    const boxPair = [...T.spans(board)].find((s) => s.label === "boxes 1+2")!;
    const [innies] = [...T.unaccounted(board, boxPair.cells, boxPair.total)];
    assert.equal(innies.kind, "innie");
    assert.equal(innies.held, 83);
    assert.equal(innies.owed, 7);
    assert.deepEqual([...innies.cells].map(rc), [[2, 0], [2, 1], [2, 5]]);
  });
});

/** Cages covering seven of row 1, totalling 28 — so r1c8 and r1c9 make 17. */
const rowOneLeavingTwo = (): Cage[] => [
  new Cage([[0, 0], [0, 1], [0, 2]], 6),
  new Cage([[0, 3], [0, 4]], 11),
  new Cage([[0, 5], [0, 6]], 11),
];

describe("45-rule over several cells", () => {
  it("squeezes a two-cell leftover", () => {
    // Two cells owing 17 can only be 8 and 9, so nothing below 8 fits either.
    const board = new Board(undefined, rowOneLeavingTwo());
    const hint = T.fortyFiveSets(board, cgOf(board));
    assert.ok(hint);
    assert.equal(hint.technique, "45-rule (innie set)");
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.cells, [[0, 7]]);
    assert.deepEqual(hint.digits, [1, 2, 3, 4, 5, 6, 7]);
    assert.match(hint.explanation, /must be at least 8/);
  });

  it("places when only one leftover is still empty", () => {
    // The set shrinks to a single cell as the others get filled in.
    const board = new Board(undefined, rowOneLeavingTwo());
    board.setValue(0, 8, 9);
    const hint = T.fortyFiveSets(board, cgOf(board));
    assert.ok(hint);
    assert.equal(hint.action, "place");
    assert.deepEqual(hint.cells, [[0, 7]]);
    assert.deepEqual(hint.digits, [8]);
    assert.match(hint.explanation, /leaving 8 for it/);
  });

  it("enumerates when the bound is too blunt", () => {
    // Six of row 1 caged at 27, leaving r1c7, r1c8 and r1c9 to make 18. Rub the
    // 8 and 9 out of r1c8 and no bound catches anything — it sums the smallest
    // and largest digits pencilled *anywhere* in the trio, which still spans
    // 1 to 9. Enumerating does: {189} is the only set holding a 1, and it needs
    // r1c8 to take the 8 or the 9 unless the 1 is r1c8's own.
    const board = new Board(undefined, [
      new Cage([[0, 0], [0, 1], [0, 2]], 13),
      new Cage([[0, 3], [0, 4], [0, 5]], 14),
    ]);
    const cg = cgOf(board);
    const trio: Coord[] = [[0, 6], [0, 7], [0, 8]];
    cg.get(idx(0, 7))!.delete(8);
    cg.get(idx(0, 7))!.delete(9);
    for (const cell of trio) {
      assert.equal(T.squeezedOut(cell, trio, cg, 18), null, "a bound would do");
    }

    const hint = T.fortyFiveSets(board, cg);
    assert.ok(hint, "the bound is exhausted; enumeration must pick it up");
    assert.equal(hint.technique, "45-rule (innie set)");
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.cells, [[0, 6]]);
    assert.deepEqual(hint.digits, [1]);
    assert.match(hint.explanation, /not one of them puts 1 in r1c7/);
  });

  it("counts only the leftovers still empty", () => {
    // MAX_LEFTOVER is about unknowns, not about how the cages happen to fall. A
    // five-cell leftover with three digits already written into it is a two-cell
    // problem, and a sharp one — gating on the whole group hid column 6 of
    // board4 completely, where five innies owe 25 and the two still empty owe 7.
    const board = new Board(undefined, [new Cage([[0, 0], [0, 1], [0, 2], [0, 3]], 22)]);
    for (const [c, d] of [[4, 1], [5, 2], [6, 3]] as const) board.setValue(0, c, d);

    const [leftover] = [...T.unaccounted(board, new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]), 45)];
    assert.equal(leftover.cells.size, 5);
    assert.ok(leftover.cells.size > T.MAX_LEFTOVER, "the whole group is over the cap");

    // r1c8 and r1c9 owe 45 - 22 - 6 = 17, so both are 8 or 9.
    const hint = T.fortyFiveSets(board, cgOf(board));
    assert.ok(hint, "a five-cell leftover with three filled must still be read");
    assert.deepEqual(hint.cells, [[0, 7]]);
    assert.deepEqual(hint.digits, [4, 5, 6, 7]);
    assert.match(hint.explanation, /17 once the filled ones are taken off/);
  });

  it("needs the leftovers to share a unit", () => {
    // The bound sums *distinct* digits. Cells that may repeat could total less
    // than it assumes, so the elimination would be unsound and is not offered.
    assert.ok(T.allDistinct([[0, 0], [0, 8]])); // same row
    assert.ok(T.allDistinct([[0, 0], [8, 0]])); // same column
    assert.ok(T.allDistinct([[0, 0], [1, 1], [2, 2]])); // same box
    assert.ok(!T.allDistinct([[0, 0], [1, 3]]));
    assert.ok(!T.allDistinct([[0, 0], [4, 4], [8, 8]]));
  });

  it("never contradicts a known solution", () => {
    // Soundness: SOLUTION satisfies every cage, so each of its digits is
    // possible. The set rule must never eliminate one, nor place against it.
    const solution = Board.fromString(SOLUTION);
    const board = new Board(Board.fromString(EASY).cells, cagesFromSolution());
    const cg = workingCandidates(board);

    for (let i = 0; i < 300; i++) {
      const hint = T.fortyFiveSets(board, cg);
      if (hint === null) break;
      if (hint.action === "place") {
        const [r, c] = hint.cells[0];
        assert.equal(hint.digits[0], solution.value(r, c));
        board.setValue(r, c, hint.digits[0]);
      } else {
        for (const [r, c] of hint.cells) {
          assert.ok(!hint.digits.includes(solution.value(r, c)!), `${r},${c}`);
        }
      }
      applyToCandidates(board, cg, hint);
    }
  });

  it("is the last resort", () => {
    const names = T.TECHNIQUES.map((t) => t.name);
    assert.equal(names[names.length - 1], "fortyFiveSets");
    assert.ok(names.indexOf("fortyFiveRule") < names.indexOf("fortyFiveSets"));
    assert.ok(names.indexOf("nakedPair") < names.indexOf("fortyFiveSets"));
  });
});

// ---------------------------------------------------------------------------
// A whole board, by technique alone
// ---------------------------------------------------------------------------

describe("a board the catalogue has to earn", () => {
  // board4 is a real Killer read mid-solve: four digits placed and the player's
  // own pencil marks everywhere, each one narrower than what the values alone
  // derive. It is uniquely solvable, but the catalogue used to return null on it
  // from the very first hint — a stall that looks exactly like a broken puzzle
  // from the player's chair, which is the failure this file exists to prevent.
  //
  // Nothing here asserts *which* technique fires. The board's own arithmetic
  // decides that, and pinning it would break on every reordering; what has to
  // hold is that the catalogue gets all the way to the end on its own.
  it("solves board4 without the backtracker", () => {
    const board = fixture("puzzle_page_killer_board4");
    assert.equal(board.toWire().cells.filter((c) => c.value !== null).length, 4);

    const run = solveWithTechniques(board, workingCandidates(board));
    assert.ok(run.solved, `stalled with ${run.steps.length} steps taken`);
    assert.ok(run.board.isValid());
  });

  it("agrees with the one solution the board has", () => {
    // Soundness on the board that motivated every change above: technique
    // propagation must land on the answer the search finds, not merely on *an*
    // answer. `solve` cross-checks it against the backtracker.
    const board = fixture("puzzle_page_killer_board4");
    const searched = solve(board);
    assert.ok(searched);

    const run = solveWithTechniques(board, workingCandidates(board));
    // Values only: the two disagree about leftover Pencil marks by design, since
    // the technique run rubs out what it eliminates and the search never does.
    const digits = (b: Board) => b.toWire().cells.map((c) => c.value);
    assert.deepEqual(digits(run.board), digits(searched));
  });

  it("still leans on the Killer techniques to get there", () => {
    // The classic half alone cannot finish this board — if it could, the cage
    // and 45-rule work above would be untested by it and this file would be
    // asserting nothing about Killer.
    const board = fixture("puzzle_page_killer_board4");
    const classic = T.TECHNIQUES.filter(
      (t) => !["cageSum", "fortyFiveRule", "fortyFiveSets"].includes(t.name),
    );
    const cg = workingCandidates(board);
    const work = Board.fromWire(board.toWire());
    for (let i = 0; i < 500; i++) {
      const hint = classic.reduce<T.Hint | null>((found, t) => found ?? t(work, cg), null);
      if (hint === null) break;
      if (hint.action === "place") {
        const [r, c] = hint.cells[0];
        work.setValue(r, c, hint.digits[0]);
      } else {
        // As solveWithTechniques does: mirror the elimination onto the marks too,
        // or the same hint comes back forever.
        for (const [r, c] of hint.cells) {
          for (const d of hint.digits) work.cell(r, c).pencilMarks.delete(d);
        }
      }
      applyToCandidates(work, cg, hint);
    }
    assert.ok(!work.isSolved(), "the classic techniques alone should not finish this");
  });
});

describe("a board that needs cage pointing", () => {
  // board5 is a real Killer read with a single digit placed and the player's own
  // pencil marks everywhere else. Every technique that predates `cagePointing`
  // stalls on it from the very first hint, even though it has a unique solution
  // — the failure this file exists to prevent, same as board4 above, but this
  // time the missing piece was a whole technique rather than an edge case in an
  // existing one.
  it("solves board5 without the backtracker", () => {
    const board = fixture("puzzle_page_killer_board5");
    assert.equal(board.toWire().cells.filter((c) => c.value !== null).length, 1);

    const run = solveWithTechniques(board, workingCandidates(board));
    assert.ok(run.solved, `stalled with ${run.steps.length} steps taken`);
    assert.ok(run.board.isValid());
  });

  it("agrees with the one solution the board has", () => {
    const board = fixture("puzzle_page_killer_board5");
    const searched = solve(board);
    assert.ok(searched);

    const run = solveWithTechniques(board, workingCandidates(board));
    const digits = (b: Board) => b.toWire().cells.map((c) => c.value);
    assert.deepEqual(digits(run.board), digits(searched));
  });

  it("needs cagePointing itself to get past the first hint", () => {
    const board = fixture("puzzle_page_killer_board5");
    const withoutCagePointing = T.TECHNIQUES.filter((t) => t.name !== "cagePointing");
    const stalled = workingCandidates(board);
    const hint = withoutCagePointing.reduce<T.Hint | null>(
      (found, t) => found ?? t(board, stalled),
      null,
    );
    assert.equal(hint, null, "expected every other technique to stall on the first hint");
    assert.equal(findHint(board, workingCandidates(board))?.technique, "Cage pointing");
  });
});
