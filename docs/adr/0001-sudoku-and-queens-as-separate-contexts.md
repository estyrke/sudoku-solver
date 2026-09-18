# Sudoku and Queens are separate bounded contexts, sharing only a tabbed web shell

Adding Queens/Meowdoku support could have extended the existing `sudoku/` `Board`/`Cell` model to a generic grid puzzle abstraction. We chose not to: the two puzzles share almost no vocabulary (digits/candidates/pencil-marks/box vs. regions/marks/queens) and no model code (Queens boards are variable-N with irregular regions; Sudoku is fixed 9x9 with fixed 3x3 boxes). Each puzzle type gets its own model, solver, hint engine and reader; the only shared layer is the FastAPI app and static-JS shell, switched via a tabbed puzzle-type UI designed so further puzzle types can be added the same way.

## Amendment (the move into the browser)

The shared layer survived the ports; only its floor changed. There is no FastAPI app any more (ADR 0006) and the static JS is Preact (ADR 0004), so what the two contexts have in common is the browser shell — `web/app.tsx`, `web/ui/` and a tab per puzzle type — and nothing below it. `web/sudoku/` and `web/queens/` still share no model code and no vocabulary, which is the decision this ADR actually made.
