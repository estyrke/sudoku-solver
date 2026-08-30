"""Top-level hint search, candidate bookkeeping, and the backtracking solver —
mirrors ``sudoku/solver/hint.py``'s shape.

``find_hint`` returns the single simplest applicable step, walking
``TECHNIQUES`` (see ``techniques.py``) in order. ``working_candidates`` builds
the candidate grid it reasons over fresh from the board each time it's called:
Queens has no pencil-mark-vs-derived-candidate reconciliation to do the way
Sudoku does, since a Mark already *is* the board's record of "ruled out" —
there's no separate mark set to intersect against legal candidates.

``solve`` (backtracking) was added in issue #4; this pass (#6) adds the
elimination-propagation bookkeeping and hint search alongside it.
"""

from __future__ import annotations

from typing import Optional

from ..model import EMPTY, MARKED, QUEEN, Board
from .techniques import CandGrid, Coord, Hint, TECHNIQUES


def working_candidates(board: Board) -> CandGrid:
    """Build the candidate grid the engine reasons over: every empty cell not
    ruled out by an existing queen's row, column, region (``Board.peers``) or
    8-neighbors (``Board.neighbors``) — Queens' elimination-propagation
    bookkeeping. Marked cells are excluded automatically since they aren't
    ``EMPTY``; a Mark carries no extra information beyond "not a candidate"
    (see ``queens/CONTEXT.md``).
    """
    blocked: set[Coord] = set()
    for r, c in board.queen_cells():
        blocked.update(board.peers(r, c))
        blocked.update(board.neighbors(r, c))
    return {
        (r, c)
        for r, c in board.coords()
        if board.state(r, c) == EMPTY and (r, c) not in blocked
    }


def find_hint(board: Board, cg: Optional[CandGrid] = None) -> Optional[Hint]:
    """First applicable technique, simplest first. ``None`` if invalid,
    solved, or stuck (no implemented technique applies)."""
    if not board.is_valid():
        return None
    if cg is None:
        cg = working_candidates(board)
    for technique in TECHNIQUES:
        hint = technique(board, cg)
        if hint is not None:
            return hint
    return None


def apply_to_candidates(board: Board, cg: CandGrid, hint: Hint) -> CandGrid:
    """Apply a hint to a candidate grid in place and return it.

    Takes ``board`` in addition to ``(cg, hint)`` — unlike Sudoku's
    ``apply_to_candidates(cg, hint)`` — because a cell's peers/neighbors
    depend on board size and region layout here, which are instance data
    (``Board.n``, per-cell ``region``) rather than a fixed 9x9 layout ``sudoku``
    can compute from coordinates alone.

    A placement drops the placed cell from ``cg`` and propagates elimination
    to its peers and neighbors, exactly like ``working_candidates`` does for
    a queen already on the board. An elimination (issues #7/#8) just drops
    the named cells.
    """
    if hint.action == "place":
        (r, c) = hint.cells[0]
        cg.discard((r, c))
        cg -= board.peers(r, c)
        cg -= board.neighbors(r, c)
    else:
        for cell in hint.cells:
            cg.discard(cell)
    return cg


def apply_hint(board: Board, hint: Hint) -> Board:
    """Return a copy of ``board`` with ``hint`` applied (a queen for a
    placement, a mark for an elimination)."""
    new = Board.from_dict(board.to_dict())
    if hint.action == "place":
        (r, c) = hint.cells[0]
        new.set_state(r, c, QUEEN)
    else:
        for (r, c) in hint.cells:
            new.set_state(r, c, MARKED)
    return new


def solve_with_techniques(board: Board) -> tuple[Board, list[Hint], bool]:
    """Repeatedly apply ``find_hint`` until solved or stuck.

    Returns ``(final_board, steps, solved)``. Operates on a persistent
    candidate grid so eliminations accumulate, and writes placements back to
    the board as it goes (mirroring ``sudoku.solver.hint.solve_with_techniques``).
    """
    work = Board.from_dict(board.to_dict())
    cg = working_candidates(work)
    steps: list[Hint] = []
    while True:
        hint = find_hint(work, cg)
        if hint is None:
            break
        steps.append(hint)
        if hint.action == "place":
            (r, c) = hint.cells[0]
            work.set_state(r, c, QUEEN)
        else:
            for (r, c) in hint.cells:
                work.set_state(r, c, MARKED)
        apply_to_candidates(work, cg, hint)
    return work, steps, work.is_solved()


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
