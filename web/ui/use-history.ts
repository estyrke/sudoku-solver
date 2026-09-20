// The Preact hook that wraps the History core (./history.ts) for a tab. A
// tab holds its state here instead of in a plain `useState`, and gets back
// `record`/`undo`/`redo` alongside it. It does not talk to storage — that
// lands in a later Session-persistence issue; see docs/adr/0005-sessions-
// persist-locally-with-an-undo-history.md.

import { useRef, useState } from "preact/hooks";
import {
  canRedo as coreCanRedo,
  canUndo as coreCanUndo,
  emptyHistory,
  record as coreRecord,
  redo as coreRedo,
  undo as coreUndo,
  type Edit,
  type History,
  type Step,
} from "./history.ts";

export interface UseHistory<S, E extends Edit<S> = Edit<S>> {
  state: S;
  /**
   * Replace the state and discard the History — for an action that replaces
   * the whole board rather than one part of it and isn't an Edit of its own
   * yet (applying a hint step; see issue #50, which made Solve, Clear board
   * and a screenshot import each a single Edit instead of a call to this).
   * Keeping the old History around would be worse than dropping it: its
   * Edits address cells of a board this call is throwing away, and redoing
   * one would splice a stale value onto whatever replaced it.
   */
  reset(state: S): void;
  record(edit: E): void;
  /** Applies the inverse and returns the undone Edit, or `null` if there was none. */
  undo(): E | null;
  /** Reapplies and returns the redone Edit, or `null` if there was none. */
  redo(): E | null;
  canUndo: boolean;
  canRedo: boolean;
}

export function useHistory<S, E extends Edit<S> = Edit<S>>(initial: S): UseHistory<S, E> {
  const [state, setState] = useState(initial);
  const [history, setHistory] = useState<History<S>>(emptyHistory);

  // `undo`/`redo` need the current state and History back the instant they're
  // called — a caller moving the selection off an undone Edit can't wait for
  // the next render — so this ref, refreshed every render, stands in for
  // reading the two `useState`s synchronously.
  const current = useRef({ state, history });
  current.current = { state, history };

  const replace = (state: S, history: History<S>) => {
    current.current = { state, history };
    setState(state);
    setHistory(history);
  };

  /** Undo and redo are the same shape: try to walk one step, commit if there was one. */
  const step = (walk: (history: History<S>, state: S) => Step<S> | null): E | null => {
    const result = walk(current.current.history, current.current.state);
    if (!result) return null;
    replace(result.state, result.history);
    return result.edit as E;
  };

  return {
    state,
    reset(next: S) {
      replace(next, emptyHistory<S>());
    },
    record(edit: E) {
      const result = coreRecord(current.current.history, current.current.state, edit);
      replace(result.state, result.history);
    },
    undo: () => step(coreUndo),
    redo: () => step(coreRedo),
    canUndo: coreCanUndo(history),
    canRedo: coreCanRedo(history),
  };
}
