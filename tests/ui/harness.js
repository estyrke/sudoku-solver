// Boots static/index.html under jsdom so the browser modules can be driven
// headlessly. These tests exist because the page can faithfully call the API,
// get a correct answer back and still drop it on the floor: killer.ts discarded
// `hint.explanation` for four rounds of "the hint is unusable" while every
// Python test and every live API check passed.
//
// The page is loaded with `runScripts: "outside-only"`, so jsdom parses the
// markup but never fetches or runs the <script src> tags. We import the built
// modules ourselves instead, which keeps the network out of it and lets a test
// swap in its own `fetch` before any module code runs.
//
// What we import is the real shipped artifact — static/dist/app.js, as built
// from web/app.tsx by Vite — so a module that fails to compile or bundle fails
// here too. The module reaches the page through the globals a browser gives it,
// so `window` and `document` are pointed at this boot's jsdom before the import
// runs; a cache-busting query gives every boot its own module instance, and so
// its own board state.

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..");
const DIST = path.join(ROOT, "static", "dist");

// The whole app is one bundle now (see vite.config.ts), so every tab is always
// present. Which one is in front is chosen per boot with `activate` instead —
// most of these suites are about the Killer tab, so that is the default.
const MODULES = ["app.js"];
const DEFAULT_TAB = "killer";

let bootCount = 0;

/**
 * Take DOMContentLoaded away from jsdom and give it to the caller.
 *
 * The shell mounts on DOMContentLoaded, and mounting twice resets the board out
 * from under whatever the test just set up. jsdom finishes parsing on its own
 * schedule, which may fall before, during or after the module imports — so
 * rather than race it, swallow the event it dispatches and let the caller fire
 * one itself, once, when every module is loaded and listening.
 *
 * Returns that dispatch. The suppressor sees the event first (capture phase,
 * registered before any module listener) and stops it reaching the modules
 * unless the returned dispatch is what sent it.
 */
function ownDomReady(window, document) {
  let ours = false;
  document.addEventListener(
    "DOMContentLoaded",
    (event) => {
      if (!ours) event.stopImmediatePropagation();
    },
    true,
  );
  return () => {
    ours = true;
    document.dispatchEvent(new window.Event("DOMContentLoaded"));
    ours = false;
  };
}

/**
 * Yield to the event loop long enough for a click's handler to finish, given
 * the handler awaits a mocked `fetch` that resolves immediately. killer.ts is
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
 * @param {string}   [opts.activate] which tab to bring to the front after
 *                                 mounting; null to leave the first one up
 * @param {string}   [opts.url]    the page's address, for query-string paths
 * @param {Function} [opts.setUp]  runs against the window after the modules are
 *                                 imported but before anything mounts, for
 *                                 planting browser APIs jsdom does not have
 * @param {Function} [opts.afterMount] runs against the window once the tabs
 *                                 have rendered, for anything that has to
 *                                 address an element the page just created
 */
async function boot({ fetch, tabs = [], activate = DEFAULT_TAB, url, setUp, afterMount } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "static/index.html"), "utf8"),
                        { runScripts: "outside-only", pretendToBeVisual: true, url });
  const { window } = dom;
  const { document } = window;

  if (fetch) window.fetch = fetch;

  // Registered before the imports, so it is ahead of every module listener.
  const mountTabs = ownDomReady(window, document);

  // The modules are written against the browser's globals. Point them at this
  // boot's window for the duration; they read `window` and `document` when a
  // handler runs rather than only at import, so these stay pointed here until
  // the next boot replaces them.
  globalThis.window = window;
  globalThis.document = document;

  const stamp = ++bootCount;
  for (const file of MODULES) {
    const moduleUrl = pathToFileURL(path.join(DIST, path.basename(file, ".js") + ".js"));
    moduleUrl.search = `?boot=${stamp}`; // a fresh instance, and fresh state
    await import(moduleUrl.href);
  }
  for (const tab of tabs) window.PuzzleShell.register(tab);
  if (setUp) setUp(window);

  // Everything is loaded and listening: mount the tabs, exactly once.
  mountTabs();
  if (activate) window.PuzzleShell.activate(activate);
  if (afterMount) afterMount(window);

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
