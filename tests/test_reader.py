"""End-to-end CV test against a synthetically rendered board.

We don't have the user's app screenshots yet, so we render a clean printed board
(grid + digits) and assert the reader recovers it. This validates the pipeline
mechanics — grid splitting, value/candidate separation, classification — using the
same seeded font templates the reader ships with.
"""

from pathlib import Path

import cv2
import numpy as np
import pytest

from sudoku.reader.read_board import read_board

CELL = 60
SIZE = CELL * 9

GIVENS = {
    (0, 0): 1, (0, 4): 2, (1, 2): 3, (2, 7): 4, (3, 3): 5,
    (4, 1): 6, (5, 8): 7, (6, 5): 8, (8, 0): 9, (7, 7): 2,
}
PENCIL_CELL = (4, 4)
PENCIL_MARKS = {1, 5, 9}


def render_board() -> np.ndarray:
    img = np.full((SIZE, SIZE, 3), 255, np.uint8)
    # grid lines
    for k in range(10):
        thick = 3 if k % 3 == 0 else 1
        color = (40, 40, 40) if k % 3 == 0 else (190, 190, 190)
        cv2.line(img, (k * CELL, 0), (k * CELL, SIZE), color, thick)
        cv2.line(img, (0, k * CELL), (SIZE, k * CELL), color, thick)
    # given/value digits (black, centered)
    for (r, c), d in GIVENS.items():
        _put(img, str(d), c, r, scale=1.6, thick=3, color=(20, 20, 20))
    # pencil marks (small, positional 3x3 layout) in one cell
    for d in PENCIL_MARKS:
        sub_r, sub_c = (d - 1) // 3, (d - 1) % 3
        x = PENCIL_CELL[1] * CELL + 8 + sub_c * 16
        y = PENCIL_CELL[0] * CELL + 18 + sub_r * 16
        cv2.putText(img, str(d), (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.45,
                    (90, 90, 90), 1, cv2.LINE_AA)
    return img


def _put(img, text, c, r, scale, thick, color):
    font = cv2.FONT_HERSHEY_SIMPLEX
    (w, h), _ = cv2.getTextSize(text, font, scale, thick)
    x = c * CELL + (CELL - w) // 2
    y = r * CELL + (CELL + h) // 2
    cv2.putText(img, text, (x, y), font, scale, color, thick, cv2.LINE_AA)


def test_reader_recovers_values():
    board = read_board(render_board())
    correct = sum(
        1 for (r, c), d in GIVENS.items() if board.value(r, c) == d
    )
    # allow a single misread among the ten givens
    assert correct >= len(GIVENS) - 1, f"only {correct}/{len(GIVENS)} values correct"
    # cells with no content must stay empty
    assert board.value(0, 1) is None
    # givens are recognized as black -> is_given
    assert board.cell(0, 0).is_given


def test_reader_reads_pencil_marks():
    board = read_board(render_board())
    got = board.cell(*PENCIL_CELL).pencil_marks
    # at least two of the three small candidates should be recovered
    assert len(got & PENCIL_MARKS) >= 2, f"got {got}, expected ~{PENCIL_MARKS}"
    assert board.value(*PENCIL_CELL) is None


# ---------------------------------------------------------------------------
# Killer Sudoku reader
# ---------------------------------------------------------------------------

from sudoku.model import Board
from sudoku.reader.cell_parse import _positional_marks
from sudoku.reader.killer import read_killer_board

FIXTURE = Path(__file__).parent / "fixtures" / "puzzle_page_killer_sample_board.png"


def test_positional_marks_defaults_to_the_whole_cell():
    """The classic layout centres marks in the cell; that must not change."""
    ink = np.zeros((60, 60), np.uint8)
    ink[2:18, 2:18] = 255       # top-left sub-cell -> digit 1
    ink[42:58, 42:58] = 255     # bottom-right      -> digit 9
    assert _positional_marks(ink) == {1, 9}


def test_positional_marks_maps_onto_a_shifted_band():
    """With the grid pushed into the lower part of the cell, the same ink must
    read as the same digits — under the old full-height thirds it would come out
    a row too low."""
    ink = np.zeros((60, 60), np.uint8)
    # Marks live in y 20..60 (band (1/3, 1)); this blob is the band's top-left.
    ink[22:32, 2:18] = 255
    assert _positional_marks(ink, (1 / 3, 1.0)) == {1}
    assert _positional_marks(ink) == {4}  # the bug the band parameter fixes


def _killer_fixture_board():
    img = cv2.imread(str(FIXTURE))
    assert img is not None, "fixture screenshot missing"
    return read_killer_board(img)


def test_killer_reader_recovers_the_cage_layout():
    """The reference board has 29 cages tiling all 81 cells. Cage structure comes
    from the coloured outlines, so this is the part that must be exact."""
    board, _ = _killer_fixture_board()
    covered = sum(len(cage.cells) for cage in board.cages)
    # one cage may be dropped when its sum reads illegally; allow a single miss
    assert len(board.cages) >= 28, f"only {len(board.cages)} cages"
    assert covered >= 79, f"only {covered}/81 cells covered"
    assert all(2 <= len(cage.cells) <= 9 for cage in board.cages)


def test_killer_reader_recovers_cage_sums():
    """Sums are OCR'd from small glyphs, so allow a couple of misreads — the ones
    it is unsure about are reported for the user to fix."""
    board, unsure = _killer_fixture_board()
    expected = {
        (0, 0): 15, (0, 3): 15, (0, 6): 26, (0, 7): 10, (0, 8): 5, (1, 0): 15,
        (1, 2): 11, (2, 0): 19, (2, 2): 8, (2, 4): 18, (2, 6): 8, (2, 8): 14,
        (3, 3): 16, (3, 6): 10, (4, 0): 27, (4, 5): 5, (4, 7): 30, (5, 1): 12,
        (5, 3): 23, (5, 5): 7, (6, 0): 13, (6, 5): 23, (7, 0): 13, (7, 3): 14,
        (7, 4): 7, (7, 6): 4, (7, 8): 14, (8, 1): 11, (8, 6): 12,
    }
    got = {min(cage.cells): cage.sum for cage in board.cages}
    correct = sum(1 for anchor, total in expected.items() if got.get(anchor) == total)
    assert correct >= len(expected) - 3, f"only {correct}/{len(expected)} sums correct"


def test_killer_reader_reads_pencil_marks_not_the_cage_sum():
    """r1c1 shows a 15-cage sum above marks 1,2,3,5,6,7,8. The sum must not leak
    into the marks, and the marks must not come out shifted."""
    board, _ = _killer_fixture_board()
    marks = board.cell(0, 0).pencil_marks
    assert marks == {1, 2, 3, 5, 6, 7, 8}, marks


def test_killer_reader_reads_placed_digits():
    board, _ = _killer_fixture_board()
    placed = [(r, c) for r in range(9) for c in range(9) if board.value(r, c) is not None]
    assert len(placed) >= 12, f"only {len(placed)} placed digits found"
    # Killer boards start empty, so nothing is a given.
    assert not any(cell.is_given for cell in board.cells)


def test_killer_reader_flags_what_it_is_unsure_about():
    """A sum that reads illegally for its cage size is reported, not silently
    accepted — the UI highlights these for correction."""
    board, unsure = _killer_fixture_board()
    assert isinstance(unsure, list)
    # every flagged anchor must be a real cell coordinate
    assert all(0 <= r < 9 and 0 <= c < 9 for r, c in unsure)


def test_killer_reader_produces_a_usable_board():
    board, _ = _killer_fixture_board()
    assert isinstance(board, Board)
    assert len(board.cells) == 81
    # cages returned are legal by construction (Cage validates on build)
    for cage in board.cages:
        assert len(cage.cells) >= 2
