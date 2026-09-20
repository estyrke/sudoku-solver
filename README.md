# Sudoku Helper

Reads a Sudoku board (pen entries **and** pencil/candidate marks) from a screenshot,
lets you fix any misreads, and gives the **simplest next step** — the easiest human
technique that makes progress, not just the answer.

Everything runs on your device: classical computer vision for reading, no cloud/LLM,
no API key, and no server — the screenshot is never uploaded anywhere.

## Quick start

```bash
npm ci
npm run dev     # http://localhost:8124, with hot reload
```

An ordinary Vite project, arranged so the build emits the whole site:

| | |
| --- | --- |
| `web/` | the Vite root. `index.html` is the entry; everything it pulls in is TypeScript |
| `public/` | assets copied through verbatim to the site root — the service worker, the manifest, the stylesheet, the icons, the OpenCV build, the digit exemplars |
| `dist/` | the build output, and the thing that gets deployed. Gitignored |

| | |
| --- | --- |
| `npm run build` | `web/` + `public/` → `dist/` |
| `npm run dev` | Vite's dev server, with hot reload: what you want while working on `web/` |
| `npm run serve` | `vite preview` over `dist/` — the deployed site, exactly as it ships |

`dev` transforms what it serves, so the bundle it hands you is not the bundle that
ships and `/sw.js` is not the bytes a browser would register as a worker. For anything
about the real bundle, the service worker, the offline precache or installing the app,
`npm run build && npm run serve`.

## Using it

1. **Drop, paste, or choose** a screenshot of a board. It's read here in the page and
   rendered.
2. **Check the board.** Low-confidence cells are outlined red. Click a cell and type
   `1–9` to fix values (Pen mode) or candidates (Pencil mode); `0`/`Backspace` clears.
3. **Get hint** shows the simplest applicable step, revealed progressively:
   *Nudge* (where to look) → *Technique* (its name) → *Full* (the reasoning, with the
   target cells/candidates highlighted). **Apply step** writes it onto the board.

You can also skip images entirely and enter a board by hand.

## On Android: share a screenshot straight into the app

1. Open the site in Chrome and choose **Install app** (or *Add to Home screen*) from
   the menu. This step is not optional — Android registers the share target when the
   app is installed, so a bookmark or an open tab will not appear in the share sheet.
2. Screenshot a puzzle, tap **Share**, and pick **Puzzle Helper**.

The board opens on the right tab: the app reads the screenshot and looks for cage
outlines, sending it to *Killer* if it finds them and *Sudoku* if it doesn't. That
decision is made on the device, like everything else.

### Offline

Once installed, the app works with no network. The service worker precaches the page
and everything it needs to run — stylesheet, manifest, engine bundle — so hinting,
solving and the mistake audit are available from the first launch. Reading is local
too, for a dropped, pasted or shared screenshot alike.

The one exception is the *first* screenshot you ever read: the OpenCV runtime and the
digit exemplars are several megabytes and are fetched then rather than at install, so
that installing stays fast and only a player who reads a screenshot pays for them.
Every read after that needs nothing. A new deploy is picked up in the background and
takes effect on the next launch.

Android only — iOS Safari doesn't implement share targets, and nor does Firefox for
Android. If you add the app to your home screen from one of those, everything else
still works; only sharing is missing. See
`docs/adr/0003-share-target-hands-off-through-a-service-worker.md`.

## How it works

| Layer | Where | What |
| --- | --- | --- |
| Reader | `web/reader/`, `public/reader/` | grid detection → cell parsing → template-matched digits, classic and Killer, in TypeScript on OpenCV.js. A screenshot is decoded by the browser's own codecs and read in the page, with no upload. Ported at parity from a Python reader that no longer exists — thresholds and all — and still pinned cell-for-cell (Killer: cage-for-cage, sum-for-sum) to the boards that reader produced. See `docs/adr/0006-the-screenshot-reader-runs-in-the-browser-on-opencv-js.md` and `docs/reader-assets.md` |
| Browser UI | `web/app.tsx`, `web/ui/`, `web/<puzzle>.tsx` | the tab shell, the widgets every tab shares, and one file per puzzle type — Preact components, see `docs/adr/0004-preact-for-the-ui-layer.md` |
| Browser engine | `web/sudoku/` | board model with Cages, the escalating technique catalogue (classic and Killer alike), `findHint`, `solve` and the mistake audit |
| Browser engine | `web/queens/` | the Queens board model (variable N, irregular Regions), its technique catalogue, `findHint` and the backtracking `solve` — a separate engine sharing no code with `web/sudoku/`, see `docs/adr/0001-sudoku-and-queens-as-separate-contexts.md` |
| PWA shell | `public/manifest.webmanifest`, `public/sw.js`, `web/pwa.ts` | installability, the Android share target, and the offline precache of the shell + engine bundle |
| OpenCV runtime | `public/vendor/opencv/`, `web/cv/runtime.ts`, `tools/opencv/` | a custom OpenCV.js build — core and imgproc only — committed as an artifact, and the loader that brings it up in the browser or Node. What the reader runs on. See `docs/opencv-js-build.md` |
| Hosting | `vercel.json`, `.vercelignore` | the app deploys as static files, built on deploy by `npm run build`, with `dist/` as the output directory. The service worker and the manifest are served from the site root because they are public assets and the build puts them there — not because a host rule moves them. The one URL that is not a file is `/share`, and it is the one rewrite |

There is no server and no runtime Python. What is left of Python is a tooling island
under `tools/`, for work that genuinely happens offline: icons are drawn by
`python -m tools.make_icons` (the PNGs it writes are what ship), and the model training
pipeline that replaces template matching will live there too.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r tools/requirements.txt
```

### The front end build

The browser modules are TypeScript in `web/` — the UI as Preact components in
`.tsx`, the engine as plain `.ts` — entered through `web/index.html` and bundled by
Vite into one `dist/assets/app.js`, with the script tag rewritten to match:

```bash
npm ci
npm run build       # web/ + public/ -> dist/
npm run typecheck   # tsc --noEmit
```

`dist/` is gitignored: it is built, not committed. Vercel runs `npm run build` on
deploy, and CI runs it before the suites that read `dist/`, so one command produces it
everywhere and nothing has to be kept in step by hand. A fresh clone has no `dist/`
until you build one — which is why it is a prerequisite of `tests/ui/`.

The bundle has a fixed name rather than a content hash, which is a constraint
`public/sw.js` places on the build: the worker precaches the shell *by name* on
install, and a name only the build knew would have to be threaded into the worker
somehow. Cache-busting is already handled — the worker serves cache-first and
revalidates behind the response, so a new build lands on the launch after the one that
fetched it.

The output is minified for asset size and cacheability only — not as obfuscation or a
security measure, since minified JavaScript is trivially readable.

`public/sw.js` stays hand-written JavaScript outside the bundle: it is copied through
verbatim so that it lands at the site root, where its scope covers `/share`, and the
browser loads it as a worker rather than as part of the bundle.

### Adding a puzzle type

Three steps, and no edits anywhere else:

1. Write `web/<name>.tsx` exporting a `PuzzleType`, building its panel out of the
   shared components in `web/ui/` — `Grid`, `Numpad`, `PencilMarks`, `HintPanel`,
   `DropZone`, `ModeToggle`.
2. Import it in `web/app.tsx`.
3. Add it to that file's `PUZZLES` array.

`web/index.html` holds no per-tab markup: a tab's markup lives with the code
that drives it. Every panel stays mounted for the life of the page and a tab
switch only flips `hidden`, so a board survives being switched away from — which
is also why a tab checks whether it is in front before claiming a keystroke.

### Hint techniques (simplest → hardest)
Impossible pencil mark → naked single → hidden single → cage sum (Killer) →
45-rule (Killer) → naked pair/triple → hidden pair → naked quad → hidden triple →
pointing pair/triple → box/line reduction → cage pointing (Killer) → X-Wing →
45-rule over a set of innies or outies (Killer).
The engine reasons over a working candidate grid seeded from your pencil marks (falling
back to derived candidates), so elimination steps persist and later singles unlock.

### Reading

Digits are classified by normalized cross-correlation against a store of exemplars,
which ships **seeded** as `public/reader/glyph-seeds.bin` and is fetched on the first
read. There is exactly one recognition path. The reader used to also *learn* from every
board you confirmed, adapting to your particular app, and that loop is gone along with
the server that ran it — a per-device store that never synced was a worse answer to
font-brittleness than the trained classifier that will replace template matching.

The seeds are committed bitmaps rather than rendered at load, because text rasterises
differently across platforms and classifying a ~16px glyph is sensitive enough to
notice. See `docs/reader-assets.md`.

## Tests

```bash
npm ci && npm run typecheck && npm run build             # the browser modules
npm --prefix tests/engine test                           # the engines, straight off .ts
npm --prefix tests/cv test                               # the OpenCV artifact and its loader
npm --prefix tests/reader test                           # the screenshot reader
npm --prefix tests/share test                            # a reading finding its tab
npm --prefix tests/components ci && npm --prefix tests/components test   # the shared widgets
npm --prefix tests/shell test                            # the worker and the hosting
npm --prefix tests/ui ci && npm --prefix tests/ui test   # the page, under jsdom
```

`tests/engine/` unit-tests the TypeScript engines (`web/sudoku/`, `web/queens/`)
directly — the board models, Sudoku's Cages, each technique catalogue and its
escalation order, `findHint`, `solve` and the mistake audit — with no jsdom and no
build step, since Node runs `.ts` source straight, stripping types as it goes. It's
where the Python engine tests were ported assertion-for-assertion as the engine moved
into the browser. It also covers `web/ui/history.ts`, the shell's undo/redo core: it's
tab-agnostic rather than an engine, but shares the same no-jsdom, no-dependencies seam,
because that is precisely what its own design requires of it (see ADR 0005).

`tests/reader/` is the parity gate. It runs the reader against the committed fixture
screenshots and compares each result to the board committed beside it — every value,
Given and Pencil mark in one assertion, and for Killer every cage and every sum — plus
the pipeline-level Pencil-mark cases that run against synthesized ink masks. Those
boards are what the Python reader read, which is what makes "ported at parity" a claim
a test can fail. Fixtures are decoded by a small PNG decoder, because the reader itself
takes decoded pixels and leaves decoding to its caller. Several of these tests are
named regressions — the cage outline that read as a leading 1, the italic 1 that
classified as a 7, the open-topped 4 that classified as a 9, the board frame hairline
that invented pencil marks — and the explanation each carries is the more useful half.

`tests/cv/` asserts nothing about any puzzle. It loads the committed OpenCV build from
`public/vendor/opencv/` through `web/cv/runtime.ts` and converts a small image, which
is the cheapest way to catch a regenerated artifact that was linked without the modules
the reader needs, emitted in a shape the loader does not expect, or committed without
its `.wasm`. See `docs/opencv-js-build.md`.

`tests/share/` covers the one step where a reading becomes a tab. Neither neighbour can
hold it: jsdom never reaches it, and the reader suite ends before tabs exist.

The UI suite (`tests/ui/`) loads `dist/index.html` under jsdom, imports the bundle
beside it and drives the page with real events, asserting on what ends up in the DOM.
It runs against the site as deployed rather than the sources it was built from, so it
needs `npm run build` first. It is deliberately separate: a correct engine is not enough if the page discards
what it says, which is exactly how an unusable hint survived several rounds of fixes to
the engine behind it. Nothing here reaches the network, and `fetch` is stubbed to
record every call, so a regression that routes anything back through a host that no
longer exists fails loudly.

`tests/shell/` is the shell the page is installed *inside*, and boots no page at all.
`service-worker.test.js` runs `public/sw.js` outside a browser in a vm sandbox — the
share handoff and the offline precache have no other home, since jsdom has no worker.
`hosting.test.js` reads `vercel.json` and checks it against the files it points at: a
manifest served as the wrong media type, or a worker served from a subdirectory, kills
the share target silently and only in production, so the configuration is the thing
under test.

`tests/components/` unit-tests the shared widgets in `web/ui/` on their own — what the
numpad says about the selected cell, what each rung of the reveal ladder does and does
not give away, where a pencil mark lands in its 3x3 square. Vitest rather than
`node --test`, because these are `.tsx` and Node's type-stripping cannot compile JSX.

They all run on every push and pull request, as one job — see `.github/workflows/ci.yml`.

## Tuning for your app

The reader is general, but a few thresholds in `web/reader/cell-parse.ts`
(`VALUE_MIN_H`, `MARK_MIN_H`/`MARK_MAX_H`, `SAT_GIVEN_MAX`, `VALUE_CONF`) and the
given-vs-entered colour heuristic are tuned to the apps in the fixture corpus and may
want revisiting for a different one. They are pinned by `tests/reader/`, which is the
point: each was set because a real screenshot broke in a specific way, so changing one
has to explain itself against six reference boards.
