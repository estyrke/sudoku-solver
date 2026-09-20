// The History core: a Session's Edits in order, plus a cursor into them —
// shared shell language, not any one puzzle's domain. See CONTEXT-MAP.md
// under Shell language and docs/adr/0005-sessions-persist-locally-with-an-
// undo-history.md.
//
// Generic over the tab's own Edit type: a Sudoku Cell delta and a Killer Cage
// delta are different shapes, and this module never looks inside either one,
// only calls `apply` or `invert` on it. It is deliberately pure — every
// function takes a History and returns the next one rather than holding
// anything itself — and imports neither Preact nor any browser global. That
// is what lets it be tested at the engine seam (tests/engine/), which runs
// this file straight off its source with no jsdom and no dependencies.
//
// web/ui/use-history.ts is the Preact hook that wraps this for a tab.

/** One undoable thing a player did to a state of type `S`. */
export interface Edit<S> {
  apply(state: S): S;
  invert(state: S): S;
}

/** The Edits recorded so far, and a cursor marking how many are applied. */
export interface History<S> {
  readonly edits: readonly Edit<S>[];
  readonly cursor: number;
}

/** Oldest Edits are dropped once the History holds more than this many. */
export const HISTORY_CAP = 500;

export const emptyHistory = <S>(): History<S> => ({ edits: [], cursor: 0 });

export const canUndo = <S>(history: History<S>): boolean => history.cursor > 0;

export const canRedo = <S>(history: History<S>): boolean =>
  history.cursor < history.edits.length;

/**
 * Record a new Edit and apply it to `state`. Any Edits ahead of the cursor —
 * left there by an earlier undo — are discarded first: the History describes
 * the board in front of the player, not a branch they backed out of. Drops
 * the oldest Edit once the result would exceed the cap.
 */
export function record<S>(
  history: History<S>,
  state: S,
  edit: Edit<S>,
): { history: History<S>; state: S } {
  let edits = [...history.edits.slice(0, history.cursor), edit];
  if (edits.length > HISTORY_CAP) edits = edits.slice(edits.length - HISTORY_CAP);
  return { history: { edits, cursor: edits.length }, state: edit.apply(state) };
}

/** The result of walking the cursor one step: the new History and state, plus
 *  which Edit was inverted (undo) or reapplied (redo). */
export interface Step<S> {
  history: History<S>;
  state: S;
  edit: Edit<S>;
}

/** Walk the cursor back one Edit and invert it. `null` with nothing to undo. */
export function undo<S>(history: History<S>, state: S): Step<S> | null {
  if (!canUndo(history)) return null;
  const edit = history.edits[history.cursor - 1];
  return { history: { ...history, cursor: history.cursor - 1 }, state: edit.invert(state), edit };
}

/** Walk the cursor forward one Edit and reapply it. `null` with nothing to redo. */
export function redo<S>(history: History<S>, state: S): Step<S> | null {
  if (!canRedo(history)) return null;
  const edit = history.edits[history.cursor];
  return { history: { ...history, cursor: history.cursor + 1 }, state: edit.apply(state), edit };
}
