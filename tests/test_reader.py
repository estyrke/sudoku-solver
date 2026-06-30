"""End-to-end CV test against a synthetically rendered board.

We don't have the user's app screenshots yet, so we render a clean printed board
(grid + digits) and assert the reader recovers it. This validates the pipeline
mechanics — grid splitting, value/candidate separation, classification — using the
same seeded font templates the reader ships with.
"""

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
