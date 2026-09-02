"""Turn one cell image into (value, given?, pencil marks, confidence).

A cell holds at most one large central glyph (a "pen" value or a given) OR several
small pencil-mark digits. We binarize, drop the grid border, then decide by the size
of the largest component: tall = value, everything small = candidates.

Pencil-mark reading uses **positional detection**: the inner cell area is divided
into a 3×3 sub-grid and we simply check which positions contain enough ink. Position
(sub_r, sub_c) maps to digit ``sub_r * 3 + sub_c + 1``, i.e. top-left = 1, top-
center = 2, … bottom-right = 9. This is far more robust than shape-classifying tiny
glyphs and handles the layout used by most digital Sudoku apps (and confirmed by the
screenshot the user provided).

Given-vs-entered is guessed from colour saturation (givens are usually black;
entered digits are often tinted blue).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from .classify import TemplateStore

# size thresholds as a fraction of cell height
VALUE_MIN_H = 0.42   # a component this tall (or taller) is the cell's value
MARK_MIN_H = 0.10    # smaller than this is noise
MARK_MAX_H = 0.40    # candidates sit below the value threshold
NOISE_MIN_AREA = 8
VALUE_CONF = 0.45    # NCC below this flags the value as low-confidence
SAT_GIVEN_MAX = 55   # mean saturation above this -> treat as an entered (tinted) digit


@dataclass
class CellRead:
    value: Optional[int] = None
    is_given: bool = False
    pencil_marks: set[int] = None
    low_confidence: bool = False

    def __post_init__(self):
        if self.pencil_marks is None:
            self.pencil_marks = set()


def cell_ink(cell_bgr: np.ndarray) -> np.ndarray:
    """Binary ink mask (ink=255) with the grid border cropped away."""
    h, w = cell_bgr.shape[:2]
    m = int(round(0.12 * h))  # margin to discard border lines
    inner = cell_bgr[m : h - m, m : w - m]
    gray = cv2.cvtColor(inner, cv2.COLOR_BGR2GRAY)
    # Otsu, inverted so darker ink becomes white foreground.
    _, ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    # If Otsu picked the background as foreground (mostly white), flip it back.
    if ink.mean() > 127:
        ink = 255 - ink
    return ink


def _components(ink: np.ndarray):
    """Yield ``(crop, x, y, h, area)`` for each non-noise connected component."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    out = []
    for lab in range(1, n):
        x, y, cw, ch, area = stats[lab]
        if area < NOISE_MIN_AREA:
            continue
        mask = (labels[y : y + ch, x : x + cw] == lab).astype(np.uint8) * 255
        out.append((mask, x, y, ch, area))
    return out


def largest_component(ink: np.ndarray) -> Optional[np.ndarray]:
    comps = _components(ink)
    if not comps:
        return None
    comps.sort(key=lambda t: t[4], reverse=True)
    return comps[0][0]


def _is_given(cell_bgr: np.ndarray, ink: np.ndarray) -> bool:
    """Heuristic: black glyph -> given; tinted glyph -> entered by the player."""
    h, w = cell_bgr.shape[:2]
    m = int(round(0.12 * h))
    inner = cell_bgr[m : h - m, m : w - m]
    hsv = cv2.cvtColor(inner, cv2.COLOR_BGR2HSV)
    mask = ink > 0
    if mask.sum() < 5:
        return True
    mean_sat = float(hsv[..., 1][mask].mean())
    return mean_sat <= SAT_GIVEN_MAX


def parse_cell(
    cell_bgr: np.ndarray,
    store: TemplateStore,
    mark_band: tuple[float, float] = (0.0, 1.0),
) -> CellRead:
    ink = cell_ink(cell_bgr)
    comps = _components(ink)
    if not comps:
        return CellRead()
    cell_h = ink.shape[0]

    value_comp = max(
        (c for c in comps if c[3] >= VALUE_MIN_H * cell_h),
        key=lambda t: t[4],
        default=None,
    )
    if value_comp is not None:
        digit, score = store.classify(value_comp[0])
        return CellRead(
            value=digit,
            is_given=_is_given(cell_bgr, ink),
            low_confidence=(digit is None or score < VALUE_CONF),
        )

    # No large glyph — read pencil marks positionally.
    marks = _positional_marks(ink, mark_band)
    return CellRead(pencil_marks=marks, low_confidence=False)


# Fraction of ink pixels in a sub-cell required to count as a mark.
_MARK_INK_THRESH = 0.04

# A grid or cage line that survives the border crop shows up as a hairline: one or
# two pixels thick and running most of the width of the cell. Spread across three
# sub-cells it clears the ink threshold on its own, which is how the bottom-right
# cell of a board — where the outer frame sits closest to the crop — picked up
# phantom 7 and 9 marks. Counting ink by the pixel cannot tell that apart, so
# hairlines are dropped before the count. The bound is a fraction of cell height so
# it holds at either reader's warp size; the thinnest real mark is several times it.
_MARK_MIN_THICK = 0.03


def _without_hairlines(ink: np.ndarray) -> np.ndarray:
    """``ink`` with every component too thin in either axis to be a digit removed."""
    floor = max(2, int(round(_MARK_MIN_THICK * ink.shape[0])))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    out = ink.copy()
    for lab in range(1, n):
        x, y, w, h, area = stats[lab]
        if min(w, h) < floor or area < NOISE_MIN_AREA:
            out[y : y + h, x : x + w][labels[y : y + h, x : x + w] == lab] = 0
    return out


def _positional_marks(
    ink: np.ndarray, band: tuple[float, float] = (0.0, 1.0)
) -> set[int]:
    """Detect candidates by position in a 3×3 sub-grid overlay.

    Digit d occupies sub-cell ((d-1)//3, (d-1)%3): top-left=1 … bottom-right=9.
    We count ink pixels in each sub-cell and threshold by fraction of its area.

    ``band`` is the vertical slice of ``ink`` the mark grid actually occupies, as
    (top, bottom) fractions. It defaults to the whole image, which is what apps
    that centre their marks in the cell need. Killer boards reserve a strip at the
    top of every cell for the cage sum and push the marks down below it, so the
    grid has to be mapped onto that strip alone — splitting the full height into
    thirds there would report every mark one row too low.
    """
    ink = _without_hairlines(ink)
    h, w = ink.shape
    top, bottom = band
    y_start, y_span = top * h, (bottom - top) * h
    marks: set[int] = set()
    sub_h, sub_w = y_span / 3, w / 3
    for sub_r in range(3):
        for sub_c in range(3):
            y0 = int(round(y_start + sub_r * sub_h))
            y1 = int(round(y_start + (sub_r + 1) * sub_h))
            x0 = int(round(sub_c * sub_w))
            x1 = int(round((sub_c + 1) * sub_w))
            patch = ink[y0:y1, x0:x1]
            area = patch.size
            if area == 0:
                continue
            ink_frac = float((patch > 0).sum()) / area
            if ink_frac >= _MARK_INK_THRESH:
                marks.add(sub_r * 3 + sub_c + 1)
    return marks
