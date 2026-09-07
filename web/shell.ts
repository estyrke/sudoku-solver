// Tabbed puzzle-type shell: a small registry that puzzle-type modules push
// themselves into, plus tab-bar rendering/switching.
//
// Registry API (what a puzzle-type module calls):
//
//   PuzzleShell.register({
//     id: "sudoku",       // unique, used for the tab id, panel lookup and DOM ids
//     label: "Sudoku",    // tab button text
//     mount(containerEl) {
//       // Build/wire this puzzle's UI inside containerEl. Called once, at
//       // shell init. Module-level state naturally stays alive for as long
//       // as the page lives, since the container is only ever hidden/shown
//       // (never destroyed) on tab switches.
//     },
//   });
//
// The shell renders one tab button per registered puzzle (in registration
// order) and, on click, shows that puzzle's panel while hiding the others
// via `hidden` — nothing is torn down or rebuilt, so each tab's client-side
// board state survives switching away and back.
//
// A puzzle module may supply its own panel markup in index.html by tagging
// the container with `data-tab-panel="<id>"`; otherwise the shell creates an
// empty panel for it. Either way `mount` receives that container element.
//
// This is the one layer the puzzle types share (see ADR 0001): they reach each
// other only through `window.PuzzleShell`, never by importing one another,
// which is why each module is its own bundle entry point.

/**
 * A reading the share target has already parsed, handed to a tab as-is.
 *
 * The shell deliberately knows nothing about its shape — only the tab that
 * asked for it does — so a tab narrows it to its own reading type on arrival.
 */
export type SharedReading = Record<string, any>;

export interface PuzzleType {
  id: string;
  label: string;
  mount(containerEl: HTMLElement): void;
  /** Optional: adopt a screenshot the Android share target has already read. */
  acceptShared?(file: File, data: SharedReading): void;
}

export interface PuzzleShellApi {
  register(puzzleType: PuzzleType): void;
  activate(id: string): void;
  get(id: string): PuzzleType | null;
}

declare global {
  interface Window {
    PuzzleShell: PuzzleShellApi;
  }
}

const registry: PuzzleType[] = [];

function register(puzzleType: PuzzleType): void {
  if (!puzzleType || !puzzleType.id || typeof puzzleType.mount !== "function") {
    throw new Error("PuzzleShell.register requires { id, label, mount }");
  }
  registry.push(puzzleType);
}

function activate(id: string): void {
  document.querySelectorAll<HTMLElement>("#tabbar .tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tabId === id);
    b.setAttribute("aria-selected", b.dataset.tabId === id ? "true" : "false");
  });
  document.querySelectorAll<HTMLElement>("#panels .tab-panel").forEach((p) => {
    p.hidden = p.dataset.tabPanel !== id;
  });
}

function init(): void {
  const tabbar = document.getElementById("tabbar");
  const panelsRoot = document.getElementById("panels");
  if (!tabbar || !panelsRoot) return;

  registry.forEach((puzzle, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab";
    btn.textContent = puzzle.label;
    btn.dataset.tabId = puzzle.id;
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", () => activate(puzzle.id));
    tabbar.appendChild(btn);

    let panel = panelsRoot.querySelector<HTMLElement>(`[data-tab-panel="${puzzle.id}"]`);
    if (!panel) {
      panel = document.createElement("div");
      panel.dataset.tabPanel = puzzle.id;
      panelsRoot.appendChild(panel);
    }
    panel.classList.add("tab-panel");
    panel.hidden = index !== 0;

    puzzle.mount(panel);
  });

  if (registry.length) activate(registry[0].id);
}

// `activate` and `get` are exported for the share handoff, which has to bring
// a tab to the front and hand it a screenshot without the user having clicked
// anything (see pwa.ts).
window.PuzzleShell = {
  register,
  activate,
  get: (id: string) => registry.find((puzzle) => puzzle.id === id) || null,
};
document.addEventListener("DOMContentLoaded", init);
