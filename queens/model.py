"""Pure-logic Queens board model.

No I/O, no CV, no web — just the board, its units/peers/neighbors, and validity
checks. Everything the future hint engine (issues #6-8) needs lives here.

Coordinates are 0-indexed ``(row, col)`` throughout, same as the Sudoku context.
Unlike Sudoku, board size N is data, not fixed — real boards run roughly
6x6-11x11 — so every structural helper takes ``self`` (an instance, carrying
``n``) rather than being a module-level constant.

This module shares no code with ``sudoku.model`` by design (see
``docs/adr/0001-sudoku-and-queens-as-separate-contexts.md``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Iterator, Optional

EMPTY = "empty"
MARKED = "marked"
QUEEN = "queen"
STATES = (EMPTY, MARKED, QUEEN)


@dataclass
class Cell:
    """A single square.

    ``region`` is the id of the Region this cell belongs to, or ``None`` if the
    cell hasn't been painted into a region yet. ``None`` is the sentinel for
    "unpainted" rather than e.g. a 0-id region, so a freshly-sized board (before
    any palette painting) round-trips through serialization without implying a
    real region 0 exists. Unpainted cells never conflict with each other on
    region grounds (see ``Board.is_valid``) since they carry no region identity.
    """

    state: str = EMPTY
    region: Optional[int] = None


def cell_name(r: int, c: int) -> str:
    """Human label like ``r4c3`` (1-indexed)."""
    return f"r{r + 1}c{c + 1}"


class Board:
    """An N x N Queens board plus the structural helpers techniques rely on."""

    def __init__(self, n: int, cells: Optional[list[Cell]] = None):
        self.n = n
        if cells is None:
            cells = [Cell() for _ in range(n * n)]
        if len(cells) != n * n:
            raise ValueError(f"a board of size {n} needs exactly {n * n} cells")
        self.cells: list[Cell] = cells

    # ---- access -------------------------------------------------------------

    def coords(self) -> list[tuple[int, int]]:
        return [(r, c) for r in range(self.n) for c in range(self.n)]

    def cell(self, r: int, c: int) -> Cell:
        return self.cells[r * self.n + c]

    def state(self, r: int, c: int) -> str:
        return self.cell(r, c).state

    def set_state(self, r: int, c: int, state: str) -> None:
        if state not in STATES:
            raise ValueError(f"unknown cell state: {state!r}")
        self.cell(r, c).state = state

    def region(self, r: int, c: int) -> Optional[int]:
        return self.cell(r, c).region

    def set_region(self, r: int, c: int, region_id: Optional[int]) -> None:
        self.cell(r, c).region = region_id

    def queen_cells(self) -> list[tuple[int, int]]:
        return [(r, c) for r, c in self.coords() if self.state(r, c) == QUEEN]

    # ---- units, peers & neighbors --------------------------------------------

    def row_cells(self, r: int) -> list[tuple[int, int]]:
        return [(r, c) for c in range(self.n)]

    def col_cells(self, c: int) -> list[tuple[int, int]]:
        return [(r, c) for r in range(self.n)]

    def region_ids(self) -> set[int]:
        """Distinct region ids painted onto the board so far (excludes unpainted)."""
        return {cell.region for cell in self.cells if cell.region is not None}

    def region_cells(self, region_id: int) -> list[tuple[int, int]]:
        return [(r, c) for r, c in self.coords() if self.region(r, c) == region_id]

    def units(self) -> Iterator[tuple[str, list[tuple[int, int]]]]:
        """Yield every row, column and (painted) region as ``(label, cells)``."""
        for r in range(self.n):
            yield f"row {r + 1}", self.row_cells(r)
        for c in range(self.n):
            yield f"column {c + 1}", self.col_cells(c)
        for region_id in sorted(self.region_ids()):
            yield f"region {region_id}", self.region_cells(region_id)

    def peers(self, r: int, c: int) -> set[tuple[int, int]]:
        """Cells that must not hold another queen alongside ``(r, c)`` by virtue
        of sharing its row, column, or region — the Queens analogue of Sudoku's
        ``peers``. Does not include adjacency; see ``neighbors`` for that."""
        result: set[tuple[int, int]] = set()
        result.update(self.row_cells(r))
        result.update(self.col_cells(c))
        region_id = self.region(r, c)
        if region_id is not None:
            result.update(self.region_cells(region_id))
        result.discard((r, c))
        return result

    def neighbors(self, r: int, c: int) -> set[tuple[int, int]]:
        """The up-to-8 cells adjacent to ``(r, c)``, including diagonals, clipped
        to the board edge."""
        result: set[tuple[int, int]] = set()
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if 0 <= nr < self.n and 0 <= nc < self.n:
                    result.add((nr, nc))
        return result

    # ---- status -------------------------------------------------------------

    def is_valid(self) -> bool:
        """No two queens share a row, column or region, and no two queens are
        adjacent (incl. diagonally)."""
        queens = self.queen_cells()
        seen_rows: set[int] = set()
        seen_cols: set[int] = set()
        seen_regions: set[int] = set()
        for r, c in queens:
            if r in seen_rows or c in seen_cols:
                return False
            seen_rows.add(r)
            seen_cols.add(c)
            region_id = self.region(r, c)
            if region_id is not None:
                if region_id in seen_regions:
                    return False
                seen_regions.add(region_id)
        queen_set = set(queens)
        for r, c in queens:
            if queen_set & self.neighbors(r, c):
                return False
        return True

    def is_solved(self) -> bool:
        """Every row, column and region holds exactly one queen."""
        if not self.is_valid():
            return False
        for _, cells in self.units():
            if sum(1 for r, c in cells if self.state(r, c) == QUEEN) != 1:
                return False
        return True

    # ---- serialization ------------------------------------------------------

    @classmethod
    def from_grid(cls, regions: Iterable[Iterable[int]]) -> "Board":
        """Build an empty board (no marks or queens) from an N x N grid of
        region ids — the Queens analogue of Sudoku's ``from_grid``, but the
        "grid" being loaded is region layout rather than digit values."""
        rows = [list(row) for row in regions]
        n = len(rows)
        if any(len(row) != n for row in rows):
            raise ValueError("from_grid expects a square N x N grid of region ids")
        cells = [Cell(region=int(rid)) for row in rows for rid in row]
        return cls(n, cells)

    def to_dict(self) -> dict:
        return {
            "n": self.n,
            "cells": [
                {"state": cell.state, "region": cell.region} for cell in self.cells
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Board":
        cells = [
            Cell(state=c.get("state", EMPTY), region=c.get("region"))
            for c in data["cells"]
        ]
        return cls(data["n"], cells)
