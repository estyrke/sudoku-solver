# Queens

The Queens family of logic puzzles (popularized by LinkedIn Queens; **Meowdoku** is a cat-themed skin of the identical ruleset): place exactly one marker per row, per column and per colored region on an N×N board, with no two markers adjacent — including diagonally.

## Language

**Queen**:
The marker the player places. Canonical term regardless of theme — Meowdoku renders it as a cat, LinkedIn renders it as a crown, but the rule (one per row/column/region, no two adjacent incl. diagonally) is identical either way.
_Avoid_: Cat, crown, token

**Region**:
An irregularly-shaped, contiguous group of same-colored cells. Exactly one Queen must land in each region — the Queens-context analogue of a Sudoku Box, except regions vary in shape and size and are supplied as board data, never implied by position.
_Avoid_: Color, zone, box, group

**Mark**:
A cell the player (or an applied hint) has ruled out as impossible for a Queen. Rendered as an X. Collapses a source app's transient "invalid placement attempt" flash (e.g. a red X) into the same state as a manually-marked cell — that flash carries no lasting rule-derived meaning, so the model doesn't distinguish it.
_Avoid_: Cross, elimination, X

**Cell state**:
Every cell is in exactly one of three states: empty (unmarked, no Queen), marked (ruled out), or occupied (holds a Queen). There is no fourth "conflict" state — see Mark.

**Board**:
An N×N grid of cells, each belonging to exactly one Region, with N determined by the board itself (not fixed, unlike Sudoku's 9x9). Distinct from the Sudoku context's `Board`.
_Avoid_: Grid (reserved for the reader's raw detected grid, before regions are known)

**Meowdoku**:
The specific cat-themed app this context's screenshot reader targets. A skin, not a separate ruleset — see Queen. Used when discussing reader/layout concerns; use Queens for the ruleset/model/solver.
