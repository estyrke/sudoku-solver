# Preact for the UI layer, and nothing below it

The browser UI was imperative DOM: ~1,700 lines across three tab modules, each keeping
module-level mutable state in sync with the page by hand through `render()`,
`applyHighlights()`, `syncNumpad()`, `renderTotals()` and `renderCageEditor()`. Each
tab's markup lived in `static/index.html` while its behaviour lived in a separate `.ts`
file, joined only by `id` strings and a row of `let el!: HTMLElement` non-null
assertions. The same widgets — board grid, numpad, hint panel, reveal ladder, mode
toggle, drop zone — were written out three times over, in both files.

The costs were the ones that bite an agent, or anyone, adding the fourth feature: adding
a field to a tab's state means remembering which of several render functions have to
change, and adding a puzzle type means a fourth copy of everything. Neither is caught by
a type checker; both fail quietly, in the DOM.

We adopt **Preact** for the UI layer: React's JSX and hooks API — the dialect with by far
the most prior art to draw on — at ~4 KB gzip rather than ~45. Size matters here because
this is an installed PWA and the bundle is meant to make room for a WASM payload later.

## Consequences

- `web/app.tsx` holds a static `PUZZLES` array, the tab bar and the mount. Adding a
  puzzle type is: write `web/<name>.tsx`, import it, add it to the array.
- `web/ui/` holds the shared widgets. A tab composes them; it does not build a grid.
- `static/index.html` carries no per-tab markup — just `<div id="app">`. A tab's markup
  lives with the code that drives it.
- **The engine is out of scope.** `web/sudoku/*.ts` stays pure TypeScript with no import
  of Preact and no knowledge of the DOM, and `tests/engine/` keeps running it unbundled
  through Node's own type-stripping. The framework buys nothing below the UI and would
  cost that suite its build-free simplicity.
- **Every panel stays mounted for the life of the page**; a tab switch only flips
  `hidden`. Unmounting would throw away the board the player has been filling in. It is
  also why a tab checks whether it is in front before claiming a keystroke or a paste.
- CSS class names were kept exactly as they were, so `static/style.css` did not change
  and neither did the rendering. The page tests in `tests/ui/`, which drive the real
  built bundle through real events, carried over nearly untouched and are what showed the
  port had not changed behaviour.
- Rendering and effects are made synchronous (`options.debounceRendering`,
  `options.requestAnimationFrame`). The app is far too small for batching to pay for
  itself, and the DOM agreeing with the state by the time a handler returns is what both
  the page tests and a reader reasonably assume. It also matters for correctness in one
  place: the share handoff hands a screenshot to a tab the instant the app mounts, and a
  tab whose subscription effect has not run yet would silently drop it.
- One bundle, not five. `web/ui/shared-reading.ts` is module state shared by `pwa.ts` and
  the tabs, so separate entry points would give each its own copy of it.
