"""Human solving techniques, ordered by difficulty.

Each technique is a function ``(board, cg) -> Optional[Hint]`` where ``cg`` is the
working candidate grid: ``{(r, c): set_of_candidates}`` for every empty cell. A
technique inspects ``cg`` and returns the *first* deduction it finds, or ``None``.
They never mutate anything — a hint describes one step, the caller decides whether
to apply it.

Passing ``cg`` in (rather than deriving it from values inside each technique) is
what lets elimination steps persist: pointing/box-line/subset moves narrow ``cg``,
and a later single can then become visible. The caller seeds ``cg`` from the user's
pencil marks when present, falling back to candidates derived from board values
(see :func:`sudoku.solver.hint.working_candidates`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations
from typing import Optional

from ..model import Board, box_index, cell_name

Coord = tuple[int, int]
CandGrid = dict[Coord, set[int]]


@dataclass
class Hint:
    """One solving step.

    ``action`` is ``"place"`` (write ``digits[0]`` into ``cells[0]``) or
    ``"eliminate"`` (remove ``digits`` from the candidates of every cell in
    ``cells``). ``level`` ranks difficulty so callers can show "simplest first".
    """

    technique: str
    level: int
    action: str  # "place" | "eliminate"
    cells: list[Coord]
    digits: list[int]
    units: list[str] = field(default_factory=list)
    explanation: str = ""

    def to_dict(self) -> dict:
        return {
            "technique": self.technique,
            "level": self.level,
            "action": self.action,
            "cells": [{"r": r, "c": c} for r, c in self.cells],
            "digits": self.digits,
            "units": self.units,
            "explanation": self.explanation,
        }


def _names(cells: list[Coord]) -> str:
    return ", ".join(cell_name(r, c) for r, c in cells)


def _empties(cells: list[Coord], cg: CandGrid) -> list[Coord]:
    return [cell for cell in cells if cell in cg]


# ---------------------------------------------------------------------------
# Singles
# ---------------------------------------------------------------------------


def naked_single(board: Board, cg: CandGrid) -> Optional[Hint]:
    for (r, c), cands in cg.items():
        if len(cands) == 1:
            (d,) = tuple(cands)
            return Hint(
                technique="Naked single",
                level=1,
                action="place",
                cells=[(r, c)],
                digits=[d],
                explanation=(
                    f"{cell_name(r, c)} has only one remaining candidate, {d}, "
                    f"so it must go there."
                ),
            )
    return None


def hidden_single(board: Board, cg: CandGrid) -> Optional[Hint]:
    for label, cells in board.units():
        empties = _empties(cells, cg)
        for d in range(1, 10):
            holders = [cell for cell in empties if d in cg[cell]]
            if len(holders) == 1:
                r, c = holders[0]
                if len(cg[(r, c)]) == 1:
                    continue  # already a naked single, reported by the simpler rule
                return Hint(
                    technique="Hidden single",
                    level=2,
                    action="place",
                    cells=[(r, c)],
                    digits=[d],
                    units=[label],
                    explanation=(
                        f"In {label}, {d} fits only in {cell_name(r, c)}, "
                        f"so it must go there."
                    ),
                )
    return None


# ---------------------------------------------------------------------------
# Naked / hidden subsets
# ---------------------------------------------------------------------------


def _naked_subset(board: Board, cg: CandGrid, n: int, level: int, name: str) -> Optional[Hint]:
    for label, cells in board.units():
        empties = _empties(cells, cg)
        for combo in combinations(empties, n):
            union: set[int] = set().union(*(cg[cell] for cell in combo))
            if len(union) != n:
                continue
            elim_cells = [
                cell for cell in empties if cell not in combo and cg[cell] & union
            ]
            if elim_cells:
                return Hint(
                    technique=f"Naked {name}",
                    level=level,
                    action="eliminate",
                    cells=elim_cells,
                    digits=sorted(union),
                    units=[label],
                    explanation=(
                        f"In {label}, {_names(list(combo))} together hold only "
                        f"{sorted(union)}, so those digits can be removed from "
                        f"{_names(elim_cells)}."
                    ),
                )
    return None


def naked_pair(board, cg):
    return _naked_subset(board, cg, 2, 3, "pair")


def naked_triple(board, cg):
    return _naked_subset(board, cg, 3, 4, "triple")


def naked_quad(board, cg):
    return _naked_subset(board, cg, 4, 5, "quad")


def _hidden_subset(board: Board, cg: CandGrid, n: int, level: int, name: str) -> Optional[Hint]:
    for label, cells in board.units():
        empties = _empties(cells, cg)
        present = [d for d in range(1, 10) if any(d in cg[cell] for cell in empties)]
        for combo in combinations(present, n):
            holders = [cell for cell in empties if cg[cell] & set(combo)]
            if len(holders) != n:
                continue
            elim_cells = [cell for cell in holders if cg[cell] - set(combo)]
            if elim_cells:
                removed = sorted(
                    set().union(*(cg[cell] for cell in elim_cells)) - set(combo)
                )
                return Hint(
                    technique=f"Hidden {name}",
                    level=level,
                    action="eliminate",
                    cells=sorted(elim_cells),
                    digits=removed,
                    units=[label],
                    explanation=(
                        f"In {label}, {sorted(combo)} appear only in "
                        f"{_names(sorted(holders))}, so other candidates "
                        f"({removed}) can be removed from those cells."
                    ),
                )
    return None


def hidden_pair(board, cg):
    return _hidden_subset(board, cg, 2, 4, "pair")


def hidden_triple(board, cg):
    return _hidden_subset(board, cg, 3, 5, "triple")


# ---------------------------------------------------------------------------
# Intersections
# ---------------------------------------------------------------------------


def pointing(board: Board, cg: CandGrid) -> Optional[Hint]:
    """Box -> line: a digit confined to one row/col within a box clears that line
    elsewhere."""
    for b in range(9):
        box = _empties(Board.box_cells(b), cg)
        for d in range(1, 10):
            holders = [(r, c) for (r, c) in box if d in cg[(r, c)]]
            if len(holders) < 2:
                continue
            rows = {r for r, _ in holders}
            cols = {c for _, c in holders}
            if len(rows) == 1:
                (r,) = tuple(rows)
                line = _empties(Board.row_cells(r), cg)
                line_label = f"row {r + 1}"
            elif len(cols) == 1:
                (c,) = tuple(cols)
                line = _empties(Board.col_cells(c), cg)
                line_label = f"column {c + 1}"
            else:
                continue
            elim = [cell for cell in line if cell not in box and d in cg[cell]]
            if elim:
                return Hint(
                    technique="Pointing pair/triple",
                    level=6,
                    action="eliminate",
                    cells=elim,
                    digits=[d],
                    units=[f"box {b + 1}", line_label],
                    explanation=(
                        f"In box {b + 1}, {d} can only sit in {line_label} "
                        f"({_names(holders)}), so {d} is removed from the rest of "
                        f"{line_label}: {_names(elim)}."
                    ),
                )
    return None


def claiming(board: Board, cg: CandGrid) -> Optional[Hint]:
    """Line -> box: a digit confined to one box within a row/col clears the rest of
    that box."""
    lines: list[tuple[str, list[Coord]]] = []
    for r in range(9):
        lines.append((f"row {r + 1}", Board.row_cells(r)))
    for c in range(9):
        lines.append((f"column {c + 1}", Board.col_cells(c)))
    for label, cells in lines:
        empties = _empties(cells, cg)
        for d in range(1, 10):
            holders = [cell for cell in empties if d in cg[cell]]
            if len(holders) < 2:
                continue
            boxes = {box_index(r, c) for r, c in holders}
            if len(boxes) != 1:
                continue
            (b,) = tuple(boxes)
            box = _empties(Board.box_cells(b), cg)
            elim = [cell for cell in box if cell not in holders and d in cg[cell]]
            if elim:
                return Hint(
                    technique="Box/line reduction",
                    level=6,
                    action="eliminate",
                    cells=elim,
                    digits=[d],
                    units=[label, f"box {b + 1}"],
                    explanation=(
                        f"In {label}, {d} can only sit inside box {b + 1} "
                        f"({_names(holders)}), so {d} is removed from the rest of "
                        f"box {b + 1}: {_names(elim)}."
                    ),
                )
    return None


# ---------------------------------------------------------------------------
# Fish
# ---------------------------------------------------------------------------


def x_wing(board: Board, cg: CandGrid) -> Optional[Hint]:
    def search(by_row: bool) -> Optional[Hint]:
        for d in range(1, 10):
            positions: dict[int, list[int]] = {}
            for i in range(9):
                cross = []
                for j in range(9):
                    r, c = (i, j) if by_row else (j, i)
                    if (r, c) in cg and d in cg[(r, c)]:
                        cross.append(j)
                if len(cross) == 2:
                    positions[i] = cross
            for a, b in combinations(positions, 2):
                if positions[a] != positions[b]:
                    continue
                p, q = positions[a]
                elim: list[Coord] = []
                for k in range(9):
                    if k in (a, b):
                        continue
                    for cross in (p, q):
                        r, c = (k, cross) if by_row else (cross, k)
                        if (r, c) in cg and d in cg[(r, c)]:
                            elim.append((r, c))
                if elim:
                    orient = "rows" if by_row else "columns"
                    return Hint(
                        technique="X-Wing",
                        level=7,
                        action="eliminate",
                        cells=elim,
                        digits=[d],
                        explanation=(
                            f"{d} forms an X-Wing across {orient} {a + 1} and "
                            f"{b + 1}, so {d} is removed from {_names(elim)}."
                        ),
                    )
        return None

    return search(by_row=True) or search(by_row=False)


# Ordered simplest -> hardest. find_hint() walks this list and returns the first hit.
TECHNIQUES = [
    naked_single,
    hidden_single,
    naked_pair,
    naked_triple,
    hidden_pair,
    naked_quad,
    hidden_triple,
    pointing,
    claiming,
    x_wing,
]
