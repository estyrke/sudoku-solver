"""Top-level hint search, candidate bookkeeping, and a brute-force solver.

``find_hint`` returns the single simplest applicable step. The working candidate
grid it uses is seeded from the user's pencil marks when they have them, falling
back to candidates derived from board values — that way a hint reflects the state
the user is actually looking at. ``solve`` exists so the web layer can offer
"reveal this cell" and so tests can confirm a hint never contradicts the solution.
"""

from __future__ import annotations

from typing import Optional

from ..model import COORDS, Board
from .techniques import CandGrid, TECHNIQUES, Hint, Coord


def working_candidates(board: Board) -> CandGrid:
    """Build the candidate grid the engine reasons over.

    For each empty cell: use the user's pencil marks intersected with the legal
    (value-derived) candidates when marks exist; otherwise use the legal candidates
    directly. Intersecting keeps us sound even if the user pencilled an impossible
    digit.
    """
    cg: CandGrid = {}
    for r, c in COORDS:
        if board.value(r, c) is not None:
            continue
        legal = board.candidates(r, c)
        marks = board.cell(r, c).pencil_marks
        cg[(r, c)] = (marks & legal) if marks else legal
    return cg


def find_hint(board: Board, cg: Optional[CandGrid] = None) -> Optional[Hint]:
    """First applicable technique, simplest first. ``None`` if solved or stuck."""
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

    A placement removes the cell from the grid and clears that digit from peers; an
    elimination drops the listed digits from the named cells.

    Takes ``board`` because a cell's peers are board data once cages are in play,
    not something derivable from coordinates alone (see ``Board.peers``).
    """
    if hint.action == "place":
        (r, c) = hint.cells[0]
        d = hint.digits[0]
        cg.pop((r, c), None)
        for pr, pc in board.peers(r, c):
            if (pr, pc) in cg:
                cg[(pr, pc)].discard(d)
    else:
        for (r, c) in hint.cells:
            if (r, c) in cg:
                cg[(r, c)] -= set(hint.digits)
    return cg


def apply_hint(board: Board, hint: Hint) -> Board:
    """Return a copy of ``board`` with ``hint`` applied (values for placements,
    pencil marks for eliminations)."""
    new = Board.from_dict(board.to_dict())
    if hint.action == "place":
        (r, c) = hint.cells[0]
        new.set_value(r, c, hint.digits[0])
    else:
        for (r, c) in hint.cells:
            new.cell(r, c).pencil_marks -= set(hint.digits)
    return new


def solve_with_techniques(board: Board) -> tuple[Board, list[Hint], bool]:
    """Repeatedly apply ``find_hint`` until solved or stuck.

    Returns ``(final_board, steps, solved)``. Operates on a persistent candidate
    grid so eliminations accumulate. Placements are written back to the board.
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
            work.set_value(r, c, hint.digits[0])
        apply_to_candidates(work, cg, hint)
    return work, steps, work.is_solved()


def solve(board: Board) -> Optional[Board]:
    """Backtracking solver. Returns a solved copy, or ``None`` if unsolvable."""
    work = Board.from_dict(board.to_dict())
    if not work.is_valid():
        return None
    if _backtrack(work):
        return work
    return None


def _backtrack(board: Board) -> bool:
    best: Optional[Coord] = None
    best_cands: set[int] = set()
    for r, c in COORDS:
        if board.value(r, c) is None:
            cands = board.candidates(r, c)
            if not cands:
                return False
            if best is None or len(cands) < len(best_cands):
                best, best_cands = (r, c), cands
                if len(cands) == 1:
                    break
    if best is None:
        return True
    r, c = best
    cage = board.cage_at(r, c)
    for d in best_cands:
        board.set_value(r, c, d)
        # Cage sums aren't expressible as per-cell candidates, so they can't be
        # pruned above — without this check a classic-valid but sum-invalid grid
        # would be returned as a solution.
        if cage is None or board.cage_is_feasible(cage):
            if _backtrack(board):
                return True
        board.set_value(r, c, None)
    return False
