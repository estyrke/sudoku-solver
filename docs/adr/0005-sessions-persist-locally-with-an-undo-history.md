# Sessions persist locally, with an undo history of edits

A board lived in `useState` inside its tab and nowhere else. Closing the page, or a mobile
browser evicting it, threw away a half-solved puzzle with no way to get it back, and there
was no way to take back a single digit either — a mistyped cell in Pen mode silently wiped
that cell's pencil marks along with it, and `Solve` overwrote the whole board the player
had been working on. Keeping the panels mounted across tab switches (ADR 0004) protected
the board from a tab switch but from nothing else.

Undo and persistence are one design, not two features that happen to ship together: what
undo needs to record is exactly what a resumed session needs to restore, and deciding
either separately means deciding the other by accident.

We keep **one session per tab, autosaved to `localStorage`, carrying an ordered history of
Edits and a cursor into it**. An Edit is one thing the player did — a digit, a pencil-mark
toggle, a cage painted, an applied hint, `Solve`, `Clear board`, a screenshot import — and
it stores only what changed, not the board it changed. Undo walks the cursor back and
applies each Edit's inverse; redo walks it forward. The history and the cursor are saved
with the board, so undo *and* redo survive a restart.

Two arguments decide the shape. The first is that persistence must not cost a backend:
every engine and both readers run in the page and there is no server left to hold anything
(ADR 0006) — cross-device sync would need accounts, storage and a privacy posture, all to
move a puzzle between screens. The second is arithmetic. A board serialized
the way `toWire()` already serializes it is ~5.7 KB, so snapshot-per-Edit would put a long
session on three tabs near the ~5 MB `localStorage` budget; an Edit that records one cell's
before and after is ~150 bytes. Deltas are what make persisting the *whole* history
affordable, and persisting the whole history is what makes undo mean something after the
app has been closed.

## Consequences

- **`localStorage`, not IndexedDB.** Deltas capped at 500 Edits come to well under 100 KB
  per tab, so the size ceiling that would have forced the larger store is not in play.
  What is in play is that `localStorage` is synchronous: a session is restored during the
  first render rather than landing after it, so there is no empty-board flash and no async
  restore path, and the jsdom page tests can assert what was written straight after a
  click the way they already assert the DOM. IndexedDB becomes worth revisiting only if a
  session ever has to hold a screenshot or there is more than one session per tab.
- **A generic core, with per-tab Edit types.** `web/ui/` owns everything tab-agnostic: the
  history, the cursor, the cap, the debounced write, the schema version, and the
  cross-window handling. Each tab supplies its own Edit type with `apply` and `invert`,
  because a Sudoku cell delta and a Queens region delta are not the same thing and
  flattening them into one would put puzzle knowledge in the shell. Tabs share the shell,
  not the domain — ADR 0001 and ADR 0004.
- **One gesture is one Edit.** Killer already commits a painted cage as a single set on
  pointer-up, so it maps over directly; Queens' region painting, which fires per cell the
  pointer enters, is brought in line by opening an Edit on pointer-down and closing it on
  release. `Solve` and `Clear board` are each one Edit too, recording the prior state of
  every cell they touched (~6 KB) rather than decomposing into 81. Undoing `Solve` is the
  case that justifies the cost: it is the button most likely to be pressed by accident and
  the one that destroys the most.
- **Loading a puzzle is an Edit, not a reset.** A screenshot import, a `Clear board` and a
  Queens resize record the cells and givens they replaced and stay undoable, so importing
  over a board in progress is recoverable. The price is that Givens change under an undo,
  which an Edit must therefore carry alongside values.
- **Undo moves the selection** to the cell it changed, and clears any hint on display
  rather than restoring one — matching the `clearHint()` that already runs on every edit.
  Pen/pencil mode, the Killer cages/digits phase and the reveal ladder are interface, not
  board, and do not rewind; mode flipping underneath the player is disorienting and makes
  every Edit bigger for it.
- **Reachable by keyboard and by touch.** `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` join the
  per-tab keydown handler, which already only claims a key when its panel is in front.
  They are not sufficient on their own: this is an installed PWA that is most often driven
  by thumb from the Android share sheet, so Undo and Redo are buttons in the actions row
  as well.
- **Records are versioned and discarded on mismatch.** A record that fails to parse or
  carries an unknown version is dropped and the tab starts empty. No migrations: a puzzle
  in progress is worth less than a migration path maintained for the life of the app, and
  a half-restored board is worse than no board. The version must be bumped whenever an
  Edit type or the stored shape changes — including a change to a tab's own Edit type,
  which is the easy one to forget.
- **Last write wins across windows, with adoption on focus.** Two windows of the same
  origin each hold their own state; `localStorage` fires a `storage` event in the others
  on every write, and a window that regains focus with a newer record on disk adopts it.
  That is not a locking scheme and does not pretend to be — it targets the one failure
  that actually happens, a stale background window autosaving over the session just
  played. Concurrent editing in two windows still resolves to whoever wrote last.
- **The screenshot is not kept, but the doubt is.** A session stores no image, and nothing
  wants one: the reader takes pixels and returns a board, and `Confirm reading` — the only
  thing that ever needed the original back — went with the Python runtime (ADR 0006).
  Sudoku's per-cell `low_confidence` and Killer's doubtful cage sums *are* stored: they
  cost almost nothing, and a restored board that still holds possibly-misread digits while
  no longer showing which ones to check would be quietly less trustworthy than the one that
  was saved.
- **A finished puzzle stays the session**, history and all, so a solved board is there when
  the player comes back and `Solve` remains undoable after a restart. Nothing special-cases
  completion.
- **Killer's mistake audit is derived, not player data.** It is recomputed, never stored
  and never undone, and is cleared when a session is restored. The same test applies to
  anything else added later: if the engine can produce it from the board, it does not
  belong in an Edit.
- Writes are debounced at 300 ms — long enough that a burst of typing is one write, short
  enough that a browser killed moments after a digit loses at most that digit.
- Delivered in two stages: the history core and the undo/redo UI across all three tabs
  first, then persistence on top. The second stage is small precisely because the first one
  settles what a session record contains.
