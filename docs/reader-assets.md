# The reader's committed assets

The screenshot reader (`web/reader/`) renders nothing at load time. Two of its inputs
are files in the repository: the digit exemplars it matches against, and the fixture
screenshots its tests read, each with the board it must read as committed beside it.
This page says what they are, why they are committed and what changing one costs.

The third committed input, the OpenCV build itself, has its own page:
[docs/opencv-js-build.md](./opencv-js-build.md).

## Why any of this is committed

One reason, and it is the same one every time: text does not rasterise identically
across platforms, and classifying a ~16px glyph is sensitive enough to notice.
Rebaking the exemplars on macOS once pushed every reference screenshot's cage-sum
checksum off 405. Anything rendered per machine would reintroduce that, so nothing is
rendered per machine.

These assets are therefore **frozen artifacts, not build outputs**. The scripts that
produced them ran against the Python reader and its OpenCV bindings, and went with the
Python runtime ([ADR 0006](./adr/0006-the-screenshot-reader-runs-in-the-browser-on-opencv-js.md));
regenerating them wholesale was already documented as harmful before that, so nothing
was lost that anyone should have been using. Their formats are written down here so
that a deliberate, targeted change is still possible.

## `public/reader/glyph-seeds.bin` — the digit exemplars

The exemplar set the classifier runs on, and the only one: the loop that learned new
exemplars from boards the player confirmed is deleted. Previously this file was a
re-container of `sudoku/reader/glyph_seeds.npz`, copied through glyph for glyph; with
the Python reader gone it is the source of truth itself, and the NumPy copy — which
nothing could read and nothing could safely regenerate — is not kept.

Format, little-endian:

```
"GLYPHS01"      8 bytes, magic and version
side            u8, the square side of every exemplar (24)
groups          u8, how many digits follow (10)
groups x { digit u8, count u16 }
then, in that order, count x side x side bytes per group
```

Digit 0 is in the file. A Sudoku cell never holds one, but a Killer cage sum does, so
the asset is the whole baked set rather than one reader's slice of it;
`web/reader/read-board.ts` takes the digits 1–9 and leaves the zero out of the
classifier. `web/reader/seeds.ts` is the reading half.

347 KB uncompressed, and it is fetched on the first read rather than bundled: it
changes only when it is deliberately changed, so it caches on its own, and a player
who never reads a screenshot never pays for it.

To add or replace one digit's exemplars, write the file back out with only that
group's bytes changed, leaving every other digit's untouched — which is what the old
baking script was careful to do, for the reason above. Bump the magic if the layout
changes, since `seeds.ts` checks it. Note that several exemplars are not rendered
glyphs at all but real ones lifted from the fixture screenshots, because the app's
open-topped 4 and its cage-sum 6 could not be synthesised convincingly at 16px; the
tests that pin them are in `tests/reader/killer-board.test.ts`, by name.

## `tests/fixtures/` — the corpus, and the boards it must read as

Six real Killer screenshots and one synthetic classic board, each with the board the
reader produces from it committed alongside — `classic_boards/*.json` and
`killer_boards/*.json`. Both halves are pinned: `tests/reader/` compares a live read
against the JSON, and `tests/engine/solver.test.ts` solves the same JSON, so the
reader and the engine are always talking about the same boards.

The classic board is synthetic because there is no screenshot of a real classic Sudoku
app in the corpus — a printed grid, ten Givens, one cell of pencil marks. Which digits,
and where, is recorded by `tests/reader/classic-board.test.ts` rather than by the
renderer that drew it, which used OpenCV's Hershey fonts and is gone.

The JSON files record what the *Python* reader read, which is what makes the parity
claim in `tests/reader/` meaningful: the ported reader agrees with the one it was
ported from, not merely with itself. Regenerate one only when the reader's read has
genuinely changed and the new read is the correct one — doing it to make a failing
test pass is how a parity gate stops being one, and after that the file no longer says
anything about the port.
