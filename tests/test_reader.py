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
FIXTURE2 = Path(__file__).parent / "fixtures" / "puzzle_page_killer_board2.png"
FIXTURE3 = Path(__file__).parent / "fixtures" / "puzzle_page_killer_board3.png"


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


def _killer_fixture_read():
    img = cv2.imread(str(FIXTURE))
    assert img is not None, "fixture screenshot missing"
    return read_killer_board(img)


def test_killer_reader_recovers_the_cage_layout():
    """The reference board has 29 cages tiling all 81 cells. Cage structure comes
    from the coloured outlines, so this is the part that must be exact."""
    board = _killer_fixture_read().board
    covered = sum(len(cage.cells) for cage in board.cages)
    # one cage may be dropped when its sum reads illegally; allow a single miss
    # a doubtful sum no longer discards the cage, so structure should be complete
    assert len(board.cages) == 29, f"got {len(board.cages)} cages"
    assert covered == 81, f"only {covered}/81 cells covered"
    assert board.is_fully_caged()
    assert all(2 <= len(cage.cells) <= 9 for cage in board.cages)


def test_killer_reader_recovers_cage_sums():
    """Every sum, exactly. This was 27/29 until the crop was widened and cage
    outlines were excluded by shape rather than by dodging them."""
    read = _killer_fixture_read()
    board, unsure = read.board, read.unsure
    expected = {
        (0, 0): 15, (0, 3): 15, (0, 6): 26, (0, 7): 10, (0, 8): 5, (1, 0): 15,
        (1, 2): 11, (2, 0): 19, (2, 2): 8, (2, 4): 18, (2, 6): 8, (2, 8): 14,
        (3, 3): 16, (3, 6): 10, (4, 0): 27, (4, 5): 5, (4, 7): 30, (5, 1): 12,
        (5, 3): 23, (5, 5): 7, (6, 0): 13, (6, 5): 23, (7, 0): 13, (7, 3): 14,
        (7, 4): 7, (7, 6): 4, (7, 8): 14, (8, 1): 11, (8, 6): 12,
    }
    got = {min(cage.cells): cage.sum for cage in board.cages}
    assert got == expected


def test_killer_reader_reads_pencil_marks_not_the_cage_sum():
    """r1c1 shows a 15-cage sum above marks 1,2,3,5,6,7,8. The sum must not leak
    into the marks, and the marks must not come out shifted."""
    board = _killer_fixture_read().board
    marks = board.cell(0, 0).pencil_marks
    assert marks == {1, 2, 3, 5, 6, 7, 8}, marks


def test_killer_reader_reads_placed_digits():
    board = _killer_fixture_read().board
    placed = [(r, c) for r in range(9) for c in range(9) if board.value(r, c) is not None]
    assert len(placed) >= 12, f"only {len(placed)} placed digits found"
    # Killer boards start empty, so nothing is a given.
    assert not any(cell.is_given for cell in board.cells)


def test_killer_reader_flags_what_it_is_unsure_about():
    """A sum that reads illegally for its cage size is reported, not silently
    accepted — the UI highlights these for correction."""
    read = _killer_fixture_read()
    board, unsure = read.board, read.unsure
    assert isinstance(unsure, list)
    # every flagged anchor must be a real cell coordinate
    assert all(0 <= r < 9 and 0 <= c < 9 for r, c in unsure)


def test_killer_reader_produces_a_usable_board():
    board = _killer_fixture_read().board
    assert isinstance(board, Board)
    assert len(board.cells) == 81
    # cages returned are legal by construction (Cage validates on build)
    for cage in board.cages:
        assert len(cage.cells) >= 2


def test_killer_reader_checksum_is_clean_on_every_reference_board():
    """All three reference screenshots read exactly, so the 9x45 checksum passes
    and nothing is flagged for review."""
    for path in (FIXTURE, FIXTURE2, FIXTURE3):
        read = read_killer_board(cv2.imread(str(path)))
        assert read.board.is_fully_caged(), path.name
        assert read.sum_total == 405, f"{path.name}: {read.sum_total}"
        assert read.checksum_ok and not read.needs_review, path.name


def test_killer_reader_handles_a_second_board_layout():
    """A different cage layout entirely — 25 cages rather than 29 — so the
    outline segmentation isn't just fitting the one board."""
    read = read_killer_board(cv2.imread(str(FIXTURE2)))
    assert len(read.board.cages) == 25
    assert sum(len(c.cells) for c in read.board.cages) == 81
    got = {min(c.cells): c.sum for c in read.board.cages}
    assert got == {
        (0,0):21,(0,1):15,(0,4):8,(0,5):21,(0,6):17,(1,1):21,(1,3):9,(1,7):31,
        (2,4):7,(3,1):22,(3,3):12,(3,5):16,(3,8):10,(4,2):15,(4,3):17,(4,6):5,
        (5,0):4,(5,6):36,(5,7):15,(6,0):13,(6,2):27,(6,8):21,(7,0):9,(7,2):15,
        (7,3):18,
    }


def test_cage_outline_is_not_read_as_a_leading_one():
    """Regression: a cage's left outline clipped into the sum crop as a 1px-wide
    sliver, which passed the size filters and — being a tall thin stroke —
    classified as a 1, turning r8c1's 9 into a 19."""
    read = read_killer_board(cv2.imread(str(FIXTURE2)))
    by_anchor = {min(c.cells): c.sum for c in read.board.cages}
    assert by_anchor[(7, 0)] == 9, "leading-1 sliver is back"


def test_killer_checksum_passes_on_a_correct_board():
    """Sanity-check the checksum itself: cages built from a real solution total 405."""
    from sudoku.model import Board as B, Cage
    from sudoku.reader.killer import KillerRead

    solved = B.from_string(
        "534678912672195348198342567859761423426853791713924856961537284287419635345286179"
    )
    spans = [(0, 2), (2, 4), (4, 6), (6, 9)]
    cages = [
        Cage.of([(r, c) for c in range(a, b)], sum(solved.value(r, c) for c in range(a, b)))
        for r in range(9) for a, b in spans
    ]
    read = KillerRead(B(cages=cages), [], sum(c.sum for c in cages))
    assert read.sum_total == 405
    assert read.checksum_ok
    assert not read.needs_review


def test_killer_reader_handles_a_third_board_layout():
    """A third cage layout, 28 cages, every sum exact."""
    read = read_killer_board(cv2.imread(str(FIXTURE3)))
    assert len(read.board.cages) == 28
    assert sum(len(c.cells) for c in read.board.cages) == 81
    got = {min(c.cells): c.sum for c in read.board.cages}
    assert got == {
        (0,0):18,(0,1):10,(0,3):7,(0,4):18,(0,6):6,(0,8):25,(1,4):11,(2,0):9,
        (2,1):14,(2,2):20,(2,6):9,(2,8):19,(3,3):8,(3,5):18,(3,7):32,(4,0):17,
        (4,2):12,(5,1):14,(5,4):17,(6,0):6,(6,1):6,(6,3):8,(6,5):13,(6,6):20,
        (6,8):24,(7,1):17,(8,0):16,(8,4):11,
    }


def test_killer_reader_reads_the_apps_italic_one():
    """Regression: Puzzle Page sets its digits in an italic face, and an italic 1 —
    a stroke leaning right off a short flag — is structurally a 7. Against upright
    Hershey exemplars the 7 won by 0.615 to 0.603 and two of these three read as
    7s. Slanted copies of every exemplar settle it."""
    board = read_killer_board(cv2.imread(str(FIXTURE3))).board
    ones = [(r, c) for r in range(9) for c in range(9) if board.value(r, c) == 1]
    assert ones == [(6, 7), (7, 0), (8, 3)], f"expected three 1s, got {ones}"
    assert not any(board.value(r, c) == 7 for r in range(9) for c in range(9))


def test_killer_reader_reads_every_placed_digit_of_the_third_board():
    """The whole pen grid, exactly — the digit counts the app prints under its
    keypad (three 1s, three 2s, one 3, two 4s, ...) add up to these thirteen."""
    board = read_killer_board(cv2.imread(str(FIXTURE3))).board
    placed = {
        (r, c): board.value(r, c)
        for r in range(9)
        for c in range(9)
        if board.value(r, c) is not None
    }
    assert placed == {
        (2, 3): 9, (3, 3): 6, (3, 4): 2, (5, 4): 4, (6, 0): 5, (6, 3): 3,
        (6, 7): 1, (7, 0): 1, (7, 3): 4, (7, 6): 2, (8, 3): 1, (8, 4): 9,
        (8, 5): 2,
    }


def test_board_frame_is_not_read_as_pencil_marks():
    """Regression: in the bottom-right cell the outer frame sits closest to the
    border crop and survived it as a full-width, one-pixel-tall hairline. Spread
    across the three bottom sub-cells it cleared the ink threshold on its own,
    inventing marks the player never wrote."""
    assert read_killer_board(cv2.imread(str(FIXTURE3))).board.cell(8, 8).pencil_marks == {5, 8}
    assert read_killer_board(cv2.imread(str(FIXTURE2))).board.cell(8, 8).pencil_marks == {
        1, 2, 3, 4, 5, 6, 7, 9
    }


def test_positional_marks_ignores_a_hairline():
    """The filter is on shape, not on a raised ink threshold: a line one pixel
    thick is not a digit however much of the cell it crosses."""
    ink = np.zeros((60, 60), np.uint8)
    ink[59:60, 0:60] = 255  # the board's outer frame, clipped by the border crop
    assert _positional_marks(ink) == set()

    ink[42:58, 42:58] = 255  # a real mark alongside it still reads
    assert _positional_marks(ink) == {9}


def test_killer_reader_reads_the_apps_open_topped_four():
    """Regression: the app draws 4 with an open apex, which cross-correlates to a
    closed-apex Hershey 9 better than to its 4, so every large 4 read as a 9. A
    wrong value is worse than a wrong cage sum — it makes the engine deduce
    things that are simply false."""
    board, _ = _killer_fixture_read().board, None
    fours = [
        (r, c) for r in range(9) for c in range(9) if board.value(r, c) == 4
    ]
    assert fours == [(7, 4), (8, 0)], f"expected 4s at r8c5 and r9c1, got {fours}"
    assert board.value(7, 4) == 4
    assert board.value(8, 0) == 4
