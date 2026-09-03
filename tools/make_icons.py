"""Draw the app icons.

Committed alongside the PNGs it produces, the way ``sudoku/reader/calibrate.py``
is committed alongside its baked exemplars: the output is what ships, but a
checked-in generator means the icons can be re-cut at a new size or recoloured
without anyone having to find the original artwork.

    python -m tools.make_icons

The mark is a 9x9 grid with one cell picked out in amber — the app's whole
proposition is *which cell to look at next*, so that is what the icon says.

Two shapes are produced. ``any`` is the icon as drawn, rounded and inset, for
launchers that show it untouched. ``maskable`` bleeds the background to every
edge and keeps the grid inside the central 80%, because Android crops adaptive
icons to a circle, a squircle or a rounded square depending on the launcher and
anything outside that safe zone may be cut away.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

OUT = Path(__file__).resolve().parent.parent / "static" / "icons"

# --accent and a warm counterpoint to it; BGR, since that is OpenCV's order.
BLUE = (192, 101, 21)
WHITE = (255, 255, 255)
AMBER = (7, 193, 255)

SUPERSAMPLE = 4  # draw large, shrink down: cheaper than getting anti-aliasing right


def _rounded_mask(side: int, radius: int) -> np.ndarray:
    """An opaque rounded square on a transparent field."""
    mask = np.zeros((side, side), np.uint8)
    cv2.rectangle(mask, (radius, 0), (side - radius, side), 255, -1)
    cv2.rectangle(mask, (0, radius), (side, side - radius), 255, -1)
    for x in (radius, side - radius):
        for y in (radius, side - radius):
            cv2.circle(mask, (x, y), radius, 255, -1)
    return mask


def _draw(side: int, *, maskable: bool) -> np.ndarray:
    """The icon at ``side`` px, as BGRA."""
    big = side * SUPERSAMPLE
    img = np.zeros((big, big, 4), np.uint8)

    # Background: square to the edges when it will be masked, rounded otherwise.
    img[:, :, :3] = BLUE
    img[:, :, 3] = 255 if maskable else _rounded_mask(big, int(big * 0.22))

    # The grid sits well inside the safe zone on a maskable icon, and merely
    # inside the rounded corners otherwise.
    grid = int(big * (0.56 if maskable else 0.68))
    origin = (big - grid) // 2
    step = grid / 9

    # One cell filled, before the lines, so the lines read on top of it.
    fill_r, fill_c = 4, 4
    cv2.rectangle(
        img,
        (round(origin + fill_c * step), round(origin + fill_r * step)),
        (round(origin + (fill_c + 1) * step), round(origin + (fill_r + 1) * step)),
        (*AMBER, 255),
        -1,
        cv2.LINE_AA,
    )

    thin = max(1, round(grid * 0.009))
    thick = max(2, round(grid * 0.032))
    # Cell lines sit halfway to the background rather than at full white. At 512
    # the icon is legibly a 9x9 grid; by 192 the thin lines have receded far
    # enough that it reads as a clean 3x3, instead of the noise a uniformly
    # white 9x9 turns into once the lines are a pixel apart.
    faint = tuple(round(w * 0.45 + b * 0.55) for w, b in zip(WHITE, BLUE))
    for i in range(10):
        at = round(origin + i * step)
        # Every third line bounds a box, and the outer frame is a box edge too.
        boxed = i % 3 == 0
        colour = (*(WHITE if boxed else faint), 255)
        width = thick if boxed else thin
        cv2.line(img, (origin, at), (origin + grid, at), colour, width, cv2.LINE_AA)
        cv2.line(img, (at, origin), (at, origin + grid), colour, width, cv2.LINE_AA)

    return cv2.resize(img, (side, side), interpolation=cv2.INTER_AREA)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, side, maskable in [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
    ]:
        cv2.imwrite(str(OUT / name), _draw(side, maskable=maskable))
        print(f"wrote {OUT / name}")


if __name__ == "__main__":
    main()
