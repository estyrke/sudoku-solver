// Boots static/index.html under jsdom so the browser modules can be driven
// headlessly. These tests exist because the page can faithfully call the API,
// get a correct answer back and still drop it on the floor: killer.js discarded
// `hint.explanation` for four rounds of "the hint is unusable" while every
// Python test and every live API check passed.
//
// The page is loaded with `runScripts: "outside-only"`, so jsdom parses the
// markup but never fetches or runs the <script src> tags. We eval the modules
// ourselves instead, which keeps the network out of it and lets a test swap in
// its own `fetch` before any module code runs.

const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");

// shell.js first: killer.js registers itself into the shell's registry as it
// loads, and the shell must exist by then. sudoku.js and queens.js are left out
// on purpose — the killer tab is what these tests are about, and loading the
// others would couple them to unrelated modules.
const MODULES = ["shell.js", "killer.js"];

/** Resolve once the document has finished parsing, mounting every tab. */
function domReady(document) {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise((resolve) =>
    document.addEventListener("DOMContentLoaded", resolve, { once: true }));
}

/**
 * Yield to the event loop long enough for a click's handler to finish, given
 * the handler awaits a mocked `fetch` that resolves immediately. killer.js is
 * only a couple of awaits deep, so one turn of the macrotask queue drains it.
 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Load the page and mount its tabs.
 *
 * @param {object}   [opts]
 * @param {Function} [opts.fetch]  stands in for window.fetch; the page only
 *                                 ever reads `.ok` and `.json()`
 * @param {object[]} [opts.tabs]   extra puzzle types to register before mount,
 *                                 for exercising tab switching without pulling
 *                                 in a real second puzzle module
 * @param {string[]} [opts.scripts] which modules to load, in order — the order
 *                                 decides which tab opens first
 * @param {string}   [opts.url]    the page's address, for query-string paths
 * @param {Function} [opts.setUp]  runs against the window after the modules are
 *                                 evalled but before anything mounts, for
 *                                 planting browser APIs jsdom does not have
 */
async function boot({ fetch, tabs = [], scripts = MODULES, url, setUp } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8"),
                        { runScripts: "outside-only", pretendToBeVisual: true, url });
  const { window } = dom;
  const { document } = window;

  if (fetch) window.fetch = fetch;
  for (const file of scripts) {
    window.eval(fs.readFileSync(path.join(ROOT, "static", file), "utf8"));
  }
  for (const tab of tabs) window.PuzzleShell.register(tab);
  if (setUp) setUp(window);

  // The shell mounts on DOMContentLoaded. Wait for jsdom's own rather than
  // dispatching one: an extra event mounts a second time, which resets the
  // board out from under whatever the test just set up.
  await domReady(document);

  const panel = document.querySelector('[data-tab-panel="killer"]');
  const board = document.getElementById("kBoard");

  return {
    window,
    document,
    panel,
    board,
    hintEl: document.getElementById("kHint"),
    revealEl: document.getElementById("kReveal"),
    statusText: () => document.getElementById("kStatus").textContent,

    cellAt: (r, c) => board.querySelector(`.kcell[data-r="${r}"][data-c="${c}"]`),
    /** Dispatch a bubbling mouse event at `el` (a plain click for buttons). */
    fire: (el, type) => el.dispatchEvent(new window.MouseEvent(type, { bubbles: true })),
    /** Drags end on the document, not on a cell, so mouseup needs its own path. */
    fireOnDocument: (type) =>
      document.dispatchEvent(new window.MouseEvent(type, { bubbles: true })),

    inPanel: (selector) => panel.querySelector(selector),
    digit: (d) => panel.querySelector(`#kNumpad [data-digit="${d}"]`),

    flush,
  };
}

module.exports = { boot, flush, ROOT };
