"""Digit classification by template matching.

A glyph crop (ink-on-black, uint8) is normalized to a fixed square and compared
against stored exemplars via normalized cross-correlation. There can be many
exemplars per digit; the best-matching one wins. Exemplars come from two sources:
a font-rendered *seed* set (so the first parse isn't blank) and the user's
*confirmed* corrections (see :mod:`sudoku.reader.calibrate`), which adapt the
classifier to their specific app over time.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import cv2
import numpy as np

NORM = 24  # normalized glyph side length
DEFAULT_DIR = Path(__file__).resolve().parents[2] / "templates"


def normalize_glyph(glyph: np.ndarray) -> Optional[np.ndarray]:
    """Crop to the ink bounding box and resize into a centered ``NORM x NORM`` float
    image in ``[0, 1]``. ``glyph`` is uint8 with ink ~255 on a ~0 background.
    Returns ``None`` if there's effectively no ink."""
    ys, xs = np.where(glyph > 60)
    if xs.size < 4:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop = glyph[y0:y1, x0:x1].astype(np.float32) / 255.0
    h, w = crop.shape
    scale = (NORM - 4) / max(h, w)
    nh, nw = max(1, int(round(h * scale))), max(1, int(round(w * scale)))
    resized = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((NORM, NORM), np.float32)
    oy, ox = (NORM - nh) // 2, (NORM - nw) // 2
    canvas[oy : oy + nh, ox : ox + nw] = resized
    return canvas


def _ncc(a: np.ndarray, b: np.ndarray) -> float:
    """Zero-mean normalized cross-correlation in [-1, 1]."""
    av = a.ravel() - a.mean()
    bv = b.ravel() - b.mean()
    denom = np.linalg.norm(av) * np.linalg.norm(bv)
    if denom == 0:
        return 0.0
    return float(np.dot(av, bv) / denom)


class TemplateStore:
    """In-memory exemplar bank, persisted as PNGs under ``templates/``.

    Layout on disk: ``templates/<digit>/<name>.png``, each a NORM x NORM image.
    """

    def __init__(self, directory: Path = DEFAULT_DIR):
        self.dir = Path(directory)
        self.exemplars: dict[int, list[np.ndarray]] = {d: [] for d in range(1, 10)}

    # ---- persistence --------------------------------------------------------

    def load(self) -> "TemplateStore":
        for d in range(1, 10):
            sub = self.dir / str(d)
            if not sub.is_dir():
                continue
            for png in sorted(sub.glob("*.png")):
                img = cv2.imread(str(png), cv2.IMREAD_GRAYSCALE)
                if img is None:
                    continue
                if img.shape != (NORM, NORM):
                    img = cv2.resize(img, (NORM, NORM))
                self.exemplars[d].append(img.astype(np.float32) / 255.0)
        return self

    def add(self, digit: int, norm_glyph: np.ndarray, persist: bool = True) -> None:
        self.exemplars[digit].append(norm_glyph)
        if persist:
            sub = self.dir / str(digit)
            sub.mkdir(parents=True, exist_ok=True)
            n = len(list(sub.glob("*.png")))
            cv2.imwrite(str(sub / f"{n:03d}.png"), (norm_glyph * 255).astype(np.uint8))

    @property
    def is_empty(self) -> bool:
        return all(not v for v in self.exemplars.values())

    # ---- classification -----------------------------------------------------

    def classify(self, glyph: np.ndarray) -> tuple[Optional[int], float]:
        """Return ``(digit, score)`` for a raw glyph crop, or ``(None, 0.0)`` if it's
        blank or there are no exemplars. ``score`` is the best NCC in [-1, 1]."""
        norm = normalize_glyph(glyph)
        if norm is None:
            return None, 0.0
        best_d, best_s = None, -1.0
        for d, exes in self.exemplars.items():
            for ex in exes:
                s = _ncc(norm, ex)
                if s > best_s:
                    best_d, best_s = d, s
        return best_d, best_s
