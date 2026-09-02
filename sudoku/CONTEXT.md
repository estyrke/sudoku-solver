# Sudoku

Classic 9x9 digit Sudoku, and its Killer variant (see Cage): reading a board from a screenshot, suggesting the simplest next human step, and solving.

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
Any of the 27 groups (9 rows, 9 columns, 9 boxes) in which each digit 1-9 must appear exactly once. A Cage looks similar but isn't a Unit — see Cage.
_Avoid_: Group, house

**Box**:
A unit — one of the 9 fixed 3x3 blocks that tile the grid.
_Avoid_: Region (Sudoku boxes are fixed-shape and fixed-size; see the Queens context's Region for the contrasting irregular kind), Cage (this context's own irregular grouping, added for Killer boards — see Cage), block

**Peer**:
Any other cell sharing a row, column or box with a given cell — the cells whose values constrain it. 20 cells on a classic board; on a Killer board, a cell's Cage-mates are peers too (a Cage's no-repeat rule constrains candidates the same way a Unit's does), so the count grows by the rest of its Cage.
_Avoid_: Neighbor (reserved for adjacency in the Queens context)

**Hint**:
A single applicable technique's output: either a placement or one or more eliminations, plus the reasoning and the cells/units it turns on. Escalating techniques are tried simplest-first; `find_hint` returns the first that applies.
_Avoid_: Step, move

### Killer Sudoku

Terms specific to the Killer variant. A board without any Cages is just classic Sudoku; these concepts are absent from it.

**Cage**:
An orthogonally-contiguous (edge-adjacent, never diagonal) group of 2 or more cells carrying a target sum. Every cell on a Killer board belongs to exactly one Cage. The digits placed in a Cage's cells must all be different and must add up to its sum — but unlike a Unit, a Cage need not contain every digit 1-9. A cell's Cage-mates are its Peers — see Peer.
_Avoid_: Region (the Queens context's term for a visually similar but differently-ruled grouping — a Region takes exactly one Queen, not a no-repeat digit set), block, group

**Span**:
One or more whole Units taken together, treated as a single target for the 45-rule: a single row, column or Box, or several adjacent rows or columns. Its digits total 45 per Unit it contains.
_Avoid_: Region (reserved for the Queens context's irregular grouping — see Box), band, chute

**45-rule**:
The fact that every Unit's digits sum to 45 (1+2+...+9), used to derive an unknown value or total by comparing a Span's fixed total against the sums of the Cages that cover it. See Innie, Outie.
_Avoid_: Sum trick

**Innie**:
A cell that lies inside a Span but belongs to a Cage that extends outside it — one of the cells the 45-rule reasons over. A Span may have several, in which case the rule fixes their combined total rather than any one value.
_Avoid_: Overlap cell

**Outie**:
A cell that lies outside a Span but belongs to a Cage that extends inside it — the counterpart to Innie in a 45-rule deduction, and likewise possibly several.
_Avoid_: Overlap cell
