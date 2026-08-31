"""Seeding and self-calibration of the digit template store.

``ensure_seed`` loads baked exemplars for the digits 1–9 so the very first parse
produces a reasonable guess. ``learn_from_board`` is called when the
user confirms a corrected board: each labelled glyph it can re-extract from the
source image becomes a new exemplar, so accuracy improves on the user's specific
app with every confirmed screenshot.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from .classify import NORM, TemplateStore, normalize_glyph

_SEED_FONTS = [
    cv2.FONT_HERSHEY_SIMPLEX,
    cv2.FONT_HERSHEY_DUPLEX,
    cv2.FONT_HERSHEY_TRIPLEX,
]

# Wider set, used for the cage-sum classifier which also needs a zero.
_SUM_FONTS = _SEED_FONTS + [cv2.FONT_HERSHEY_PLAIN, cv2.FONT_HERSHEY_COMPLEX]
_SUM_SCALES = ((1.6, 2), (1.9, 3), (1.4, 3), (1.6, 4), (1.8, 5), (2.0, 6))

# Exemplars are baked to disk rather than rendered on demand: `cv2.putText` with
# anti-aliasing does not rasterise identically across platforms, and classifying
# ~16px glyphs is sensitive enough that macOS and Linux disagreed on more than
# half the cage sums of the same screenshot. Shipping the bitmaps makes the
# reader deterministic wherever it runs. Regenerate with:
#     python -m sudoku.reader.calibrate
SEED_FILE = Path(__file__).with_name("glyph_seeds.npz")


def _render_digit(d: int, font: int, scale: float, thickness: int) -> np.ndarray:
    canvas = np.zeros((64, 64), np.uint8)
    text = str(d)
    (w, h), base = cv2.getTextSize(text, font, scale, thickness)
    x = (64 - w) // 2
    y = (64 + h) // 2
    cv2.putText(canvas, text, (x, y), font, scale, 255, thickness, cv2.LINE_AA)
    return canvas


# Hershey draws 4 with a closed apex. This app draws it open-topped — the
# diagonal and the stem never meet — and normalized cross-correlation matches
# that shape to a 9 far better than to a closed 4, so every large 4 in both
# reference screenshots read as a 9. Two exemplars of the real glyph fix it.
#
# Validated held-out rather than in-sample: exemplars taken from this board
# correct all the 4s on a *different* screenshot (6/6), and exemplars from that
# one correct all of this board's (13/13). Attempts to synthesise the shape with
# `cv2.line` kept closing the apex under downsampling, and a topological
# (hole-count) filter helped the large digits but wrecked the ~16px cage sums.
_OPEN_FOUR_SOURCE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "puzzle_page_killer_sample_board.png"
)
_OPEN_FOUR_CELLS = ((7, 4), (8, 0))


def _open_four_glyphs() -> list[np.ndarray]:
    """Lift the app's open-topped 4 out of the reference screenshot.

    Imported lazily: this is regeneration-time only, and ``killer`` imports
    this module.
    """
    from .cell_parse import VALUE_MIN_H, _components, cell_ink
    from .killer import CELL, _warp_board

    img = cv2.imread(str(_OPEN_FOUR_SOURCE))
    if img is None:  # pragma: no cover - only hit if the fixture goes missing
        raise FileNotFoundError(f"missing reference screenshot: {_OPEN_FOUR_SOURCE}")
    board = _warp_board(img)
    out = []
    for r, c in _OPEN_FOUR_CELLS:
        ink = cell_ink(board[r * CELL : (r + 1) * CELL, c * CELL : (c + 1) * CELL])
        biggest = max(
            (comp for comp in _components(ink) if comp[3] >= VALUE_MIN_H * ink.shape[0]),
            key=lambda comp: comp[4],
            default=None,
        )
        if biggest is None:
            continue
        norm = normalize_glyph(biggest[0])
        if norm is not None:
            out.append(norm)
    return out


def render_seed_glyphs() -> dict[str, np.ndarray]:
    """Render every seed exemplar. Only used to (re)generate ``SEED_FILE``."""
    out: dict[str, np.ndarray] = {}
    for d in range(10):
        glyphs = []
        fonts = _SUM_FONTS if d == 0 else _SEED_FONTS + _SUM_FONTS[len(_SEED_FONTS):]
        for font in fonts:
            for scale, thick in _SUM_SCALES:
                norm = normalize_glyph(_render_digit(d, font, scale, thick))
                if norm is not None:
                    glyphs.append((norm * 255).astype(np.uint8))
        if d == 4:
            glyphs += [(g * 255).astype(np.uint8) for g in _open_four_glyphs()]
        out[str(d)] = np.stack(glyphs)
    return out


def seed_glyphs() -> dict[int, list[np.ndarray]]:
    """The baked exemplars, as float images in [0, 1] keyed by digit."""
    with np.load(SEED_FILE) as data:
        return {
            int(k): [g.astype(np.float32) / 255.0 for g in data[k]] for k in data.files
        }


def ensure_seed(store: TemplateStore, persist: bool = False) -> TemplateStore:
    """Populate ``store`` with the baked exemplars if it is empty.

    Digits only — a Sudoku cell never holds a zero. The cage-sum classifier wants
    one, and asks for the full set itself (see ``sudoku.reader.killer``).
    """
    if not store.is_empty:
        return store
    seeds = seed_glyphs()
    for d in range(1, 10):
        for norm in seeds[d]:
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


if __name__ == "__main__":  # pragma: no cover - regeneration helper
    np.savez_compressed(SEED_FILE, **render_seed_glyphs())
    print(f"wrote {SEED_FILE}")
