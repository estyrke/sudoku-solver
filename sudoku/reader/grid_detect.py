"""Locate the 9x9 grid in an image and split it into 81 cell crops.

Two paths: if a strong 4-corner quad is found (a photo, or a screenshot with margins
around the board) we perspective-warp it to a square; otherwise we assume the image
is already the board and just resize it. Either way the output is a list of 81 BGR
cell images in row-major order.
"""

from __future__ import annotations

import cv2
import numpy as np

SIZE = 486  # warped board side (divisible by 9 -> 54px cells)
CELL = SIZE // 9


def decode_image(raw: bytes) -> np.ndarray:
    arr = np.frombuffer(raw, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("not a decodable image")
    return img


def _order_points(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).ravel()
    return np.array(
        [
            pts[np.argmin(s)],   # top-left  (smallest x+y)
            pts[np.argmin(diff)],  # top-right (smallest y-x)
            pts[np.argmax(s)],   # bottom-right
            pts[np.argmax(diff)],  # bottom-left
        ],
        dtype=np.float32,
    )


def find_grid_quad(gray: np.ndarray) -> np.ndarray | None:
    """Return the board's 4 corner points, or ``None`` if no convincing quad."""
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    thresh = cv2.adaptiveThreshold(
        blur, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 11, 2
    )
    thresh = cv2.dilate(thresh, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    img_area = gray.shape[0] * gray.shape[1]
    best, best_area = None, 0.0
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 0.20 * img_area:
            continue
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if len(approx) == 4 and area > best_area:
            best, best_area = approx.reshape(4, 2).astype(np.float32), area
    return best


def warp_board(img: np.ndarray, quad: np.ndarray) -> np.ndarray:
    dst = np.array(
        [[0, 0], [SIZE - 1, 0], [SIZE - 1, SIZE - 1], [0, SIZE - 1]], np.float32
    )
    M = cv2.getPerspectiveTransform(_order_points(quad), dst)
    return cv2.warpPerspective(img, M, (SIZE, SIZE))


def detect_and_split(img_bgr: np.ndarray) -> list[np.ndarray]:
    """Return 81 cell images (BGR), row-major."""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    quad = find_grid_quad(gray)
    if quad is not None:
        board = warp_board(img_bgr, quad)
    else:
        board = cv2.resize(img_bgr, (SIZE, SIZE))
    cells = []
    for r in range(9):
        for c in range(9):
            y, x = r * CELL, c * CELL
            cells.append(board[y : y + CELL, x : x + CELL].copy())
    return cells
