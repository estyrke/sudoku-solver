# Context Map

## Contexts

- [Sudoku](./sudoku/CONTEXT.md) — classic 9x9 digit Sudoku, and its Killer variant: reading, hinting, solving
- [Queens](./web/queens/CONTEXT.md) — the Queens/Meowdoku family of puzzles: one marker per row, column and colored region, no two adjacent

## Shell language

Terms belonging to the browser shell (`web/app.tsx`, `web/ui/`), not to any puzzle's domain
— the shell is where a session and its undo history live, and it holds them the same way for
every tab. They are recorded here rather than in a `CONTEXT.md` precisely because they cross
both contexts while meaning nothing inside either one: a Session knows it holds a board, but
nothing about digits, cages or queens. See `docs/adr/0005-sessions-persist-locally-with-an-undo-history.md`.

**Session**:
One tab's puzzle as it currently stands, plus the History that produced it — autosaved to
the browser's own storage and restored when the app reopens. Exactly one per tab, silently
overwritten as the player plays; there is no library, no naming and nothing on a server. A
Session never leaves the device it was made on.
_Avoid_: Save, save file, game (a Session is not started or ended by the player — it simply
is what that tab currently holds)

**Edit**:
One thing the player did, recorded so it can be taken back: a digit, a pencil-mark toggle, a
painted Cage, an applied Hint, Solve, Clear board, a screenshot import, a Queens resize. One
gesture is one Edit, so a drag across five cells undoes as a unit. An Edit stores only what
changed — the affected cells' prior and new state — never a copy of the board.
_Avoid_: Step, move (both reserved against by the Sudoku context's Hint, and "Apply step"
already names the button that *produces* one Edit), action, change, transaction

**History**:
A Session's Edits in order, with a cursor marking where undo has walked back to. Undo moves
the cursor back and inverts the Edit it passes; redo moves it forward and reapplies. A new
Edit made mid-History discards everything after the cursor. Bounded at 500 Edits, oldest
dropped, and saved with the board so both undo and redo survive a restart.
_Avoid_: Undo stack (it is walked in both directions and outlives the page, so neither half
of the name holds), timeline, log

## Relationships

- **Sudoku ↔ Queens**: no shared domain vocabulary or model. Both are puzzle types served by the same Preact browser shell (`web/app.tsx`, `web/ui/`), itself served — along with the Sudoku screenshot readers — by the same FastAPI app (`app.py`), via a tab per puzzle type. The sharing is at the web/UI layer only, not the domain layer: each context has its own engine (`web/sudoku/`, `web/queens/`), and neither reasons on the server. See `docs/adr/0004-preact-for-the-ui-layer.md`.
