// The Killer reader, end to end, against the boards the Python reader
// produces from the same screenshots.
//
// This is the parity gate. The fixtures are committed pixels and the reads
// beside them are committed JSON, both already pinned by tests/test_reader.py
// (tests/fixtures/killer_boards/*.json) — so this asserts the ported pipeline
// agrees with the one it was ported from, cage by cage and sum by sum, rather
// than merely agreeing with itself.
//
// Ported from tests/test_reader.py's Killer section, docstrings and all: each
// of these exists because a real screenshot broke in a specific way, and the
// explanation is the more useful half. Four of them are named regressions —
// the cage outline that read as a leading 1, the italic 1 that classified as
// a 7, the open-topped 4 that classified as a 9, and the board frame hairline
// that invented Pencil marks — and they are the tests most likely to look
// like implementation detail and be dropped during a port, which is exactly
// why they keep their own names here.
//
// Everything here runs against the same committed OpenCV.js artifact the
// browser loads, and every fixture is decoded by the small PNG decoder next
// door, because the reader's own contract is that decoding is not its job.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { Board, Cage } from "../../web/sudoku/model.ts";
import { KillerRead, readKillerBoard } from "../../web/reader/killer-board.ts";
import { decodePngFile } from "./png.ts";

const FIXTURE = (name: string) => new URL(`../fixtures/${name}.png`, import.meta.url);
const PINNED = (name: string) => new URL(`../fixtures/killer_boards/${name}.json`, import.meta.url);

const SAMPLE = "puzzle_page_killer_sample_board";
const BOARD2 = "puzzle_page_killer_board2";
const BOARD3 = "puzzle_page_killer_board3";
const BOARD4 = "puzzle_page_killer_board4";
const BOARD5 = "puzzle_page_killer_board5";
const BOARD6 = "puzzle_page_killer_board6";
const REFERENCE = [SAMPLE, BOARD2, BOARD3, BOARD4, BOARD5, BOARD6];

/** Every fixture, read once — many tests ask about the same board. */
const reading = new Map<string, Promise<KillerRead>>();
function readFixture(name: string): Promise<KillerRead> {
  let read = reading.get(name);
  if (!read) {
    read = readKillerBoard(decodePngFile(FIXTURE(name)));
    reading.set(name, read);
  }
  return read;
}

/** `{ min(cage.cells): cage.sum }`, the shape every board-layout test below
 *  pins its cages against — Python's `{min(c.cells): c.sum for c in ...}`. */
function sumsByAnchor(board: Board): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cage of board.cages) out[cage.anchor.join(",")] = cage.sum;
  return out;
}

test("the sample board recovers the cage layout", async () => {
  // The reference board has 29 cages tiling all 81 cells. Cage structure comes
  // from the coloured outlines, so this is the part that must be exact.
  const { board } = await readFixture(SAMPLE);
  const covered = board.cages.reduce((n, cage) => n + cage.cells.length, 0);

  assert.equal(board.cages.length, 29, `got ${board.cages.length} cages`);
  assert.equal(covered, 81, `only ${covered}/81 cells covered`);
  assert.ok(board.isFullyCaged());
  assert.ok(board.cages.every((cage) => cage.cells.length >= 2 && cage.cells.length <= 9));
});

test("the sample board recovers every cage sum exactly", async () => {
  // This was 27/29 until the crop was widened and cage outlines were excluded
  // by shape rather than by dodging them.
  const { board } = await readFixture(SAMPLE);
  assert.deepEqual(
    sumsByAnchor(board),
    {
      "0,0": 15, "0,3": 15, "0,6": 26, "0,7": 10, "0,8": 5, "1,0": 15,
      "1,2": 11, "2,0": 19, "2,2": 8, "2,4": 18, "2,6": 8, "2,8": 14,
      "3,3": 16, "3,6": 10, "4,0": 27, "4,5": 5, "4,7": 30, "5,1": 12,
      "5,3": 23, "5,5": 7, "6,0": 13, "6,5": 23, "7,0": 13, "7,3": 14,
      "7,4": 7, "7,6": 4, "7,8": 14, "8,1": 11, "8,6": 12,
    },
  );
});

test("the sample board's cage sum does not leak into its Pencil marks", async () => {
  // r1c1 shows a 15-cage sum above marks 1,2,3,5,6,7,8. The sum must not leak
  // into the marks, and the marks must not come out shifted.
  const { board } = await readFixture(SAMPLE);
  assert.deepEqual([...board.cell(0, 0).pencilMarks].sort((a, b) => a - b), [1, 2, 3, 5, 6, 7, 8]);
});

test("the sample board reads its placed digits, none of them Givens", async () => {
  const { board } = await readFixture(SAMPLE);
  const placed = board.cells.filter((cell) => cell.value !== null);
  assert.ok(placed.length >= 12, `only ${placed.length} placed digits found`);
  // Killer boards start empty, so nothing is a given.
  assert.ok(!board.cells.some((cell) => cell.isGiven));
});

test("the sample board flags what it is unsure about, at real coordinates", async () => {
  // A sum that reads illegally for its cage size is reported, not silently
  // accepted — the UI highlights these for correction.
  const { unsure } = await readFixture(SAMPLE);
  assert.ok(unsure.every(([r, c]) => r >= 0 && r < 9 && c >= 0 && c < 9));
});

test("the sample board is a usable Board", async () => {
  const { board } = await readFixture(SAMPLE);
  assert.ok(board instanceof Board);
  assert.equal(board.cells.length, 81);
  for (const cage of board.cages) assert.ok(cage.cells.length >= 2);
});

test("every reference board is fully caged with a clean 405 checksum", async () => {
  for (const name of REFERENCE) {
    const read = await readFixture(name);
    assert.ok(read.board.isFullyCaged(), name);
    assert.equal(read.sumTotal, 405, `${name}: ${read.sumTotal}`);
    assert.ok(read.checksumOk && !read.needsReview, name);
  }
});

test("a second, entirely different cage layout reads exactly", async () => {
  // 25 cages rather than 29, so the outline segmentation isn't just fitting
  // the one board.
  const { board } = await readFixture(BOARD2);
  assert.equal(board.cages.length, 25);
  assert.equal(board.cages.reduce((n, c) => n + c.cells.length, 0), 81);
  assert.deepEqual(
    sumsByAnchor(board),
    {
      "0,0": 21, "0,1": 15, "0,4": 8, "0,5": 21, "0,6": 17, "1,1": 21, "1,3": 9, "1,7": 31,
      "2,4": 7, "3,1": 22, "3,3": 12, "3,5": 16, "3,8": 10, "4,2": 15, "4,3": 17, "4,6": 5,
      "5,0": 4, "5,6": 36, "5,7": 15, "6,0": 13, "6,2": 27, "6,8": 21, "7,0": 9, "7,2": 15,
      "7,3": 18,
    },
  );
});

test("a cage outline is not read as a leading 1", async () => {
  // Regression: a cage's left outline clipped into the sum crop as a 1px-wide
  // sliver, which passed the size filters and — being a tall thin stroke —
  // classified as a 1, turning r8c1's 9 into a 19.
  const { board } = await readFixture(BOARD2);
  assert.equal(sumsByAnchor(board)["7,0"], 9, "leading-1 sliver is back");
});

test("the checksum passes on cages built from a real solution", async () => {
  // Sanity-check the checksum itself: cages built from a real solution total
  // 405. No screenshot involved — this is a pure model check.
  const solved = Board.fromString(
    "534678912672195348198342567859761423426853791713924856961537284287419635345286179",
  );
  const spans: [number, number][] = [[0, 2], [2, 4], [4, 6], [6, 9]];
  const cages: Cage[] = [];
  for (let r = 0; r < 9; r++) {
    for (const [a, b] of spans) {
      let total = 0;
      const coords: [number, number][] = [];
      for (let c = a; c < b; c++) {
        coords.push([r, c]);
        total += solved.value(r, c)!;
      }
      cages.push(new Cage(coords, total));
    }
  }
  const read = new KillerRead(new Board(undefined, cages), [], cages.reduce((n, c) => n + c.sum, 0));
  assert.equal(read.sumTotal, 405);
  assert.ok(read.checksumOk);
  assert.ok(!read.needsReview);
});

test("every reference board matches its committed read", async () => {
  // Pins each reference screenshot to the board the reader produces from it.
  // The solving half of this check lives in tests/engine/solver.test.ts,
  // which loads exactly these files; comparing the live read against them is
  // what keeps the two halves talking about the same boards — a reader
  // change that alters a digit or a cage sum fails here rather than silently
  // leaving the engine's fixtures describing a board nobody reads any more.
  for (const name of REFERENCE) {
    const { board } = await readFixture(name);
    const committed = JSON.parse(await readFile(PINNED(name), "utf8"));
    assert.deepEqual(
      board.toWire(),
      committed,
      `${name} no longer reads as its pinned file has it; regenerate both if the new read is the correct one`,
    );
  }
});

test("a third cage layout, 28 cages, every sum exact", async () => {
  const { board } = await readFixture(BOARD3);
  assert.equal(board.cages.length, 28);
  assert.equal(board.cages.reduce((n, c) => n + c.cells.length, 0), 81);
  assert.deepEqual(
    sumsByAnchor(board),
    {
      "0,0": 18, "0,1": 10, "0,3": 7, "0,4": 18, "0,6": 6, "0,8": 25, "1,4": 11, "2,0": 9,
      "2,1": 14, "2,2": 20, "2,6": 9, "2,8": 19, "3,3": 8, "3,5": 18, "3,7": 32, "4,0": 17,
      "4,2": 12, "5,1": 14, "5,4": 17, "6,0": 6, "6,1": 6, "6,3": 8, "6,5": 13, "6,6": 20,
      "6,8": 24, "7,1": 17, "8,0": 16, "8,4": 11,
    },
  );
});

test("the app's italic 1 reads as a 1, not a 7", async () => {
  // Regression: Puzzle Page sets its digits in an italic face, and an italic
  // 1 — a stroke leaning right off a short flag — is structurally a 7.
  // Against upright Hershey exemplars the 7 won by 0.615 to 0.603 and two of
  // these three read as 7s. Slanted copies of every exemplar settle it.
  const { board } = await readFixture(BOARD3);
  const ones: [number, number][] = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (board.value(r, c) === 1) ones.push([r, c]);
  assert.deepEqual(ones, [[6, 7], [7, 0], [8, 3]], `expected three 1s, got ${JSON.stringify(ones)}`);
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) assert.notEqual(board.value(r, c), 7);
});

test("a fourth board layout, #5241, 29 cages, every sum exact", async () => {
  const { board } = await readFixture(BOARD4);
  assert.equal(board.cages.length, 29);
  assert.equal(board.cages.reduce((n, c) => n + c.cells.length, 0), 81);
  assert.deepEqual(
    sumsByAnchor(board),
    {
      "0,0": 10, "0,2": 21, "0,5": 21, "0,6": 9, "0,7": 10, "1,0": 10, "1,2": 11, "1,8": 20,
      "2,0": 12, "2,3": 10, "2,5": 15, "3,1": 10, "3,4": 12, "3,7": 12, "4,0": 22, "4,3": 15,
      "4,4": 11, "4,5": 9, "4,8": 12, "5,1": 15, "5,5": 20, "5,6": 4, "5,7": 9, "6,0": 17,
      "6,3": 17, "7,1": 15, "7,6": 16, "8,1": 20, "8,6": 20,
    },
  );
});

test("a fifth board layout, #5284, 27 cages, every sum exact", async () => {
  // This is the board that motivated `cagePointing` in the TypeScript
  // catalogue (tests/engine/techniques.test.ts): the classic and prior Killer
  // techniques alone stall on it from the first hint, even though it has a
  // unique solution.
  const { board } = await readFixture(BOARD5);
  assert.equal(board.cages.length, 27);
  assert.equal(board.cages.reduce((n, c) => n + c.cells.length, 0), 81);
  assert.deepEqual(
    sumsByAnchor(board),
    {
      "0,0": 22, "0,3": 30, "0,7": 4, "1,0": 17, "1,2": 23, "1,4": 24, "1,7": 16, "2,6": 14,
      "2,7": 12, "3,0": 22, "3,4": 11, "4,2": 15, "4,5": 6, "4,6": 12, "4,8": 24, "5,0": 15,
      "5,2": 16, "5,4": 10, "5,7": 10, "6,1": 6, "6,5": 13, "7,1": 14, "7,2": 12, "7,3": 14,
      "7,4": 11, "7,5": 21, "7,7": 11,
    },
  );
});

test("a sixth cage layout, 30 cages, every sum exact", async () => {
  // This is the board that lifted the cell-count cap off the 45-rule's set
  // analysis (tests/engine/techniques.test.ts): every technique in the
  // catalogue stalled on it from the first hint, the cap being all that hid
  // the five outies of rows 7-9 owing 34 between them.
  const { board } = await readFixture(BOARD6);
  assert.equal(board.cages.length, 30);
  assert.equal(board.cages.reduce((n, c) => n + c.cells.length, 0), 81);
  assert.deepEqual(
    sumsByAnchor(board),
    {
      "0,0": 10, "0,2": 8, "0,3": 23, "0,6": 18, "0,7": 10, "1,0": 9, "1,3": 22, "1,4": 15,
      "1,7": 13, "1,8": 4, "2,0": 11, "2,1": 12, "3,5": 12, "3,6": 24, "4,0": 11, "4,2": 9,
      "4,4": 4, "4,6": 7, "4,8": 14, "5,0": 14, "5,1": 15, "5,2": 13, "5,3": 15, "5,5": 10,
      "6,4": 33, "6,6": 8, "6,8": 11, "7,0": 24, "7,6": 8, "8,6": 18,
    },
  );
});

test("the app's 6 is not confused for a 5", async () => {
  // Regression: Puzzle Page's cage-sum 6 is a tight loop under a small, high
  // top curl, which at ~16px cross-correlated to a Hershey 5 better than to a
  // Hershey 6 (0.845 to 0.834) — the r8c7 16-cage of board #5241 misread as
  // 15, a mistake dishonest enough to look like a genuine player error rather
  // than a parse fault.
  const { board } = await readFixture(BOARD4);
  assert.equal(sumsByAnchor(board)["7,6"], 16, "5/6 confusion is back");
});

test("the third board's whole pen grid reads exactly", async () => {
  // The digit counts the app prints under its keypad (three 1s, three 2s, one
  // 3, two 4s, ...) add up to these thirteen.
  const { board } = await readFixture(BOARD3);
  const placed: Record<string, number> = {};
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = board.value(r, c);
      if (v !== null) placed[`${r},${c}`] = v;
    }
  }
  assert.deepEqual(placed, {
    "2,3": 9, "3,3": 6, "3,4": 2, "5,4": 4, "6,0": 5, "6,3": 3,
    "6,7": 1, "7,0": 1, "7,3": 4, "7,6": 2, "8,3": 1, "8,4": 9,
    "8,5": 2,
  });
});

test("the board frame is not read as Pencil marks", async () => {
  // Regression: in the bottom-right cell the outer frame sits closest to the
  // border crop and survived it as a full-width, one-pixel-tall hairline.
  // Spread across the three bottom sub-cells it cleared the ink threshold on
  // its own, inventing marks the player never wrote.
  const board3 = (await readFixture(BOARD3)).board;
  assert.deepEqual([...board3.cell(8, 8).pencilMarks].sort((a, b) => a - b), [5, 8]);

  const board2 = (await readFixture(BOARD2)).board;
  assert.deepEqual(
    [...board2.cell(8, 8).pencilMarks].sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 9],
  );
});

test("the app's open-topped 4 reads as a 4, not a 9", async () => {
  // Regression: the app draws 4 with an open apex, which cross-correlates to
  // a closed-apex Hershey 9 better than to its 4, so every large 4 read as a
  // 9. A wrong value is worse than a wrong cage sum — it makes the engine
  // deduce things that are simply false.
  const { board } = await readFixture(SAMPLE);
  const fours: [number, number][] = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (board.value(r, c) === 4) fours.push([r, c]);
  assert.deepEqual(fours, [[7, 4], [8, 0]], `expected 4s at r8c5 and r9c1, got ${JSON.stringify(fours)}`);
});
