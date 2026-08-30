"""Human solving techniques, ordered by difficulty — the Queens analogue of
``sudoku/solver/techniques.py``.

Each technique is a function ``(board, cg) -> Optional[Hint]`` where ``cg`` is
the working candidate grid. Unlike Sudoku — where a cell can hold any of
several digits, so the candidate grid tracks a *set of digits per cell* — a
Queens cell is binary: given the current placements and marks, it either could
still legally hold *a* queen or it couldn't. There's no second dimension to
track, so ``CandGrid`` here is a flat ``set[Coord]`` of still-viable cells
rather than Sudoku's ``dict[Coord, set[int]]``.

Reasoning about "the candidates for this unit are confined to these N cells" —
what issues #7 (adjacency-shadow elimination) and #8 (region<->line
confinement) build on — is just "the subset of ``cg`` that intersects this
unit's cells", computed on demand (``[cell for cell in cells if cell in cg]``)
rather than cached as a set-per-unit index. A board this size (roughly
6x6-11x11) makes that recomputation cheap, so the extra bookkeeping a
per-unit index would need (keeping 3 overlapping views in sync as cells are
eliminated) wasn't judged worth it. #7/#8's implementers: keep using
``board.units()`` + a membership filter against this same flat ``cg`` rather
than introducing a parallel structure.

A technique inspects ``cg`` (and ``board``, e.g. for already-placed queens or
region layout) and returns the *first* deduction it finds, or ``None``. They
never mutate anything — a hint describes one step, the caller decides whether
to apply it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..model import QUEEN, Board, cell_name

Coord = tuple[int, int]
CandGrid = set[Coord]


@dataclass
class Hint:
    """One solving step.

    ``action`` is ``"place"`` (put a queen in ``cells[0]``) or ``"eliminate"``
    (rule out every cell in ``cells`` as a candidate — used by #7/#8's
    elimination techniques; not produced by any technique in this pass).
    Queens has no digit to carry alongside a placement — a cell either gets a
    queen or it doesn't — so unlike Sudoku's ``Hint`` there's no ``digits``
    field. ``level`` ranks difficulty so callers can show "simplest first".
    """

    technique: str
    level: int
    action: str  # "place" | "eliminate"
    cells: list[Coord]
    units: list[str] = field(default_factory=list)
    explanation: str = ""

    def to_dict(self) -> dict:
        return {
            "technique": self.technique,
            "level": self.level,
            "action": self.action,
            "cells": [{"r": r, "c": c} for r, c in self.cells],
            "units": self.units,
            "explanation": self.explanation,
        }


# ---------------------------------------------------------------------------
# Forced placement
# ---------------------------------------------------------------------------


def forced_placement(board: Board, cg: CandGrid) -> Hint | None:
    """A unit (row, column or region) reduced to exactly one live candidate
    forces the queen there.

    The Queens analogue of Sudoku's hidden single (there's no naked-single
    equivalent since a cell has no digit choices of its own to narrow down —
    just yes/no). This is the smallest, simplest deduction in the search, so
    it stays first in ``TECHNIQUES``.

    Units that already hold a queen are skipped explicitly rather than relied
    upon to fall out of ``cg`` on their own — a defensive guard against a
    caller passing a ``cg`` that wasn't seeded via ``working_candidates``
    (e.g. a hand-built one in a test), so this function is safe to call
    directly against any ``(board, cg)`` pair.
    """
    for label, cells in board.units():
        if any(board.state(r, c) == QUEEN for r, c in cells):
            continue  # unit already satisfied
        live = [cell for cell in cells if cell in cg]
        if len(live) == 1:
            (r, c) = live[0]
            return Hint(
                technique="Forced placement",
                level=1,
                action="place",
                cells=[(r, c)],
                units=[label],
                explanation=(
                    f"In {label}, {cell_name(r, c)} is the only cell left that "
                    f"can hold a queen, so the queen must go there."
                ),
            )
    return None


# Ordered simplest -> hardest. find_hint() walks this list and returns the
# first hit. Issues #7 (adjacency-shadow elimination) and #8 (region<->line
# confinement) each append one more function here, sized smallest-first —
# see queens/docs/adr/0001-general-primitives-not-named-patterns.md for why
# both of those families feed this same list rather than separate passes.
TECHNIQUES = [
    forced_placement,
]
