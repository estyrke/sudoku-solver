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

(function () {
  const registry = [];

  function register(puzzleType) {
    if (!puzzleType || !puzzleType.id || typeof puzzleType.mount !== "function") {
      throw new Error("PuzzleShell.register requires { id, label, mount }");
    }
    registry.push(puzzleType);
  }

  function activate(id) {
    document.querySelectorAll("#tabbar .tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.tabId === id);
      b.setAttribute("aria-selected", b.dataset.tabId === id ? "true" : "false");
    });
    document.querySelectorAll("#panels .tab-panel").forEach((p) => {
      p.hidden = p.dataset.tabPanel !== id;
    });
  }

  function init() {
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

      let panel = panelsRoot.querySelector(`[data-tab-panel="${puzzle.id}"]`);
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
  // anything (see pwa.js).
  window.PuzzleShell = {
    register,
    activate,
    get: (id) => registry.find((puzzle) => puzzle.id === id) || null,
  };
  document.addEventListener("DOMContentLoaded", init);
})();
