# Sudoku

Classic 9x9 digit Sudoku: reading a board from a screenshot, suggesting the simplest next human step, and solving.

## Language

**Cell**:
One of the 81 squares. Holds a placed `value` (or none), a `is_given` flag, and the player's own `pencil_marks`.
_Avoid_: Square, box (see Box)

**Given**:
A cell whose value was printed by the puzzle itself, not entered by the player. Immutable during play.
_Avoid_: Clue, fixed cell

**Pencil mark**:
A candidate digit the *player* wrote into a cell by hand. Kept separate from derived candidates so the engine can reason from what the player actually sees, and so player mistakes can be flagged rather than silently corrected.
_Avoid_: Note, annotation, candidate (see Candidate)

**Candidate**:
A digit the engine derives as still-legal for an empty cell, from the current values of its peers. Distinct from a pencil mark, which is player-authored.
_Avoid_: Possibility, pencil mark

**Unit**:
Any of the 27 groups (9 rows, 9 columns, 9 boxes) in which each digit 1-9 must appear exactly once.
_Avoid_: Group, house

**Box**:
A unit — one of the 9 fixed 3x3 blocks that tile the grid.
_Avoid_: Region (Sudoku boxes are fixed-shape and fixed-size; see the Queens context's Region for the contrasting irregular kind), block

**Peer**:
Any other cell sharing a row, column or box with a given cell — the 20 cells whose values constrain it.
_Avoid_: Neighbor (reserved for adjacency in the Queens context)

**Hint**:
A single applicable technique's output: either a placement or one or more eliminations, plus the reasoning and the cells/units it turns on. Escalating techniques are tried simplest-first; `find_hint` returns the first that applies.
_Avoid_: Step, move
