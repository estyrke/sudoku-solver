"""Pure-logic Sudoku board model.

No I/O, no CV, no web — just the grid, its units/peers, candidate derivation and
validity checks. Everything the hint engine needs lives here.

Coordinates are 0-indexed ``(row, col)`` throughout. Human-facing labels (``r1c1``,
``box 4``) are produced only at the edges, in :func:`cell_name` and the unit helpers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from itertools import combinations
from typing import Iterable, Iterator, Optional

DIGITS = tuple(range(1, 10))
COORDS = [(r, c) for r in range(9) for c in range(9)]

Coord = tuple[int, int]


@dataclass
class Cell:
    """A single square.

    ``value`` is the placed digit (a "pen" entry or a given) or ``None`` if empty.
    ``pencil_marks`` are the candidates the *user* wrote, kept separate from the
    candidates the engine derives from board values so we can flag user mistakes.
    ``low_confidence`` is set by the CV reader when a glyph was read uncertainly.
    """

    value: Optional[int] = None
    is_given: bool = False
    pencil_marks: set[int] = field(default_factory=set)
    low_confidence: bool = False


def box_index(r: int, c: int) -> int:
    """Box number 0..8 (left-to-right, top-to-bottom) for a cell."""
    return (r // 3) * 3 + (c // 3)


def cell_name(r: int, c: int) -> str:
    """Human label like ``r4c7`` (1-indexed)."""
    return f"r{r + 1}c{c + 1}"


def sum_bounds(size: int) -> tuple[int, int]:
    """Smallest and largest totals reachable by ``size`` distinct digits 1-9."""
    return size * (size + 1) // 2, sum(range(10 - size, 10))


@lru_cache(maxsize=None)
def can_reach(size: int, total: int, allowed: frozenset[int]) -> bool:
    """Whether ``size`` distinct digits drawn from ``allowed`` can total ``total``.

    Pure arithmetic reachability — it says nothing about whether those digits can
    legally be placed given the rest of the board.

    Cached: the solver asks this once per candidate per cage per node, and there
    are only a few thousand distinct questions to ask.
    """
    if size == 0:
        return total == 0
    if size > len(allowed):
        return False
    return any(sum(combo) == total for combo in combinations(sorted(allowed), size))


def _is_contiguous(cells: frozenset[Coord]) -> bool:
    """True if ``cells`` form one orthogonally-connected group (no diagonals)."""
    start = next(iter(cells))
    seen, stack = {start}, [start]
    while stack:
        r, c = stack.pop()
        for nxt in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
            if nxt in cells and nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return len(seen) == len(cells)


@dataclass(frozen=True)
class Cage:
    """A Killer cage: 2+ orthogonally-contiguous cells whose digits are distinct
    and total ``sum``.

    Not a Unit — a cage need not contain every digit 1-9. See ``sudoku/CONTEXT.md``.
    """

    cells: frozenset[Coord]
    sum: int

    def __post_init__(self) -> None:
        if len(self.cells) < 2:
            raise ValueError("a cage needs at least 2 cells")
        if len(self.cells) > 9:
            raise ValueError("a cage cannot exceed 9 cells (digits must differ)")
        if any(not (0 <= r < 9 and 0 <= c < 9) for r, c in self.cells):
            raise ValueError("cage cells must be on the board")
        if not _is_contiguous(self.cells):
            raise ValueError("a cage's cells must be orthogonally contiguous")
        lo, hi = sum_bounds(len(self.cells))
        if not lo <= self.sum <= hi:
            raise ValueError(
                f"a {len(self.cells)}-cell cage must total {lo}..{hi}, got {self.sum}"
            )

    @classmethod
    def of(cls, cells: Iterable[Coord], total: int) -> "Cage":
        """Build from any iterable of coordinates."""
        return cls(frozenset(cells), total)


class Board:
    """A 9x9 Sudoku grid plus the structural helpers techniques rely on."""

    def __init__(
        self,
        cells: Optional[list[Cell]] = None,
        cages: Optional[Iterable[Cage]] = None,
    ):
        if cells is None:
            cells = [Cell() for _ in COORDS]
        if len(cells) != 81:
            raise ValueError("a board needs exactly 81 cells")
        self.cells: list[Cell] = cells
        self.cages: list[Cage] = list(cages or [])
        self._cage_of: dict[Coord, Cage] = {}
        for cage in self.cages:
            for coord in cage.cells:
                if coord in self._cage_of:
                    raise ValueError(f"{cell_name(*coord)} is in more than one cage")
                self._cage_of[coord] = cage

    # ---- cages --------------------------------------------------------------

    def cage_at(self, r: int, c: int) -> Optional[Cage]:
        """The cage containing ``(r, c)``, or ``None`` on an uncaged cell."""
        return self._cage_of.get((r, c))

    def is_fully_caged(self) -> bool:
        """Whether every cell belongs to a cage — true of a complete Killer board.

        Not an invariant: a board is legitimately part-caged while being entered.
        """
        return len(self._cage_of) == 81

    def cage_is_feasible(self, cage: Cage) -> bool:
        """Whether ``cage`` can still be completed: no repeated digit, no overshoot,
        and a remainder its empty cells could actually total."""
        placed = [self.value(r, c) for r, c in cage.cells]
        filled = [v for v in placed if v is not None]
        if len(set(filled)) != len(filled):
            return False
        so_far = sum(filled)
        empty = len(placed) - len(filled)
        if empty == 0:
            return so_far == cage.sum
        if so_far >= cage.sum:
            return False
        return can_reach(empty, cage.sum - so_far, frozenset(DIGITS) - set(filled))

    # ---- access -------------------------------------------------------------

    def cell(self, r: int, c: int) -> Cell:
        return self.cells[r * 9 + c]

    def value(self, r: int, c: int) -> Optional[int]:
        return self.cell(r, c).value

    def set_value(self, r: int, c: int, value: Optional[int]) -> None:
        self.cell(r, c).value = value

    # ---- units & peers ------------------------------------------------------

    @staticmethod
    def row_cells(r: int) -> list[tuple[int, int]]:
        return [(r, c) for c in range(9)]

    @staticmethod
    def col_cells(c: int) -> list[tuple[int, int]]:
        return [(r, c) for r in range(9)]

    @staticmethod
    def box_cells(b: int) -> list[tuple[int, int]]:
        r0, c0 = (b // 3) * 3, (b % 3) * 3
        return [(r0 + dr, c0 + dc) for dr in range(3) for dc in range(3)]

    def units(self) -> Iterator[tuple[str, list[tuple[int, int]]]]:
        """Yield all 27 units as ``(label, cells)`` pairs."""
        for r in range(9):
            yield f"row {r + 1}", self.row_cells(r)
        for c in range(9):
            yield f"column {c + 1}", self.col_cells(c)
        for b in range(9):
            yield f"box {b + 1}", self.box_cells(b)

    def peers(self, r: int, c: int) -> set[tuple[int, int]]:
        """The cells whose values constrain ``(r, c)``.

        The classic 20 that share a row, column or box. An instance method rather
        than a static one because a Killer board's cages add to this set, and cage
        membership is per-board data — see ``sudoku/CONTEXT.md``, *Peer*.
        """
        result: set[tuple[int, int]] = set()
        result.update(self.row_cells(r))
        result.update(self.col_cells(c))
        result.update(self.box_cells(box_index(r, c)))
        cage = self.cage_at(r, c)
        if cage is not None:
            result.update(cage.cells)
        result.discard((r, c))
        return result

    # ---- candidates ---------------------------------------------------------

    def candidates(self, r: int, c: int) -> set[int]:
        """Legal digits for an empty cell, derived from current values.

        Returns an empty set for a filled cell.
        """
        if self.value(r, c) is not None:
            return set()
        used = {self.value(pr, pc) for pr, pc in self.peers(r, c)}
        used.discard(None)
        return set(DIGITS) - used

    def candidate_grid(self) -> dict[tuple[int, int], set[int]]:
        """Map every empty cell to its derived candidate set."""
        return {
            (r, c): self.candidates(r, c)
            for r, c in COORDS
            if self.value(r, c) is None
        }

    # ---- status -------------------------------------------------------------

    def is_solved(self) -> bool:
        return all(self.value(r, c) is not None for r, c in COORDS) and self.is_valid()

    def is_valid(self) -> bool:
        """No unit repeats a value, and every cage is still completable."""
        for _, cells in self.units():
            seen: set[int] = set()
            for r, c in cells:
                v = self.value(r, c)
                if v is None:
                    continue
                if v in seen:
                    return False
                seen.add(v)
        return all(self.cage_is_feasible(cage) for cage in self.cages)

    def is_broken(self) -> bool:
        """True if invalid, or an empty cell has no candidates (dead end)."""
        if not self.is_valid():
            return True
        return any(
            self.value(r, c) is None and not self.candidates(r, c)
            for r, c in COORDS
        )

    # ---- serialization ------------------------------------------------------

    @classmethod
    def from_grid(cls, rows: Iterable[Iterable[int]], givens: bool = True) -> "Board":
        """Build from a 9x9 of ints, where 0 means empty. Filled cells are givens
        when ``givens`` is True."""
        cells: list[Cell] = []
        rows = [list(row) for row in rows]
        if len(rows) != 9 or any(len(row) != 9 for row in rows):
            raise ValueError("from_grid expects a 9x9 grid")
        for row in rows:
            for v in row:
                v = int(v)
                cells.append(Cell(value=(v or None), is_given=bool(v) and givens))
        return cls(cells)

    @classmethod
    def from_string(cls, s: str) -> "Board":
        """Build from an 81-char string; ``0`` or ``.`` is empty."""
        chars = [ch for ch in s if ch in "0123456789."]
        if len(chars) != 81:
            raise ValueError(f"expected 81 cells, got {len(chars)}")
        rows = [
            [0 if ch in "0." else int(ch) for ch in chars[i : i + 9]]
            for i in range(0, 81, 9)
        ]
        return cls.from_grid(rows)

    def to_dict(self) -> dict:
        data: dict = {
            "cells": [
                {
                    "value": cell.value,
                    "is_given": cell.is_given,
                    "pencil_marks": sorted(cell.pencil_marks),
                    "low_confidence": cell.low_confidence,
                }
                for cell in self.cells
            ]
        }
        if self.cages:
            data["cages"] = [
                {
                    "cells": [{"r": r, "c": c} for r, c in sorted(cage.cells)],
                    "sum": cage.sum,
                }
                for cage in self.cages
            ]
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "Board":
        cells = [
            Cell(
                value=c.get("value"),
                is_given=bool(c.get("is_given", False)),
                pencil_marks=set(c.get("pencil_marks", [])),
                low_confidence=bool(c.get("low_confidence", False)),
            )
            for c in data["cells"]
        ]
        cages = [
            Cage.of(((cell["r"], cell["c"]) for cell in cage["cells"]), cage["sum"])
            for cage in data.get("cages", [])
        ]
        return cls(cells, cages)
