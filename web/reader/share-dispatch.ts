// Working out which puzzle a shared screenshot is, and reading it as that.
//
// The Android share sheet offers one target but the app has two readers
// (web/reader/read-board.ts and web/reader/killer-board.ts), so something has
// to choose between them. Cage outlines are the tell, and counting them is
// free: the Killer reader has to run first either way, and when the picture
// turns out to be a classic board its answer is simply discarded.
//
// This used to be `/share/parse` on the server, which is why the readings below
// are the wire shapes the tabs already take from a dropped file rather than the
// readers' own objects: the tab that receives a share cannot tell where the
// reading came from, and that is the property worth keeping (ADR 0003). The
// rule itself — Killer first, cage count decides — crossed over unchanged.
//
// Like the readers it calls, this takes decoded pixels and nothing else;
// decoding is the caller's problem (web/reader/decode.ts).

import type { WireBoard } from "../sudoku/model.ts";
import { readClassicBoard } from "./read-board.ts";
import { killerReading, readKillerBoard, type KillerReading } from "./killer-board.ts";
import type { Pixels } from "./pixels.ts";

/** A classic reading in the shape the Sudoku tab's `applyParsed` takes. */
export interface ClassicReading {
  board: WireBoard;
}

/** A reading, tagged with the id of the tab it belongs to. */
export type DispatchedReading =
  | ({ kind: "killer" } & KillerReading)
  | ({ kind: "sudoku" } & ClassicReading);

// A board with no cage outlines still yields the odd stray cage from grid
// artefacts, but never a board's worth of them; a Killer board misread badly
// enough to lose half its cages still finds far more than this. The gap between
// the two is wide, so the threshold does not need to be finely judged — it only
// needs to sit inside it.
export const MIN_KILLER_CAGES = 5;

/**
 * Read a shared screenshot, working out which puzzle it is on the way.
 *
 * Throws if neither reader can make a board of it — a screenshot of something
 * that is not a puzzle at all. The caller turns that into a status line, in the
 * same words a dropped file would have got.
 */
export async function readSharedScreenshot(image: Pixels): Promise<DispatchedReading> {
  const killer = await readKillerBoard(image);
  if (killer.board.cages.length >= MIN_KILLER_CAGES) {
    return { kind: "killer", ...killerReading(killer) };
  }

  const board = await readClassicBoard(image);
  return { kind: "sudoku", board: board.toWire() };
}
