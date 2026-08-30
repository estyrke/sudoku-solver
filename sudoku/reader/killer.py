"""Read a Puzzle Page Killer Sudoku screenshot into a :class:`~sudoku.model.Board`
with cages.

Scoped to that one app's layout, the way the Queens reader is scoped to Meowdoku
(``queens/docs/adr/0002``). Three things differ from the classic reader:

*Cages come from coloured borders, not shading.* Puzzle Page tints alternate 3x3
**boxes** light blue — a checkerboard that has nothing to do with cages — so fill
colour says nothing about cage membership. Each cage is instead outlined with a
saturated blue (or green) line drawn a little way inside its perimeter. Two
neighbouring cells belong to the same cage exactly when neither shows that line on
the side they share.

*Border colour is state, not structure.* A cage whose digits are complete and
correct is drawn green instead of blue. Both are treated identically here.

*The mark grid is pushed down.* Every cell reserves a strip at the top for a cage
sum, so pencil marks occupy roughly the lower two-thirds. See ``MARK_BAND``.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from ..model import DIGITS, Board, Cage, Cell, sum_bounds
from .calibrate import loaded_store
from .cell_parse import parse_cell
from .classify import TemplateStore, normalize_glyph
from .grid_detect import _order_points, decode_image, find_grid_quad

# Cage sums render only ~16px tall in a typical screenshot, so the board is warped
# larger than the classic reader's 486 to keep them legible.
WARP = 972
CELL = WARP // 9

# Where the pencil-mark 3x3 grid sits, as a fraction of the *ink* crop that
# `cell_ink` returns (it has already trimmed a 12% border). Measured from the
# reference screenshot: the marks occupy ~0.31..0.95 of the full cell height.
MARK_BAND = (0.25, 1.0)

# The cage sum's box within a cell, as fractions of cell size. Kept clear of the
# cage outline on the top/left and of the large placed digit below and right.
SUM_TOP, SUM_BOTTOM = 0.10, 0.34
SUM_LEFT, SUM_RIGHT = 0.12, 0.44

# A cage outline sits a few percent inside the cell edge rather than on the grid
# line, so its presence is probed across a range of insets.
BORDER_INSET = (0.035, 0.10)
BORDER_SPAN = (0.22, 0.78)  # sample the middle of a side, clear of the corners
BORDER_COVERAGE = 0.5  # fraction of the side that must be coloured

SUM_CONF = 0.45  # NCC below this marks the sum as needing a look

UNIT_TOTAL = sum(DIGITS)  # 45; a full partition's cage sums total 9 x 45


def _warp_board(img_bgr: np.ndarray) -> np.ndarray:
    """Crop the board out of the app chrome and square it up."""
    quad = find_grid_quad(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY))
    if quad is None:
        return cv2.resize(img_bgr, (WARP, WARP))
    dst = np.array(
        [[0, 0], [WARP - 1, 0], [WARP - 1, WARP - 1], [0, WARP - 1]], np.float32
    )
    M = cv2.getPerspectiveTransform(_order_points(quad), dst)
    return cv2.warpPerspective(img_bgr, M, (WARP, WARP))


def _ink_colour(board: np.ndarray) -> np.ndarray:
    """Mask of saturated blue/green pixels — cage outlines, sums and placed digits.

    Deliberately catches both border colours: green means "this cage is already
    satisfied", which is a rendering state and must not change the structure read.
    """
    hsv = cv2.cvtColor(board, cv2.COLOR_BGR2HSV)
    return ((hsv[..., 1].astype(int) > 70) & (hsv[..., 2].astype(int) > 90)).astype(
        np.uint8
    )


def _has_outline(coloured: np.ndarray, r: int, c: int, side: str) -> bool:
    """Whether cell ``(r, c)`` is outlined on ``side`` ('t', 'b', 'l' or 'r')."""
    y0, x0 = r * CELL, c * CELL
    a, b = int(BORDER_SPAN[0] * CELL), int(BORDER_SPAN[1] * CELL)
    lo, hi = int(BORDER_INSET[0] * CELL), int(BORDER_INSET[1] * CELL)
    best = 0.0
    for d in range(lo, hi + 1):
        if side == "t":
            band, axis = coloured[y0 + d : y0 + d + 2, x0 + a : x0 + b], 0
        elif side == "b":
            band, axis = coloured[y0 + CELL - d - 2 : y0 + CELL - d, x0 + a : x0 + b], 0
        elif side == "l":
            band, axis = coloured[y0 + a : y0 + b, x0 + d : x0 + d + 2], 1
        else:
            band, axis = coloured[y0 + a : y0 + b, x0 + CELL - d - 2 : x0 + CELL - d], 1
        if band.size:
            best = max(best, float(band.any(axis=axis).mean()))
    return best > BORDER_COVERAGE


def _label_cages(coloured: np.ndarray) -> np.ndarray:
    """A 9x9 grid of cage ids, flood-filled across un-outlined edges."""
    split_right = [
        [
            _has_outline(coloured, r, c, "r") or _has_outline(coloured, r, c + 1, "l")
            for c in range(8)
        ]
        for r in range(9)
    ]
    split_down = [
        [
            _has_outline(coloured, r, c, "b") or _has_outline(coloured, r + 1, c, "t")
            for c in range(9)
        ]
        for r in range(8)
    ]

    labels = -np.ones((9, 9), int)
    nxt = 0
    for r in range(9):
        for c in range(9):
            if labels[r, c] >= 0:
                continue
            labels[r, c] = nxt
            stack = [(r, c)]
            while stack:
                a, b = stack.pop()
                nbrs = []
                if b < 8 and not split_right[a][b]:
                    nbrs.append((a, b + 1))
                if b > 0 and not split_right[a][b - 1]:
                    nbrs.append((a, b - 1))
                if a < 8 and not split_down[a][b]:
                    nbrs.append((a + 1, b))
                if a > 0 and not split_down[a - 1][b]:
                    nbrs.append((a - 1, b))
                for na, nb in nbrs:
                    if labels[na, nb] < 0:
                        labels[na, nb] = nxt
                        stack.append((na, nb))
            nxt += 1
    return labels


def sum_store() -> TemplateStore:
    """Font-rendered exemplars for 0-9.

    Separate from the Sudoku store, which holds 1-9 only — a cell never contains a
    zero, but a cage sum of 10, 20, 30 or 40 certainly does.
    """
    store = TemplateStore()
    store.exemplars = {d: [] for d in range(10)}
    fonts = (
        cv2.FONT_HERSHEY_SIMPLEX,
        cv2.FONT_HERSHEY_DUPLEX,
        cv2.FONT_HERSHEY_TRIPLEX,
        cv2.FONT_HERSHEY_PLAIN,
        cv2.FONT_HERSHEY_COMPLEX,
    )
    for d in range(10):
        for font in fonts:
            for scale, thickness in ((1.6, 2), (1.9, 3), (1.4, 3), (1.6, 4), (1.8, 5), (2.0, 6)):
                canvas = np.zeros((72, 72), np.uint8)
                (w, h), _ = cv2.getTextSize(str(d), font, scale, thickness)
                cv2.putText(
                    canvas, str(d), ((72 - w) // 2, (72 + h) // 2),
                    font, scale, 255, thickness, cv2.LINE_AA,
                )
                glyph = normalize_glyph(canvas)
                if glyph is not None:
                    store.exemplars[d].append(glyph)
    return store


def _read_sum(
    coloured: np.ndarray, r: int, c: int, store: TemplateStore
) -> tuple[int | None, float]:
    """The cage sum printed in cell ``(r, c)``, plus the weakest digit's NCC."""
    y0, x0 = r * CELL, c * CELL
    band = coloured[
        y0 + int(SUM_TOP * CELL) : y0 + int(SUM_BOTTOM * CELL),
        x0 + int(SUM_LEFT * CELL) : x0 + int(SUM_RIGHT * CELL),
    ]
    if not band.size:
        return None, 0.0
    n, labels, stats, _ = cv2.connectedComponentsWithStats(band, 8)
    glyphs = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        # The outline leaves long thin runs in this crop; digits are compact.
        if not (0.09 * CELL <= h <= 0.26 * CELL) or w > 0.20 * CELL or area < 20:
            continue
        glyphs.append((x, (labels[y : y + h, x : x + w] == i).astype(np.uint8) * 255))
    if not glyphs:
        return None, 0.0

    digits, worst = [], 1.0
    for _, glyph in sorted(glyphs, key=lambda t: t[0]):
        digit, score = store.classify(glyph)
        if digit is None:
            return None, 0.0
        digits.append(digit)
        worst = min(worst, score)
    return int("".join(str(d) for d in digits)), worst


@dataclass
class KillerRead:
    """What a screenshot yielded, plus what to be suspicious of.

    Cage *structure* comes from the outlines and is reliable; the *sums* are OCR
    from ~16px glyphs and are not. So the read reports where to look rather than
    pretending to certainty.
    """

    board: Board
    unsure: list[tuple[int, int]]  # anchors whose sum needs a human glance
    sum_total: int

    @property
    def checksum_ok(self) -> bool:
        """Whether the cage sums total 45 per unit, as a full partition must.

        Only meaningful on a fully-caged board. This detects a misread; it
        deliberately doesn't try to *fix* one — many combinations reach 405, and
        picking the cheapest rewrites sums that were already right.
        """
        return self.sum_total == UNIT_TOTAL * 9

    @property
    def needs_review(self) -> bool:
        return bool(self.unsure) or (
            self.board.is_fully_caged() and not self.checksum_ok
        )


def read_killer_board(img_bgr: np.ndarray) -> KillerRead:
    """Read a screenshot into a caged board."""
    board_img = _warp_board(img_bgr)
    coloured = _ink_colour(board_img)
    labels = _label_cages(coloured)
    digit_store = loaded_store()
    sums = sum_store()

    cells: list[Cell] = []
    for r in range(9):
        for c in range(9):
            crop = board_img[r * CELL : (r + 1) * CELL, c * CELL : (c + 1) * CELL]
            read = parse_cell(crop, digit_store, mark_band=MARK_BAND)
            cells.append(
                Cell(
                    value=read.value,
                    is_given=False,  # Killer boards start empty; every digit is the player's
                    pencil_marks=set(read.pencil_marks),
                    low_confidence=read.low_confidence,
                )
            )

    cages: list[Cage] = []
    unsure: list[tuple[int, int]] = []
    for cage_id in range(labels.max() + 1):
        coords = [(r, c) for r in range(9) for c in range(9) if labels[r, c] == cage_id]
        if len(coords) < 2:
            continue  # a lone cell means the outline was misread; drop it rather than guess
        anchor = min(coords)
        total, score = _read_sum(coloured, *anchor, sums)
        low, high = sum_bounds(len(coords))
        if total is None or not low <= total <= high:
            # The outline is trustworthy even when the sum isn't, so keep the cage
            # and clamp to something legal rather than discarding real structure.
            # It's flagged either way, and the user retypes the number.
            total = min(high, max(low, total or low))
            unsure.append(anchor)
        elif score < SUM_CONF:
            unsure.append(anchor)
        cages.append(Cage.of(coords, total))

    return KillerRead(Board(cells, cages), unsure, sum(c.sum for c in cages))


def read_killer_board_from_bytes(raw: bytes) -> KillerRead:
    return read_killer_board(decode_image(raw))
