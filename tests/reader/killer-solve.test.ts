// Reading and solving a Killer screenshot, start to finish, within budget.
//
// Reading and solving both run in the browser now, so this is the whole path
// a player takes: decode -> read -> solve. tests/engine/solver.test.ts pins
// the solve half alone, against boards already read (tests/fixtures/
// killer_boards); this drives the same boards through the actual reader
// first, so a regression that makes *reading* slow — not just solving —
// fails here too, the way it would have failed the single read-and-solve test
// this reader used to be part of before the reader moved server-side and then
// into the browser.

import test from "node:test";
import assert from "node:assert/strict";

import { readKillerBoard } from "../../web/reader/killer-board.ts";
import { solve } from "../../web/sudoku/solver.ts";
import { decodePngFile } from "./png.ts";

const REFERENCE = [
  "puzzle_page_killer_sample_board",
  "puzzle_page_killer_board2",
  "puzzle_page_killer_board3",
  "puzzle_page_killer_board4",
  "puzzle_page_killer_board5",
];

test("every reference screenshot reads and solves, within budget", async () => {
  for (const name of REFERENCE) {
    const started = performance.now();

    const read = await readKillerBoard(decodePngFile(new URL(`../fixtures/${name}.png`, import.meta.url)));
    assert.ok(read.checksumOk && !read.needsReview, `${name}: misread (sums total ${read.sumTotal})`);

    const solved = solve(read.board);
    const elapsed = performance.now() - started;

    assert(solved, `${name} came out unsolvable`);
    assert.ok(solved.isSolved(), name);
    for (const cage of solved.cages) {
      const total: number = cage.cells.reduce((n, [r, c]) => n + solved.value(r, c)!, 0);
      assert.equal(total, cage.sum, `${name}: the ${cage.sum}-cage totals ${total}`);
    }
    // The same 3s-per-board solve ceiling as tests/engine/solver.test.ts, plus
    // room for the read itself — see that file for why 3s and not board4's
    // ~1s observed worst case. Reading is a few hundred milliseconds more; a
    // shared, busy CI runner is the reason for the wide margin, not the reader
    // being slow on a developer's machine.
    assert.ok(elapsed < 5000, `${name} took ${(elapsed / 1000).toFixed(1)}s`);
  }
});
