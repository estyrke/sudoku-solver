"""Seeding and self-calibration of the digit template store.

``ensure_seed`` renders the digits 1–9 in a few built-in fonts/scales so the very
first parse produces a reasonable guess. ``learn_from_board`` is called when the
user confirms a corrected board: each labelled glyph it can re-extract from the
source image becomes a new exemplar, so accuracy improves on the user's specific
app with every confirmed screenshot.
"""

from __future__ import annotations

import cv2
import numpy as np

from .classify import NORM, TemplateStore, normalize_glyph

_SEED_FONTS = [
    cv2.FONT_HERSHEY_SIMPLEX,
    cv2.FONT_HERSHEY_DUPLEX,
    cv2.FONT_HERSHEY_TRIPLEX,
]


def _render_digit(d: int, font: int, scale: float, thickness: int) -> np.ndarray:
    canvas = np.zeros((64, 64), np.uint8)
    text = str(d)
    (w, h), base = cv2.getTextSize(text, font, scale, thickness)
    x = (64 - w) // 2
    y = (64 + h) // 2
    cv2.putText(canvas, text, (x, y), font, scale, 255, thickness, cv2.LINE_AA)
    return canvas


def ensure_seed(store: TemplateStore, persist: bool = False) -> TemplateStore:
    """Populate ``store`` with font-rendered exemplars if it is empty."""
    if not store.is_empty:
        return store
    for d in range(1, 10):
        for font in _SEED_FONTS:
            for scale, thick in ((1.6, 2), (1.9, 3)):
                glyph = _render_digit(d, font, scale, thick)
                norm = normalize_glyph(glyph)
                if norm is not None:
                    store.add(d, norm, persist=persist)
    return store


def learn_from_board(store: TemplateStore, image_bgr, confirmed) -> int:
    """Extract glyphs for every confirmed value/pencil mark and add them as
    exemplars. Returns the number of exemplars added.

    ``image_bgr`` is the original screenshot; ``confirmed`` is the user-corrected
    :class:`~sudoku.model.Board`. Re-runs grid detection so glyph crops line up with
    the labels the user just verified.
    """
    from .grid_detect import detect_and_split
    from .cell_parse import cell_ink, largest_component

    cells = detect_and_split(image_bgr)
    added = 0
    for i, cell_img in enumerate(cells):
        truth = confirmed.cells[i]
        if truth.value is None:
            continue  # only learn confident, single large glyphs for now
        ink = cell_ink(cell_img)
        comp = largest_component(ink)
        if comp is None:
            continue
        norm = normalize_glyph(comp)
        if norm is not None:
            store.add(truth.value, norm, persist=True)
            added += 1
    return added


def loaded_store(directory=None) -> TemplateStore:
    """Convenience: load persisted templates, falling back to in-memory seeds."""
    store = TemplateStore(directory) if directory else TemplateStore()
    store.load()
    if store.is_empty:
        ensure_seed(store, persist=False)
    return store
