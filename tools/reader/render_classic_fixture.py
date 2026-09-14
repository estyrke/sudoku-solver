"""Render the synthetic classic Sudoku board the reader tests read.

We have no screenshot of a real classic app, so the classic corpus is one
rendered board: a printed grid with ten Givens and one cell of Pencil marks.

It is rendered once and committed rather than rendered by the test, for the
same reason the digit exemplars are baked (see tools/reader/bake_glyph_seeds.py
and sudoku/reader/calibrate.py): ``cv2.putText`` does not anti-alias identically
across platforms, so a test that renders its own input is comparing two
different images on macOS and on Linux. Committing the pixels also lets the
browser reader — which cannot call ``cv2.putText`` at all — be held to the same
board as the Python one.

    python tools/reader/render_classic_fixture.py

Writes tests/fixtures/synthetic_classic_board.png, and beside it the board the
Python reader makes of it: tests/fixtures/classic_boards/*.json, which is what
both readers are pinned to.
"""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "synthetic_classic_board.png"
PINNED = ROOT / "tests" / "fixtures" / "classic_boards" / "synthetic_classic_board.json"

CELL = 60
SIZE = CELL * 9

GIVENS = {
    (0, 0): 1, (0, 4): 2, (1, 2): 3, (2, 7): 4, (3, 3): 5,
    (4, 1): 6, (5, 8): 7, (6, 5): 8, (8, 0): 9, (7, 7): 2,
}
PENCIL_CELL = (4, 4)
PENCIL_MARKS = {1, 5, 9}


def _put(img, text, c, r, scale, thick, color):
    font = cv2.FONT_HERSHEY_SIMPLEX
    (w, h), _ = cv2.getTextSize(text, font, scale, thick)
    x = c * CELL + (CELL - w) // 2
    y = r * CELL + (CELL + h) // 2
    cv2.putText(img, text, (x, y), font, scale, color, thick, cv2.LINE_AA)


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


if __name__ == "__main__":  # pragma: no cover - regeneration helper
    import sys

    sys.path.insert(0, str(ROOT))
    from sudoku.reader.read_board import read_board

    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    PINNED.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(FIXTURE), render_board())
    board = read_board(cv2.imread(str(FIXTURE)))
    PINNED.write_text(json.dumps(board.to_dict(), indent=2) + "\n")
    print(f"wrote {FIXTURE} and {PINNED}")
