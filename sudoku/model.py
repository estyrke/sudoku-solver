"""Pure-logic Sudoku board model.

No I/O, no CV, no web — just the grid, its units/peers, candidate derivation and
validity checks. Everything the hint engine needs lives here.

Coordinates are 0-indexed ``(row, col)`` throughout. Human-facing labels (``r1c1``,
``box 4``) are produced only at the edges, in :func:`cell_name` and the unit helpers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Iterator, Optional

DIGITS = tuple(range(1, 10))
COORDS = [(r, c) for r in range(9) for c in range(9)]


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


class Board:
    """A 9x9 Sudoku grid plus the structural helpers techniques rely on."""

    def __init__(self, cells: Optional[list[Cell]] = None):
        if cells is None:
            cells = [Cell() for _ in COORDS]
        if len(cells) != 81:
            raise ValueError("a board needs exactly 81 cells")
        self.cells: list[Cell] = cells

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

    @staticmethod
    def peers(r: int, c: int) -> set[tuple[int, int]]:
        """The 20 cells that share a row, column or box with ``(r, c)``."""
        result: set[tuple[int, int]] = set()
        result.update(Board.row_cells(r))
        result.update(Board.col_cells(c))
        result.update(Board.box_cells(box_index(r, c)))
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
        """No unit contains a repeated value."""
        for _, cells in self.units():
            seen: set[int] = set()
            for r, c in cells:
                v = self.value(r, c)
                if v is None:
                    continue
                if v in seen:
                    return False
                seen.add(v)
        return True

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
        return {
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
        return cls(cells)
