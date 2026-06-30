"""Top-level board reader: image bytes -> :class:`~sudoku.model.Board`.

Ties together grid detection, per-cell parsing and the (seeded, self-calibrating)
template classifier. This is the single entry point the web layer calls.
"""

from __future__ import annotations

import numpy as np

from ..model import Board, Cell
from .calibrate import loaded_store
from .cell_parse import parse_cell
from .classify import TemplateStore
from .grid_detect import decode_image, detect_and_split


def read_board(img_bgr: np.ndarray, store: TemplateStore | None = None) -> Board:
    if store is None:
        store = loaded_store()
    cell_imgs = detect_and_split(img_bgr)
    cells = []
    for cimg in cell_imgs:
        read = parse_cell(cimg, store)
        cells.append(
            Cell(
                value=read.value,
                is_given=read.is_given,
                pencil_marks=set(read.pencil_marks),
                low_confidence=read.low_confidence,
            )
        )
    return Board(cells)


def read_board_from_bytes(raw: bytes, store: TemplateStore | None = None) -> Board:
    return read_board(decode_image(raw), store)
