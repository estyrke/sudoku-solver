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
| Board model | `sudoku/model.py` | grid, units/peers, candidate derivation, validity |
| Hint engine | `sudoku/solver/` | escalating techniques + `find_hint` (simplest first) |
| CV reader | `sudoku/reader/` | grid detection → cell parsing → template-matched digits |
| Web app | `app.py`, `static/` | `/parse`, `/hint`, `/confirm`, `/solve` + the board UI |
| PWA shell | `static/manifest.webmanifest`, `sw.js`, `pwa.js` | installability + the Android share target |

Icons are drawn by `python -m tools.make_icons`; the PNGs it writes are what ship.

### Hint techniques (simplest → hardest)
Naked single → hidden single → naked pair/triple → hidden pair → naked quad →
hidden triple → pointing pair/triple → box/line reduction → X-Wing.
The engine reasons over a working candidate grid seeded from your pencil marks (falling
back to derived candidates), so elimination steps persist and later singles unlock.

### Reading & self-calibration
Digits are classified by template matching. The store ships **seeded** from rendered
fonts so the first read isn't blank, and **learns** from every confirmed board
(`/confirm` → `sudoku/reader/calibrate.py`), adapting to your specific app. Learned
exemplars live under `templates/<digit>/` and are git-ignored.

## Tests

```bash
pytest                                  # model, techniques, solver, reader
npm --prefix tests/ui ci && npm --prefix tests/ui test   # the browser modules
```

The Python suite covers the model, every technique (with synthetic candidate grids),
an end-to-end solve consistent with a backtracking solver, the mistake audit, and the
CV pipeline against real screenshots.

The UI suite (`tests/ui/`) loads `static/index.html` under jsdom and drives the page
with real events, asserting on what ends up in the DOM. It is deliberately separate:
a correct engine and a correct API response are not enough if the page discards them,
which is exactly how an unusable hint survived several rounds of fixes to the engine
behind it. Requests are stubbed, so the suite needs no server and takes ~0.3s.

Both run on every push and pull request — see `.github/workflows/ci.yml`.

## Tuning for your app

The reader is general but a few thresholds in `sudoku/reader/cell_parse.py`
(`VALUE_MIN_H`, `MARK_MIN_H/MAX_H`, `SAT_GIVEN_MAX`, `VALUE_CONF`) and the given-vs-
entered colour heuristic may want tuning once real screenshots are available. The
"Confirm reading" loop handles font adaptation automatically.
