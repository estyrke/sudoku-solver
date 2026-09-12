# Sudoku Helper

Reads a Sudoku board (pen entries **and** pencil/candidate marks) from a screenshot,
lets you fix any misreads, and gives the **simplest next step** — the easiest human
technique that makes progress, not just the answer.

Everything runs locally: classical OpenCV for reading, no cloud/LLM, no API key.

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app:app --reload
```

Open http://127.0.0.1:8000.

## Using it

1. **Drop, paste, or choose** a screenshot of a board. It's read and rendered.
2. **Check the board.** Low-confidence cells are outlined red. Click a cell and type
   `1–9` to fix values (Pen mode) or candidates (Pencil mode); `0`/`Backspace` clears.
3. **Confirm reading** (optional) teaches the digit recognizer from your corrections,
   so reads of your app get more accurate over time.
4. **Get hint** shows the simplest applicable step, revealed progressively:
   *Nudge* (where to look) → *Technique* (its name) → *Full* (the reasoning, with the
   target cells/candidates highlighted). **Apply step** writes it onto the board.

You can also skip images entirely and enter a board by hand.

## On Android: share a screenshot straight into the app

1. Open the site in Chrome and choose **Install app** (or *Add to Home screen*) from
   the menu. This step is not optional — Android registers the share target when the
   app is installed, so a bookmark or an open tab will not appear in the share sheet.
2. Screenshot a puzzle, tap **Share**, and pick **Puzzle Helper**.

The board opens on the right tab: the app reads the screenshot and looks for cage
outlines, sending it to *Killer* if it finds them and *Sudoku* if it doesn't.

Android only — iOS Safari doesn't implement share targets, and nor does Firefox for
Android. If you add the app to your home screen from one of those, everything else
still works; only sharing is missing. See
`docs/adr/0003-share-target-hands-off-through-a-service-worker.md`.

## How it works

| Layer | Where | What |
| --- | --- | --- |
| Board model | `sudoku/model.py` | grid, units/peers, cages, candidate derivation, validity — reader support only; the engine's own copy is `web/sudoku/model.ts` |
| CV reader | `sudoku/reader/` | grid detection → cell parsing → template-matched digits |
| Web app | `app.py`, `web/` | `/parse`, `/confirm` + the board UI |
| Browser UI | `web/app.tsx`, `web/ui/`, `web/<puzzle>.tsx` | the tab shell, the widgets every tab shares, and one file per puzzle type — Preact components, see `docs/adr/0004-preact-for-the-ui-layer.md` |
| Browser engine | `web/sudoku/` | board model with Cages, the escalating technique catalogue (classic and Killer alike), `findHint`, `solve` and the mistake audit, in TypeScript — the Sudoku and Killer tabs' **Get hint** and **Solve** run locally, no server round trip |
| PWA shell | `static/manifest.webmanifest`, `static/sw.js`, `web/pwa.ts` | installability + the Android share target |

Icons are drawn by `python -m tools.make_icons`; the PNGs it writes are what ship.

### The front end build

The browser modules are TypeScript in `web/` — the UI as Preact components in
`.tsx`, the engine as plain `.ts` — compiled and bundled by Vite into one
`static/dist/app.js`, which is what `static/index.html` loads:

```bash
npm ci
npm run build       # web/app.tsx -> static/dist/app.js
npm run typecheck   # tsc --noEmit
```

`static/dist/` is committed, because the deploy serves the repo as it stands and
has no Node step; CI rebuilds and fails if the committed bundle has drifted from
the sources. The output is minified for asset size and cacheability only — not as
obfuscation or a security measure, since minified JavaScript is trivially readable.

`static/sw.js` stays hand-written JavaScript outside the bundle: it is served from
the site root so its scope covers `/share`, and the browser loads it as a worker.

### Adding a puzzle type

Three steps, and no edits anywhere else:

1. Write `web/<name>.tsx` exporting a `PuzzleType`, building its panel out of the
   shared components in `web/ui/` — `Grid`, `Numpad`, `PencilMarks`, `HintPanel`,
   `DropZone`, `ModeToggle`.
2. Import it in `web/app.tsx`.
3. Add it to that file's `PUZZLES` array.

`static/index.html` holds no per-tab markup: a tab's markup lives with the code
that drives it. Every panel stays mounted for the life of the page and a tab
switch only flips `hidden`, so a board survives being switched away from — which
is also why a tab checks whether it is in front before claiming a keystroke.

### Hint techniques (simplest → hardest)
Naked single → hidden single → naked pair/triple → hidden pair → naked quad →
hidden triple → pointing pair/triple → box/line reduction → cage pointing (Killer) →
X-Wing.
The engine reasons over a working candidate grid seeded from your pencil marks (falling
back to derived candidates), so elimination steps persist and later singles unlock.

### Reading & self-calibration
Digits are classified by template matching. The store ships **seeded** from rendered
fonts so the first read isn't blank, and **learns** from every confirmed board
(`/confirm` → `sudoku/reader/calibrate.py`), adapting to your specific app. Learned
exemplars live under `templates/<digit>/` and are git-ignored.

## Tests

```bash
pytest                                  # board model + CV reader
npm ci && npm run typecheck && npm run build             # the browser modules
npm --prefix tests/engine test                           # the browser engine, straight off .ts
npm --prefix tests/ui ci && npm --prefix tests/ui test   # the page, under jsdom
npm --prefix tests/components ci && npm --prefix tests/components test   # the shared widgets
```

The Python suite covers the board model the reader builds on and the CV pipeline
against real screenshots — including a check that each reference Killer screenshot
still reads as the board committed under `tests/fixtures/killer_boards/`, which is
what the TypeScript solver tests solve.

`tests/engine/` unit-tests the TypeScript engine (`web/sudoku/`) directly — the board
model and its Cages, the technique catalogue and its escalation order, `findHint`,
`solve` and the mistake audit — with no jsdom and no build step, since Node runs `.ts`
source straight, stripping types as it goes. It's where the Python tests were ported
assertion-for-assertion as the engine moved into the browser.

The UI suite (`tests/ui/`) loads `static/index.html` under jsdom, imports the built
modules from `static/dist/` and drives the page with real events, asserting on what
ends up in the DOM. It runs against the shipped bundle, so it needs `npm run build`
first. It is deliberately separate:
a correct engine and a correct API response are not enough if the page discards them,
which is exactly how an unusable hint survived several rounds of fixes to the engine
behind it. Nothing here reaches the network: what the server still answers is stubbed,
and on the tabs that hint and solve locally `fetch` is stubbed to throw, so a
regression that quietly routes them back through the network fails loudly.

`tests/components/` unit-tests the shared widgets in `web/ui/` on their own — what the
numpad says about the selected cell, what each rung of the reveal ladder does and does
not give away, where a pencil mark lands in its 3x3 square. Vitest rather than
`node --test`, because these are `.tsx` and Node's type-stripping cannot compile JSX.

All three run on every push and pull request — see `.github/workflows/ci.yml`.

## Tuning for your app

The reader is general but a few thresholds in `sudoku/reader/cell_parse.py`
(`VALUE_MIN_H`, `MARK_MIN_H/MAX_H`, `SAT_GIVEN_MAX`, `VALUE_CONF`) and the given-vs-
entered colour heuristic may want tuning once real screenshots are available. The
"Confirm reading" loop handles font adaptation automatically.
