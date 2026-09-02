"""Check the board against its own solution and report the player's mistakes.

This is not a solving technique — it is the answer to "why is nothing working?",
which the technique catalog cannot give. Three states look identical from the
player's chair, and only one of them means the catalog is genuinely out of ideas:

*A digit is entered wrong.* If it merely disagrees with the solution rather than
repeating in a unit, nothing flags it. The board becomes unsolvable and the solve
endpoint blames the cage sums, which is the wrong place to look.

*A pencil mark is missing.* The engine reasons over the player's marks
intersected with what is legal (``hint.working_candidates``), so rubbing out a
mark silently deletes a true candidate. Every later deduction is then made in a
world where that digit does not exist — the engine will happily "prove" something
false, or stall exactly like an exhausted catalog. This is the dangerous one,
because nothing about it looks like an error.

*The cages don't pin the board down.* More than one solution usually means a cage
sum was misread. It also makes the pencil-mark check unsafe, since a digit absent
from one solution may be needed by another, so that check is skipped.

Naming policy: a wrong entry is the player's own and gets named outright. A
missing mark names the cell but never the digit — the digit *is* the answer for
that cell, and a hint engine that blurts it out has stopped being one.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..model import COORDS, DIGITS, Board, cell_name
from .hint import solutions

FULL_TOTAL = sum(DIGITS) * 9  # 405: nine units of 1-9, partitioned into cages

Coord = tuple[int, int]


@dataclass
class Audit:
    """What is wrong with the board, if anything.

    ``verdict`` is one of ``"ok"``, ``"wrong-cage"``, ``"wrong-value"``,
    ``"missing-mark"`` or ``"ambiguous"``. ``cells`` are the ones to look at.
    """

    verdict: str
    cells: list[Coord] = field(default_factory=list)
    message: str = ""

    @property
    def clean(self) -> bool:
        return self.verdict == "ok"

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "cells": [{"r": r, "c": c} for r, c in self.cells],
            "message": self.message,
        }


def _placed(board: Board) -> list[Coord]:
    return [cell for cell in COORDS if board.value(*cell) is not None]


def _without(board: Board, cell: Coord) -> Board:
    cleared = Board.from_dict(board.to_dict())
    cleared.set_value(*cell, None)
    return cleared


def _blame(board: Board) -> list[Coord]:
    """Entered cells that, cleared one at a time, make the board solvable again."""
    return [
        cell for cell in _placed(board) if solutions(_without(board, cell), limit=1)
    ]


def _names(cells: list[Coord]) -> str:
    return ", ".join(cell_name(r, c) for r, c in cells)


def _checksum_off(board: Board) -> Audit | None:
    """The 45-per-unit check, which localises a misread sum for free.

    Worth asking before anything else: it is arithmetic rather than search, and
    it separates "a cage sum is wrong" from "a digit you entered is wrong", which
    the solver on its own cannot tell apart.
    """
    if not board.cages or not board.is_fully_caged():
        return None
    total = sum(cage.sum for cage in board.cages)
    if total == FULL_TOTAL:
        return None
    off = total - FULL_TOTAL
    return Audit(
        "wrong-cage",
        [min(cage.cells) for cage in board.cages],
        f"The cage sums total {total}, but every cell is in a cage and each of "
        f"the nine rows holds 1-9, so they have to total {FULL_TOTAL}. At least "
        f"one sum is {abs(off)} too {'high' if off > 0 else 'low'} — fix that "
        f"before trusting anything else here.",
    )


def audit(board: Board) -> Audit:
    """Diagnose the board. Cheap enough to run before every hint."""
    if board.cages and not board.is_fully_caged():
        # Mid-way through drawing the cages, every verdict below would be an
        # artefact of the ones not drawn yet. Say nothing rather than something
        # wrong; hints still work off what is there.
        return Audit(
            "incomplete",
            [],
            "Some cells aren't in a cage yet, so there's nothing to check against.",
        )

    bad_sum = _checksum_off(board)
    if bad_sum is not None:
        return bad_sum

    found = solutions(board, limit=2)

    if len(found) > 1:
        return Audit(
            "ambiguous",
            [],
            "This board has more than one solution, so "
            + (
                "the cages aren't pinning it down — check the cage sums against "
                "the screenshot."
                if board.cages
                else "there isn't enough on it to determine one answer."
            )
            + " Until that's fixed a hint may point somewhere the puzzle doesn't "
            "actually go.",
        )

    if not found:
        entered = _placed(board)
        if not entered:
            return Audit(
                "wrong-value",
                [],
                "No arrangement of digits satisfies these cages, and nothing has "
                "been entered yet — so a cage sum or a cage outline is wrong.",
            )
        suspects = _blame(board)
        if not suspects:
            return Audit(
                "wrong-value",
                entered,
                "This board has no solution, and no single entry explains it — at "
                "least two of the digits you've entered are wrong, or a cage sum "
                "is. Clearing the ones you're least sure of is the way back.",
            )
        if len(suspects) == 1:
            return Audit(
                "wrong-value",
                suspects,
                f"{_names(suspects)} is wrong — clear it and the board solves. "
                "Everything deduced from it since is suspect too.",
            )
        return Audit(
            "wrong-value",
            suspects,
            f"One of {_names(suspects)} is wrong: clearing any one of them on its "
            "own makes the board solvable again, so they can't all be right.",
        )

    answer = found[0]
    rubbed_out = [
        cell
        for cell in COORDS
        if board.value(*cell) is None
        and board.cell(*cell).pencil_marks
        and answer.value(*cell) not in board.cell(*cell).pencil_marks
    ]
    if rubbed_out:
        return Audit(
            "missing-mark",
            rubbed_out,
            f"{_names(rubbed_out)} {'is' if len(rubbed_out) == 1 else 'are'} "
            f"missing a pencil mark the solution needs. The engine only ever "
            f"considers digits you've pencilled, so a rubbed-out mark takes the "
            f"real answer off the table — which is why nothing further follows. "
            f"(Not saying which digit: that would be the answer.)",
        )

    return Audit("ok", [], "No mistakes found — the board is consistent.")
