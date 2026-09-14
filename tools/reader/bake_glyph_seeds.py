"""Write the baked digit exemplars out as an asset the browser reader can load.

The exemplars themselves are not produced here. They live in
``sudoku/reader/glyph_seeds.npz``, rendered once and committed precisely so that
a developer's machine and a CI box classify the same screenshot the same way —
``cv2.putText`` does not anti-alias identically across platforms. This script
only re-containers those bytes: every glyph is copied through unchanged, so
running it on any machine produces the same file.

    python tools/reader/bake_glyph_seeds.py

Output: ``static/reader/glyph-seeds.bin``. See ``web/reader/seeds.ts`` for the
reading half, and ``docs/reader-assets.md`` for the format.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "sudoku" / "reader" / "glyph_seeds.npz"
TARGET = ROOT / "static" / "reader" / "glyph-seeds.bin"

MAGIC = b"GLYPHS01"


def bake() -> bytes:
    with np.load(SOURCE) as data:
        groups = [(int(key), data[key]) for key in sorted(data.files, key=int)]

    sides = {glyphs.shape[1] for _, glyphs in groups} | {
        glyphs.shape[2] for _, glyphs in groups
    }
    if len(sides) != 1:
        raise ValueError(f"exemplars are not all square and the same size: {sides}")
    side = sides.pop()

    header = bytearray(MAGIC)
    header += struct.pack("<BB", side, len(groups))
    for digit, glyphs in groups:
        if glyphs.dtype != np.uint8:
            raise ValueError(f"digit {digit}: exemplars are {glyphs.dtype}, not uint8")
        header += struct.pack("<BH", digit, len(glyphs))

    body = b"".join(glyphs.tobytes() for _, glyphs in groups)
    return bytes(header) + body


if __name__ == "__main__":
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    blob = bake()
    TARGET.write_bytes(blob)
    print(f"wrote {TARGET} ({len(blob)} bytes)")
