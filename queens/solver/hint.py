"""Backtracking solver entry point, mirroring ``sudoku/solver/hint.py``'s
``solve``/``_backtrack`` shape.

Only the backtracking ``solve`` is implemented in this pass (issue #4); the
confined-set hint search (``find_hint`` and friends, see
``queens/docs/adr/0001-general-primitives-not-named-patterns.md``) arrives in
issues #6-8 and will live alongside this function.
"""

from __future__ import annotations

from typing import Optional

from ..model import EMPTY, QUEEN, Board


def solve(board: Board) -> Optional[Board]:
    """Backtracking solver. Returns a solved copy, or ``None`` if unsolvable."""
    work = Board.from_dict(board.to_dict())
    if not work.is_valid():
        return None
    if _backtrack(work, 0):
        return work
    return None


def _backtrack(board: Board, row: int) -> bool:
    """Recurse row-by-row: exactly one queen must land in each row, so each
    level of recursion picks that row's column (or, if the row already has a
    queen from the starting board, moves straight on)."""
    if row == board.n:
        return True
    if any(board.state(row, c) == QUEEN for c in range(board.n)):
        return _backtrack(board, row + 1)
    for col in range(board.n):
        if board.state(row, col) != EMPTY:
            continue  # marked cells can never receive a queen
        if not _can_place(board, row, col):
            continue
        board.set_state(row, col, QUEEN)
        if _backtrack(board, row + 1):
            return True
        board.set_state(row, col, EMPTY)
    return False


def _can_place(board: Board, r: int, c: int) -> bool:
    region = board.region(r, c)
    for pr, pc in board.queen_cells():
        if pc == c:
            return False
        if region is not None and board.region(pr, pc) == region:
            return False
        if abs(pr - r) <= 1 and abs(pc - c) <= 1:
            return False
    return True
