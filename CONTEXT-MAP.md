# Context Map

## Contexts

- [Sudoku](./sudoku/CONTEXT.md) — classic 9x9 digit Sudoku, and its Killer variant: reading, hinting, solving
- [Queens](./web/queens/CONTEXT.md) — the Queens/Meowdoku family of puzzles: one marker per row, column and colored region, no two adjacent

## Relationships

- **Sudoku ↔ Queens**: no shared domain vocabulary or model. Both are puzzle types served by the same Preact browser shell (`web/app.tsx`, `web/ui/`), itself served — along with the Sudoku screenshot readers — by the same FastAPI app (`app.py`), via a tab per puzzle type. The sharing is at the web/UI layer only, not the domain layer: each context has its own engine (`web/sudoku/`, `web/queens/`), and neither reasons on the server. See `docs/adr/0004-preact-for-the-ui-layer.md`.
