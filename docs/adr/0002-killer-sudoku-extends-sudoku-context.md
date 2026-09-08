# Killer Sudoku extends the Sudoku context, not a new bounded context

Where ADR 0001 split Queens into its own context because it shared no vocabulary or model with Sudoku, Killer Sudoku is the opposite case: it's classic 9x9 digit Sudoku plus one bounded addition (Cage, a sum-constrained grouping — see `sudoku/CONTEXT.md`), with rows, columns, boxes, candidates, pencil marks and peers all unchanged. We extend `sudoku/` (model, solver, reader) rather than create a `killer_sudoku/` sibling, reusing the existing candidate derivation, escalating hint catalog, and progressive-reveal machinery instead of duplicating it for one new constraint.

## Consequences

- `sudoku/model.py`'s `Board`/`Cell` gain an optional Cage layer; a board with no Cages is plain classic Sudoku, unchanged.
- `sudoku/solver/techniques.py`'s existing escalating catalog (naked/hidden singles, pairs, etc.) gains two Cage-aware techniques (cage-sum candidate restriction, 45-rule) rather than a separate solver.
- `sudoku/reader` gains cage-boundary and printed-sum detection alongside its existing digit classification, rather than a separate reader package.

## Amendment (the TypeScript port)

The engine has since moved into the browser and the Python solver package is gone, but the decision is unchanged and so is its shape: `web/sudoku/model.ts` carries `Cage` and `web/sudoku/techniques.ts` carries the cage-sum and 45-rule techniques in the one escalating catalogue, alongside the classic ones. There is still no Killer module. `sudoku/model.py` keeps its Cage layer because the CV reader, which is still Python, builds boards with it.
