// Alternating inference chains: the catalogue's answer to a board that stalls
// past X-Wing (issue #61).
//
// Every elimination a chain makes is checked against the board's unique
// solution, not just against the coordinates a test expects. A chain built with
// its parity inverted still finds eliminations — some of them even right — and
// only the solution tells the sound ones from the lucky ones.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { Board, Cage, idx } from "../../web/sudoku/model.ts";
import * as T from "../../web/sudoku/techniques.ts";
import type { CandGrid, Hint } from "../../web/sudoku/techniques.ts";
import {
  applyToCandidates,
  derivedCandidates,
  findHint,
  nudge,
  solveWithTechniques,
} from "../../web/sudoku/hint.ts";
import { solutions } from "../../web/sudoku/solver.ts";

/** Sudoku #11462, read from a phone screenshot: the board issue #61 was filed
 * over. Classic, one solution, and the catalogue up to X-Wing stalls on it
 * after two Pointing steps with 41 Cells still empty. */
const classic = (name: string): string =>
  readFileSync(path.join(import.meta.dirname, "..", "fixtures", "classic_boards", name), "utf8").trim();

const REFERENCE = classic("sudoku_11462.txt");

/** The one solution `board` has — asserted, since a sound elimination can still
 * remove a digit from *a* solution when there is more than one. */
function uniqueSolution(board: Board): Board {
  const found = solutions(board, 2);
  assert.equal(found.length, 1, "the fixture must have exactly one solution");
  return found[0];
}

/** Fail if `hint` removes or places anything the solution disagrees with. */
function assertSound(hint: Hint, solution: Board): void {
  if (hint.action === "place") {
    const [r, c] = hint.cells[0];
    assert.equal(hint.digits[0], solution.value(r, c), `${hint.technique} placed wrongly at r${r + 1}c${c + 1}`);
    return;
  }
  for (const [r, c] of hint.cells) {
    assert.ok(
      !hint.digits.includes(solution.value(r, c)!),
      `${hint.technique} removed the solution's ${solution.value(r, c)} from r${r + 1}c${c + 1}:\n${hint.explanation}`,
    );
  }
}

/** The position the catalogue stalls in without chains: the reference board
 * after its two Pointing steps. */
function stalled(): { board: Board; cg: CandGrid } {
  const board = Board.fromString(REFERENCE);
  const cg = derivedCandidates(board);
  const simpler = T.TECHNIQUES.filter((t) => t !== T.chain);
  for (;;) {
    const hint = simpler.reduce<Hint | null>((found, t) => found ?? t(board, cg), null);
    if (hint === null) break;
    assert.equal(hint.technique, "Pointing pair/triple");
    applyToCandidates(board, cg, hint);
  }
  return { board, cg };
}

describe("chain on the reference board", () => {
  it("is where the catalogue up to X-Wing stalls", () => {
    const { cg } = stalled();
    assert.equal(cg.size, 41);
  });

  it("finds the X-chain on 1 that removes 1 from r1c4", () => {
    const { board, cg } = stalled();
    const hint = T.chain(board, cg);
    assert.ok(hint);
    assert.equal(hint.technique, "X-chain");
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.cells, [[0, 3]]);
    assert.deepEqual(hint.digits, [1]);
    assertSound(hint, uniqueSolution(board));
  });

  it("walks the chain link by link, in prose", () => {
    const { board, cg } = stalled();
    const { explanation } = T.chain(board, cg)!;
    // The four nodes, in the order the argument visits them.
    const order = ["r1c8", "r7c8", "r7c5", "r8c4"].map((name) => explanation.indexOf(name));
    assert.ok(order.every((at) => at >= 0), explanation);
    assert.deepEqual([...order].sort((a, b) => a - b), order, explanation);
    // Each strong link names the unit that makes it one.
    assert.match(explanation, /column 8/);
    assert.match(explanation, /row 7/);
    assert.match(explanation, /box 8/);
    // And the conclusion: both ends, and who sees them.
    assert.match(explanation, /r1c4/);
    assert.match(explanation, /r1c8 or r8c4/);
  });

  it("is what findHint offers there", () => {
    const { board, cg } = stalled();
    assert.equal(findHint(board, cg)?.technique, "X-chain");
  });

  it("points the nudge at where the chain starts, not at a cell it clears", () => {
    const { board, cg } = stalled();
    assert.equal(nudge(T.chain(board, cg)!), "Look at the 1s in column 8.");
  });

  it("finishes the board, every step agreeing with the solution", () => {
    const board = Board.fromString(REFERENCE);
    const solution = uniqueSolution(board);
    const run = solveWithTechniques(board, derivedCandidates(board));
    for (const step of run.steps) assertSound(step, solution);
    assert.ok(run.solved, `stalled after ${run.steps.length} steps`);
    assert.ok(run.steps.filter((s) => s.level === 8).length > 1, "expected more than one chain");
    const digits = (b: Board) => b.toWire().cells.map((c) => c.value);
    assert.deepEqual(digits(run.board), digits(solution));
  });
});

// Boards with one solution each that the catalogue up to X-Wing stalls on,
// generated by digging clues out of a shuffled grid for as long as the answer
// stayed unique, then kept when chains had to carry them. They exist to drive
// the search into every shape of conclusion it can draw — same digit at both
// ends, both ends in one Cell, two digits in two Cells that see each other —
// and to check each one against the answer.
const HARD = [
  "200005010709003650000720009000030000400200300003050960800060430050000008300002000",
  "010069008000302000000000006005048700000200000200500000590000070700080940000006800",
  "000008003010007080089002061008010007200600000000005000090000620001070000400500070",
  "300520060400000000510908030000006003060001000205400000000100950007002008100080000",
  "000000000000940805030000470840005020002300009053600700200000301090000004005810000",
  "430002061090007028070000500080000100501000003900000080020070400007081000000020000",
  // Chains take this one some way and then run out, which is fine: every step
  // they do take still has to be right. The audit's own tests stall on it too.
  classic("chains_stall.txt"),
];

/** Which of the three conclusions a chain hint drew, read off its wording. */
function shape(hint: Hint): string {
  if (/at least one of them/.test(hint.explanation)) return "same digit";
  if (/Were r\dc\d/.test(hint.explanation)) return "two cells";
  return "one cell";
}

describe("chain soundness", () => {
  for (const puzzle of HARD) {
    it(`never contradicts the solution of ${puzzle.slice(0, 9)}…`, () => {
      const board = Board.fromString(puzzle);
      const solution = uniqueSolution(board);
      const run = solveWithTechniques(board, derivedCandidates(board));
      assert.ok(run.steps.some((s) => s.level === 8), "expected the board to need a chain");
      for (const step of run.steps) assertSound(step, solution);
    });
  }

  it("draws every shape of conclusion somewhere in the sweep", () => {
    const shapes = new Set<string>();
    const techniques = new Set<string>();
    for (const puzzle of [REFERENCE, ...HARD]) {
      const board = Board.fromString(puzzle);
      for (const step of solveWithTechniques(board, derivedCandidates(board)).steps) {
        if (step.level !== 8) continue;
        shapes.add(shape(step));
        techniques.add(step.technique);
      }
    }
    assert.deepEqual([...shapes].sort(), ["one cell", "same digit", "two cells"]);
    assert.deepEqual([...techniques].sort(), ["Alternating inference chain", "X-chain", "XY-chain"]);
  });
});

describe("chain on a hand-built grid", () => {
  // An XY-Wing, written as the chain it is. r1c1 is 1 or 2; either way one of
  // r1c5 and r5c1 is 3, and r5c5 sees both. Every other Cell carries 5-9, so
  // no digit 1-4 forms a strong link the argument doesn't mean — and r9c5 and
  // r5c9 take a 3 too, or column 5 and row 5 would each have only two places
  // for it, and the shortest chain would run the wing the other way round.
  function xyWing(): CandGrid {
    const cg: CandGrid = new Map();
    for (let i = 0; i < 81; i++) cg.set(i, new Set([5, 6, 7, 8, 9]));
    cg.set(idx(0, 0), new Set([1, 2]));
    cg.set(idx(0, 4), new Set([1, 3]));
    cg.set(idx(4, 0), new Set([2, 3]));
    for (const [r, c] of [[4, 4], [8, 4], [4, 8]]) cg.set(idx(r, c), new Set([3, 5, 6, 7, 8, 9]));
    return cg;
  }

  it("removes 3 from the cell that sees both wings", () => {
    const hint = T.chain(new Board(), xyWing());
    assert.ok(hint);
    assert.equal(hint.action, "eliminate");
    assert.deepEqual(hint.cells, [[4, 4]]);
    assert.deepEqual(hint.digits, [3]);
  });

  it("links two Cage-mates weakly, and says it was the Cage", () => {
    // r3c3 and r4c4 share no row, column or box, only the Cage — the one weak
    // link out of r3c3 that is not back to r1c3. So: if r1c3 is not 1, column 3
    // puts it in r3c3, the Cage keeps it out of r4c4, row 4 puts it in r4c8 —
    // and r1c8, in row 1 with one end and column 8 with the other, is not 1.
    // (That same loop makes r1c3 a 1 outright; the chain takes the shorter
    // elimination.)
    const board = new Board(undefined, [new Cage([[2, 2], [2, 3], [3, 3]], 6)]);
    const cg: CandGrid = new Map();
    for (let i = 0; i < 81; i++) cg.set(i, new Set([5, 6, 7, 8, 9]));
    // r1c5 takes a 1 as well so row 1 is no strong link; otherwise the chain
    // runs along it instead of through the Cage.
    for (const [r, c] of [[0, 2], [0, 4], [2, 2], [3, 3], [3, 7], [0, 7]]) {
      cg.set(idx(r, c), new Set([1, 5, 6]));
    }
    const hint = T.chain(board, cg);
    assert.ok(hint);
    assert.deepEqual(hint.cells, [[0, 7]]);
    assert.deepEqual(hint.digits, [1]);
    assert.match(hint.explanation, /r4c4, which shares the 6-cage at r3c3 with r3c3, is not 1/);
  });

  it("is quiet when there is no chain to follow", () => {
    const cg: CandGrid = new Map();
    for (let i = 0; i < 81; i++) cg.set(i, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    assert.equal(T.chain(new Board(), cg), null);
  });
});

describe("chain in the catalogue", () => {
  it("comes last, after X-Wing and the 45-rule sets", () => {
    assert.equal(T.TECHNIQUES.at(-1), T.chain);
    const names = T.TECHNIQUES.map((t) => t.name);
    assert.ok(names.indexOf("xWing") < names.indexOf("chain"));
  });

  it("carries a higher level than anything before it", () => {
    const { board, cg } = stalled();
    assert.equal(T.chain(board, cg)!.level, 8);
  });
});
