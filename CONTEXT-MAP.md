# Context Map

## Contexts

- [Sudoku](./sudoku/CONTEXT.md) — classic 9x9 digit Sudoku: reading, hinting, solving
- [Queens](./queens/CONTEXT.md) — the Queens/Meowdoku family of puzzles: one marker per row, column and colored region, no two adjacent

## Relationships

- **Sudoku ↔ Queens**: no shared domain vocabulary or model. Both are puzzle types served by the same FastAPI app and static-JS shell (`app.py`, `static/`) via a puzzle-type switch — the sharing is at the web/UI layer only, not the domain layer.
