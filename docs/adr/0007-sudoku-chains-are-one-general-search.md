# Sudoku's chain techniques are one general search, not a shelf of named patterns

Until now the Sudoku catalogue has gone the named route: `nakedPair`, `hiddenTriple`, `pointing`, `claiming`, `xWing`, each one shape from a strategy guide. It stopped at X-Wing, and ordinary published puzzles stall there — Sudoku #11462 (issue #61, `tests/fixtures/classic_boards/sudoku_11462.txt`) makes two Pointing steps and then has nothing, with 41 Cells empty.

Past X-Wing the guides list a zoo: Simple Colouring, Turbot Fish, Skyscraper, X-chains, XY-Wing, XY-chains, W-Wing, and alternating inference chains that subsume all of them. Measured on #11462, adding the next named pattern buys very little. Simple Colouring finds the first step and the board stalls again two Pointing steps later; adding XY-Wing on top changes nothing. A general alternating-inference-chain search finishes it: eight chains of four to eight nodes interleaved with the rest of the catalogue, every one of them sound.

We add **one technique, `chain`**, which searches breadth-first for the shortest alternating chain — strong links from bivalue Cells and from digits with two places left in a Unit, weak links from any two candidates that cannot both hold, which on a Killer board includes Cage-mates — from a candidate assumed false to one inferred true, and eliminates what that pair rules out. It is the same trade-off the Queens context settled in `web/queens/docs/adr/0001-general-primitives-not-named-patterns.md`: a general primitive whose special cases are the named patterns, rather than a catalogue of shapes to match.

## Consequences

- `chain` sits last in `TECHNIQUES`, after `fortyFiveSets`, at level 8. A general search can reach, the long way round, deductions a simpler technique states in one line, so everything simpler gets the first look.
- The existing named techniques stay. They are simpler to explain, they are what a player recognises, and they are what `findHint` should offer when they apply; the chain search is for what they cannot see.
- The hint's `technique` names the chain by shape only — `X-chain` (one digit), `XY-chain` (bivalue Cells only) or `Alternating inference chain` — and the explanation walks it link by link in prose. No Turbot Fish, no Skyscraper: those are chains of four nodes, and naming them would be matching shapes after all.
- Parity is the part that must not be got wrong. A chain started from a candidate assumed *true* proves only an implication, and eliminating on it is unsound — sometimes right by luck. The tests check every chain elimination against the board's unique solution across a sweep of boards, which is what catches an inverted parity: flipping it fails most of that sweep.
- Shortest chain first, capped at 16 nodes (`MAX_CHAIN`). Past that an explanation is no longer something a player would follow by hand.
- Chain nodes are single candidates. Grouped nodes, almost-locked sets and nets are not in it; a board that needs them still stalls, and the audit's *catalogue-exhausted* verdict (issue #60) is what says so honestly.
