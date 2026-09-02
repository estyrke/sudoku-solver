"""Top-level hint search, candidate bookkeeping, and a brute-force solver.

``find_hint`` returns the single simplest applicable step. The working candidate
grid it uses is seeded from the user's pencil marks when they have them, falling
back to candidates derived from board values — that way a hint reflects the state
the user is actually looking at. ``solve`` exists so the web layer can offer
"reveal this cell" and so tests can confirm a hint never contradicts the solution.
"""

from __future__ import annotations

from typing import Optional

from ..model import COORDS, DIGITS, Board, can_reach
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
        else:
            # Mirror the elimination onto the board's own pencil marks, not just
            # the candidate grid. An impossible mark is already absent from `cg`,
            # so without this the same hint would be re-found forever.
            for (r, c) in hint.cells:
                work.cell(r, c).pencil_marks -= set(hint.digits)
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
    """Depth-first search with cage-sum propagation.

    Two things made the straightforward version unusable on a real Killer board.
    It rebuilt every empty cell's candidate set from the board at every node —
    34 million set constructions, 800 million cell lookups, on a board that took
    108 seconds to crack. And it pruned only by asking whether the cage it had
    just written into was still *arithmetically* completable, which is far weaker
    than asking which digits its remaining cells can still hold: a cage whose sum
    had become unreachable for a particular cell went unnoticed until the search
    wandered all the way into it.

    So candidates are carried incrementally and undone on backtrack, and each
    placement re-prunes its cage down to digits that can still complete the
    remaining total. Killer boards start nearly empty and lean on cage sums for
    most of their constraint, so that propagation is what makes the search finite
    in practice rather than merely in principle.
    """
    cands: dict[Coord, set[int]] = {}
    for r, c in COORDS:
        if board.value(r, c) is None:
            cands[(r, c)] = board.candidates(r, c)
            if not cands[(r, c)]:
                return False
    peers = {cell: tuple(board.peers(*cell)) for cell in cands}

    # Per-cage bookkeeping, kept in step with the board: what the cage still owes,
    # which of its cells are still empty, and which digits it has not used up.
    cage_of: dict[Coord, int] = {}
    owed: list[int] = []
    empty: list[set[Coord]] = []
    unused: list[set[int]] = []
    for i, cage in enumerate(board.cages):
        used, blank = set(), set()
        for cell in cage.cells:
            cage_of[cell] = i
            v = board.value(*cell)
            blank.add(cell) if v is None else used.add(v)
        owed.append(cage.sum - sum(used))
        empty.append(blank)
        unused.append(set(DIGITS) - used)

    def strip(cell: Coord, gone: set[int], undo: list) -> bool:
        """Remove ``gone`` from ``cell``'s candidates; False if nothing survives."""
        hit = cands[cell] & gone
        if not hit:
            return True
        cands[cell] -= hit
        undo.append((cell, hit))
        return bool(cands[cell])

    def prune(i: int, undo: list) -> bool:
        """Cut cage ``i``'s empty cells to digits that can still complete its sum."""
        cells, rem, pool = empty[i], owed[i], frozenset(unused[i])
        k = len(cells)
        if k == 0:
            return rem == 0
        for cell in cells:
            keep = {
                d
                for d in cands[cell]
                if d in pool and can_reach(k - 1, rem - d, pool - {d})
            }
            if not strip(cell, cands[cell] - keep, undo):
                return False
        return True

    opening: list = []
    for i in range(len(board.cages)):
        if not prune(i, opening):
            return False

    def step() -> bool:
        if not cands:
            return True
        cell = min(cands, key=lambda x: len(cands[x]))
        i = cage_of.get(cell)
        for d in sorted(cands[cell]):
            undo: list = []
            saved = cands.pop(cell)
            ok = all(strip(p, {d}, undo) for p in peers[cell] if p in cands)
            touched = ok and i is not None
            if touched:
                empty[i].discard(cell)
                owed[i] -= d
                unused[i].discard(d)
                ok = prune(i, undo)
            if ok:
                board.set_value(*cell, d)
                if step():
                    return True
                board.set_value(*cell, None)
            if touched:
                empty[i].add(cell)
                owed[i] += d
                unused[i].add(d)
            for other, hit in undo:
                cands[other] |= hit
            cands[cell] = saved
        return False

    return step()
