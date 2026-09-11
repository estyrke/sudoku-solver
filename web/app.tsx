// The puzzle-type shell: the list of puzzle types, the tab bar, and the mount.
//
// Adding a puzzle type is three steps and no edits anywhere else:
//
//   1. Write `web/<name>.tsx` exporting a `PuzzleType`, composing its UI from
//      the shared components in `web/ui/`.
//   2. Import it here.
//   3. Add it to `PUZZLES`.
//
// Every panel is rendered and stays mounted for the life of the page; a tab
// switch only flips `hidden`. That is deliberate — unmounting would throw away
// the board the player has been filling in, which is exactly what they expect
// to find when they come back. It is also why a tab's handlers check whether
// their panel is in front before claiming a keystroke or a paste.
//
// Puzzle types reach each other through nothing at all. The one shared surface
// is this file plus `web/ui/` (see ADR 0001 and ADR 0004).

import { render, options } from "preact";
import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { deliverSharedReading, type SharedReading } from "./ui/shared-reading.ts";
import { SudokuPuzzle } from "./sudoku.tsx";
import { QueensPuzzle } from "./queens.tsx";
import { KillerPuzzle } from "./killer.tsx";
import { adoptSharedImage, registerServiceWorker } from "./pwa.ts";

export interface PuzzleType {
  /** Unique; used for the tab id, the panel's `data-tab-panel` and DOM ids. */
  id: string;
  /** Tab button text. */
  label: string;
  /** The tab's whole UI. Receives whether it is the panel in front. */
  Panel?: ComponentType<{ active: boolean }>;
  /**
   * Imperative alternative to `Panel`, for a tab that builds its own DOM.
   * Nothing in the app uses it; the page tests register throwaway tabs with it.
   */
  mount?: (containerEl: HTMLElement) => void;
  /** Whether the Android share target can hand this tab a screenshot. */
  acceptsShared?: boolean;
}

const PUZZLES: PuzzleType[] = [SudokuPuzzle, QueensPuzzle, KillerPuzzle];

// Render on the spot rather than on a microtask. The app is far too small for
// batching to be worth anything, and synchronous renders mean the DOM always
// agrees with the state by the time an event handler returns — which is what
// the jsdom page tests assume when they assert straight after a click, and a
// fair thing for anyone reading this code to assume too.
options.debounceRendering = (commit) => commit();
// And run effects on the spot too, rather than after the next paint. Same
// reason, plus one of its own: pwa.ts hands a shared screenshot to a tab the
// instant the app mounts, and a tab whose subscription effect has not run yet
// is a tab that silently drops it.
options.requestAnimationFrame = (run) => run();

// ---- the compat surface the share handoff uses ---------------------------
//
// pwa.ts runs as its own bundle and has no import path into the component
// tree, so it reaches tabs the way it always has: by id, through `window`.

export interface PuzzleShellApi {
  register(puzzleType: PuzzleType): void;
  activate(id: string): void;
  get(id: string): (PuzzleType & { acceptShared?: (file: File, data: SharedReading) => void }) | null;
}

declare global {
  interface Window {
    PuzzleShell: PuzzleShellApi;
  }
}

let activate: (id: string) => void = () => {};

window.PuzzleShell = {
  register(puzzleType: PuzzleType): void {
    if (!puzzleType || !puzzleType.id) {
      throw new Error("PuzzleShell.register requires { id, label }");
    }
    PUZZLES.push(puzzleType);
  },
  activate: (id) => activate(id),
  get(id) {
    const puzzle = PUZZLES.find((p) => p.id === id);
    if (!puzzle) return null;
    return {
      ...puzzle,
      acceptShared: puzzle.acceptsShared
        ? (file, data) => deliverSharedReading(id, file, data)
        : undefined,
    };
  },
};

// ---- the shell ------------------------------------------------------------

/** A tab that builds its own DOM instead of rendering components. */
function MountedPanel({ mount }: { mount: (el: HTMLElement) => void }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (el) mount(el);
  }, [el]);
  return <div ref={setEl} />;
}

function App() {
  const [active, setActive] = useState(PUZZLES[0]?.id ?? "");
  activate = setActive;

  return (
    <>
      <div id="tabbar" class="tabbar" role="tablist">
        {PUZZLES.map((puzzle) => (
          <button
            key={puzzle.id}
            type="button"
            class={"tab" + (puzzle.id === active ? " active" : "")}
            data-tab-id={puzzle.id}
            role="tab"
            aria-selected={puzzle.id === active ? "true" : "false"}
            onClick={() => setActive(puzzle.id)}
          >
            {puzzle.label}
          </button>
        ))}
      </div>
      <div id="panels" class="panels">
        {PUZZLES.map(({ id, Panel, mount }) => (
          <div key={id} class="tab-panel" data-tab-panel={id} hidden={id !== active}>
            {Panel ? <Panel active={id === active} /> : mount ? <MountedPanel mount={mount} /> : null}
          </div>
        ))}
      </div>
    </>
  );
}

document.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app");
  if (root) render(<App />, root);
  // Only now: a screenshot arriving from the Android share sheet has to be
  // handed to a tab that is already mounted and listening.
  registerServiceWorker();
  adoptSharedImage();
});
