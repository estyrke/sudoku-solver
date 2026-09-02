"""The board audit: telling a player's mistake apart from an exhausted catalog."""

from pathlib import Path

import cv2
import pytest

from sudoku.model import Board, Cage
from sudoku.reader.killer import read_killer_board
from sudoku.solver.audit import audit
from sudoku.solver.hint import solutions

FIXTURE3 = Path(__file__).parent / "fixtures" / "puzzle_page_killer_board3.png"


@pytest.fixture(scope="module")
def killer_board():
    """A real read of a real screenshot — clean, and known to have one solution."""
    return read_killer_board(cv2.imread(str(FIXTURE3))).board


def _copy(board: Board) -> Board:
    return Board.from_dict(board.to_dict())


def test_a_clean_board_audits_clean(killer_board):
    report = audit(killer_board)
    assert report.verdict == "ok", report.message
    assert report.clean
    assert report.cells == []


def test_the_audit_stays_clean_through_a_whole_solve(killer_board):
    """A sound technique must never make the board look like a mistake.

    The audit gates every hint, so a false accusation would be worse than the
    silence it replaced: it would stop the engine dead on a board that is fine.
    Walk the catalog from the read board to a finished one, auditing each step.
    """
    from sudoku.solver.hint import apply_to_candidates, find_hint, working_candidates

    work = _copy(killer_board)
    cg = working_candidates(work)
    steps = 0
    while (hint := find_hint(work, cg)) is not None and steps < 500:
        steps += 1
        if hint.action == "place":
            work.set_value(*hint.cells[0], hint.digits[0])
        else:
            for cell in hint.cells:
                work.cell(*cell).pencil_marks -= set(hint.digits)
        apply_to_candidates(work, cg, hint)
        report = audit(work)
        assert report.clean, f"step {steps} ({hint.technique}): {report.message}"

    assert work.is_solved(), f"stalled after {steps} steps"


def test_a_wrong_entry_is_named(killer_board):
    """A digit that conflicts with nothing, and is simply not the answer.

    Nothing else on the board flags this: is_valid passes, no unit repeats, no
    cage overshoots. It only shows up as the puzzle quietly becoming unsolvable.
    """
    answer = solutions(killer_board, limit=1)[0]
    # legal where it sits, just not the answer — so no rule catches it
    wrong = min(killer_board.candidates(0, 0) - {answer.value(0, 0)})

    board = _copy(killer_board)
    board.set_value(0, 0, wrong)
    assert board.is_valid(), "the point is a mistake that isn't a rule violation"

    report = audit(board)
    assert report.verdict == "wrong-value"
    assert report.cells == [(0, 0)]
    assert "r1c1" in report.message


def test_a_rubbed_out_pencil_mark_is_named_but_not_spelled_out(killer_board):
    """Naming the digit would be handing over the answer for that cell."""
    answer = solutions(killer_board, limit=1)[0]
    needed = answer.value(0, 0)

    board = _copy(killer_board)
    assert needed in board.cell(0, 0).pencil_marks
    board.cell(0, 0).pencil_marks.discard(needed)

    report = audit(board)
    assert report.verdict == "missing-mark"
    assert report.cells == [(0, 0)]
    assert "r1c1" in report.message
    assert str(needed) not in report.message


def test_a_cell_with_no_marks_at_all_is_not_a_missing_mark(killer_board):
    """An empty cell means "I haven't pencilled this yet", not "I ruled it out".

    ``working_candidates`` falls back to the legal candidates there, so nothing
    has been lost and there is nothing to report.
    """
    board = _copy(killer_board)
    board.cell(0, 0).pencil_marks.clear()
    assert audit(board).clean


def test_a_misread_cage_sum_is_caught_by_arithmetic_not_search(killer_board):
    """405 localises the *kind* of mistake for free, which search cannot do."""
    cages = list(killer_board.cages)
    cages[0] = Cage.of(cages[0].cells, cages[0].sum + 1)
    board = Board(_copy(killer_board).cells, cages)

    report = audit(board)
    assert report.verdict == "wrong-cage"
    assert "406" in report.message and "405" in report.message
    assert "1 too high" in report.message


def test_an_ambiguous_board_blocks_the_pencil_mark_check():
    """With several solutions, a digit missing from one cell's marks may be
    exactly right — so the mark check must not run and claim a mistake."""
    board = Board()
    board.cell(0, 0).pencil_marks = {1, 2}
    assert len(solutions(board, limit=2)) == 2

    report = audit(board)
    assert report.verdict == "ambiguous"
    assert "more than one solution" in report.message


def test_a_half_drawn_cage_layout_is_not_judged():
    """Mid-way through drawing cages every verdict would be about the ones that
    aren't there yet, so the audit declines to have an opinion."""
    board = Board(cages=[Cage.of([(0, 0), (0, 1)], 5)])
    report = audit(board)
    assert report.verdict == "incomplete"
    assert not report.clean


def test_an_unsolvable_board_with_nothing_entered_blames_the_cages(killer_board):
    """Two sums moved in opposite directions: 405 still checks out, but no
    arrangement of digits satisfies them, and nothing has been entered to blame."""
    cages = list(killer_board.cages)
    cages[0] = Cage.of(cages[0].cells, cages[0].sum + 1)
    cages[1] = Cage.of(cages[1].cells, cages[1].sum - 1)
    board = Board(cages=cages)
    assert sum(c.sum for c in board.cages) == 405

    report = audit(board)
    assert report.verdict == "wrong-value"
    assert report.cells == []
    assert "nothing has been entered" in report.message


def test_two_wrong_entries_are_reported_as_such(killer_board):
    """When no single entry explains it, saying which one is wrong would be a lie."""
    answer = solutions(killer_board, limit=1)[0]
    board = _copy(killer_board)
    swapped = 0
    for r in range(9):
        for c in range(9):
            if board.value(r, c) is None and swapped < 2:
                board.set_value(r, c, (answer.value(r, c) % 9) + 1)
                swapped += 1
    assert swapped == 2

    report = audit(board)
    assert report.verdict == "wrong-value"
    assert "at least two" in report.message
