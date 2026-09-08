// Check the board against its own solution and report the player's mistakes.
//
// This is not a solving technique — it is the answer to "why is nothing
// working?", which the technique catalogue cannot give. Three states look
// identical from the player's chair, and only one of them means the catalogue is
// genuinely out of ideas:
//
// *A digit is entered wrong.* If it merely disagrees with the solution rather
// than repeating in a unit, nothing flags it. The board becomes unsolvable and
// Solve blames the cage sums, which is the wrong place to look.
//
// *A pencil mark is missing.* The engine reasons over the player's marks
// intersected with what is legal (`workingCandidates`), so rubbing out a mark
// silently deletes a true candidate. Every later deduction is then made in a
// world where that digit does not exist — the engine will happily "prove"
// something false, or stall exactly like an exhausted catalogue. This is the
// dangerous one, because nothing about it looks like an error.
//
// *The cages don't pin the board down.* More than one solution usually means a
// cage sum was misread. It also makes the pencil-mark check unsafe, since a
// digit absent from one solution may be needed by another, so that check is
// skipped.
//
// Naming policy: a wrong entry is the player's own and gets named outright. A
// missing mark names the cell but never the digit — the digit *is* the answer
// for that cell, and a hint engine that blurts it out has stopped being one.

import { Board, DIGITS, N, cellName, rc, type Coord } from "./model.ts";
import { solutions } from "./solver.ts";

/** 405: nine units of 1-9, partitioned into cages. */
const FULL_TOTAL = DIGITS.reduce((a, b) => a + b, 0) * N;

export type Verdict = "ok" | "incomplete" | "wrong-cage" | "wrong-value" | "missing-mark" | "ambiguous";

/** What is wrong with the board, if anything. `cells` are the ones to look at. */
export interface Audit {
  verdict: Verdict;
  cells: Coord[];
  message: string;
  clean: boolean;
}

/** An audit in the shape the page uses, where a Cell is `{r, c}`. */
export interface WireAudit {
  verdict: Verdict;
  cells: { r: number; c: number }[];
  message: string;
}

export function auditToWire(report: Audit): WireAudit {
  return {
    verdict: report.verdict,
    cells: report.cells.map(([r, c]) => ({ r, c })),
    message: report.message,
  };
}

function report(verdict: Verdict, cells: Coord[], message: string): Audit {
  return { verdict, cells, message, clean: verdict === "ok" };
}

function placed(board: Board): Coord[] {
  const out: Coord[] = [];
  for (let i = 0; i < N * N; i++) {
    const [r, c] = rc(i);
    if (board.value(r, c) !== null) out.push([r, c]);
  }
  return out;
}

function without(board: Board, cell: Coord): Board {
  const cleared = Board.fromWire(board.toWire());
  cleared.setValue(cell[0], cell[1], null);
  return cleared;
}

/** Entered cells that, cleared one at a time, make the board solvable again. */
function blame(board: Board): Coord[] {
  return placed(board).filter((cell) => solutions(without(board, cell), 1).length > 0);
}

function names(cells: Coord[]): string {
  return cells.map(([r, c]) => cellName(r, c)).join(", ");
}

/**
 * The 45-per-unit check, which localises a misread sum for free.
 *
 * Worth asking before anything else: it is arithmetic rather than search, and it
 * separates "a cage sum is wrong" from "a digit you entered is wrong", which the
 * solver on its own cannot tell apart.
 */
function checksumOff(board: Board): Audit | null {
  if (board.cages.length === 0 || !board.isFullyCaged()) return null;
  const total = board.cages.reduce((n, cage) => n + cage.sum, 0);
  if (total === FULL_TOTAL) return null;
  const off = total - FULL_TOTAL;
  return report(
    "wrong-cage",
    board.cages.map((cage) => cage.anchor),
    `The cage sums total ${total}, but every cell is in a cage and each of ` +
      `the nine rows holds 1-9, so they have to total ${FULL_TOTAL}. At least ` +
      `one sum is ${Math.abs(off)} too ${off > 0 ? "high" : "low"} — fix that ` +
      `before trusting anything else here.`,
  );
}

/** Diagnose the board. Cheap enough to run before every hint. */
export function audit(board: Board): Audit {
  if (board.cages.length > 0 && !board.isFullyCaged()) {
    // Mid-way through drawing the cages, every verdict below would be an
    // artefact of the ones not drawn yet. Say nothing rather than something
    // wrong; hints still work off what is there.
    return report(
      "incomplete",
      [],
      "Some cells aren't in a cage yet, so there's nothing to check against.",
    );
  }

  const badSum = checksumOff(board);
  if (badSum !== null) return badSum;

  const found = solutions(board, 2);

  if (found.length > 1) {
    return report(
      "ambiguous",
      [],
      "This board has more than one solution, so " +
        (board.cages.length > 0
          ? "the cages aren't pinning it down — check the cage sums against " +
            "the screenshot."
          : "there isn't enough on it to determine one answer.") +
        " Until that's fixed a hint may point somewhere the puzzle doesn't " +
        "actually go.",
    );
  }

  if (found.length === 0) {
    const entered = placed(board);
    if (entered.length === 0) {
      return report(
        "wrong-value",
        [],
        "No arrangement of digits satisfies these cages, and nothing has " +
          "been entered yet — so a cage sum or a cage outline is wrong.",
      );
    }
    const suspects = blame(board);
    if (suspects.length === 0) {
      return report(
        "wrong-value",
        entered,
        "This board has no solution, and no single entry explains it — at " +
          "least two of the digits you've entered are wrong, or a cage sum " +
          "is. Clearing the ones you're least sure of is the way back.",
      );
    }
    if (suspects.length === 1) {
      return report(
        "wrong-value",
        suspects,
        `${names(suspects)} is wrong — clear it and the board solves. ` +
          "Everything deduced from it since is suspect too.",
      );
    }
    return report(
      "wrong-value",
      suspects,
      `One of ${names(suspects)} is wrong: clearing any one of them on its ` +
        "own makes the board solvable again, so they can't all be right.",
    );
  }

  const answer = found[0];
  const rubbedOut: Coord[] = [];
  for (let i = 0; i < N * N; i++) {
    const [r, c] = rc(i);
    const marks = board.cell(r, c).pencilMarks;
    if (board.value(r, c) === null && marks.size > 0 && !marks.has(answer.value(r, c)!)) {
      rubbedOut.push([r, c]);
    }
  }
  if (rubbedOut.length > 0) {
    return report(
      "missing-mark",
      rubbedOut,
      `${names(rubbedOut)} ${rubbedOut.length === 1 ? "is" : "are"} ` +
        `missing a pencil mark the solution needs. The engine only ever ` +
        `considers digits you've pencilled, so a rubbed-out mark takes the ` +
        `real answer off the table — which is why nothing further follows. ` +
        `(Not saying which digit: that would be the answer.)`,
    );
  }

  return report("ok", [], "No mistakes found — the board is consistent.");
}
