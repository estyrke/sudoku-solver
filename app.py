"""FastAPI app: serves the board UI and the screenshot readers.

Run with::

    uvicorn app:app --reload

Every puzzle reasons entirely in the browser — board models, techniques, hints,
solving and the mistake audit live in ``web/sudoku/`` and ``web/queens/`` — so
nothing here answers for them. What is left is screenshot reading
(``/killer/parse``, ``/share/parse``, ``/confirm``).

``/parse`` is still served but no longer called: the Sudoku tab reads classic
screenshots in the page now (``web/reader/``). It stays until the Killer reader
and the share dispatcher follow it into the browser and this app is deleted
whole, rather than being removed a route at a time — and the reader behind it
is not dead either way, since ``/share/parse`` falls back to it.

The CV reader is imported lazily so the logic + UI work even before OpenCV (and the
reader module) are available.
"""

from __future__ import annotations

from pathlib import Path

import json

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from sudoku.model import Board

STATIC = Path(__file__).parent / "static"

app = FastAPI(title="Sudoku Helper")


class CellModel(BaseModel):
    value: int | None = None
    is_given: bool = False
    pencil_marks: list[int] = []
    low_confidence: bool = False


class BoardModel(BaseModel):
    cells: list[CellModel]


def _board_from_model(data: BoardModel) -> Board:
    if len(data.cells) != 81:
        raise HTTPException(400, "board must have 81 cells")
    return Board.from_dict({"cells": [c.model_dump() for c in data.cells]})


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


# The manifest and the service worker are served from the root rather than from
# /static, where the rest of the front end lives. A worker's scope defaults to
# the directory it is served from, so one at /static/sw.js could not intercept
# the share POST to /share. The explicit media types matter too: a manifest
# served as octet-stream is ignored, and with it the share target.
@app.get("/manifest.webmanifest")
def manifest() -> FileResponse:
    return FileResponse(STATIC / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker() -> FileResponse:
    return FileResponse(STATIC / "sw.js", media_type="text/javascript")


@app.get("/share")
def share_landing() -> FileResponse:
    """Where a share lands when the service worker did not intercept it.

    The worker owns POST /share; this GET exists so that a browser without one
    registered — or one whose worker was evicted — shows the app instead of a
    404. The screenshot is lost in that case, which is the honest outcome: it
    was never handed to the page.
    """
    return FileResponse(STATIC / "index.html")


@app.post("/parse")
async def parse_endpoint(image: UploadFile = File(...)) -> dict:
    """Read a board from an uploaded screenshot. Wired to the CV reader, imported
    lazily so the rest of the app runs without OpenCV installed.

    Nothing in the app calls this any more — see the module docstring."""
    try:
        from sudoku.reader.read_board import read_board_from_bytes
    except Exception as exc:  # pragma: no cover - depends on optional deps
        raise HTTPException(
            501,
            f"Image reading isn't available: {exc}. Install OpenCV (see requirements.txt).",
        )
    raw = await image.read()
    try:
        board = read_board_from_bytes(raw)
    except Exception as exc:
        raise HTTPException(422, f"Could not read a board from that image: {exc}")
    return {"ok": True, "board": board.to_dict()}


@app.post("/confirm")
async def confirm_endpoint(
    image: UploadFile = File(...), board: str = Form(...)
) -> dict:
    """Learn from a user-corrected reading: re-extract each confirmed glyph from the
    original screenshot and add it as a classifier exemplar (persisted to
    ``templates/``), so future reads of this app get more accurate."""
    try:
        from sudoku.reader.calibrate import learn_from_board
        from sudoku.reader.classify import TemplateStore
        from sudoku.reader.grid_detect import decode_image
    except Exception as exc:  # pragma: no cover - optional deps
        raise HTTPException(501, f"Image reading isn't available: {exc}.")
    try:
        confirmed = _board_from_model(BoardModel(**json.loads(board)))
    except Exception as exc:
        raise HTTPException(400, f"bad board payload: {exc}")
    img = decode_image(await image.read())
    store = TemplateStore().load()
    added = learn_from_board(store, img, confirmed)
    return {"ok": True, "learned": added}


# Static assets (css/js) served under /static.
app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _read_killer(raw: bytes) -> dict:
    """The /killer/parse payload for ``raw``.

    ``unsure`` lists the cells whose cage sum was read doubtfully (or dropped as
    illegal), so the UI can point the user at what to check before solving.
    """
    try:
        from sudoku.reader.killer import read_killer_board_from_bytes
    except Exception as exc:  # pragma: no cover - depends on optional deps
        raise HTTPException(
            501,
            f"Image reading isn't available: {exc}. Install OpenCV (see requirements.txt).",
        )
    try:
        read = read_killer_board_from_bytes(raw)
    except Exception as exc:
        raise HTTPException(422, f"Could not read a Killer board from that image: {exc}")
    return {
        "ok": True,
        "board": read.board.to_dict(),
        "unsure": [{"r": r, "c": c} for r, c in read.unsure],
        "fully_caged": read.board.is_fully_caged(),
        "sum_total": read.sum_total,
        "checksum_ok": read.checksum_ok,
        "needs_review": read.needs_review,
    }


@app.post("/killer/parse")
async def killer_parse_endpoint(image: UploadFile = File(...)) -> dict:
    """Read a Killer board from a Puzzle Page screenshot."""
    return _read_killer(await image.read())


# A board with no cage outlines still yields the odd stray cage from grid
# artefacts, but never a board's worth of them; a Killer board misread badly
# enough to lose half its cages still finds far more than this. The gap between
# the two is wide, so the threshold does not need to be finely judged — it only
# needs to sit inside it.
MIN_KILLER_CAGES = 5


@app.post("/share/parse")
async def share_parse_endpoint(image: UploadFile = File(...)) -> dict:
    """Read a shared screenshot, working out which puzzle it is on the way.

    The Android share sheet offers one target, but the app has two readers, so
    something has to choose. Cage outlines are the tell, and counting them is
    free: the Killer reader has to run first either way, and when the picture
    turns out to be a classic board its answer is simply discarded.
    """
    raw = await image.read()
    killer = _read_killer(raw)
    if len(killer["board"].get("cages", [])) >= MIN_KILLER_CAGES:
        return {"kind": "killer", **killer}

    from sudoku.reader.read_board import read_board_from_bytes

    try:
        board = read_board_from_bytes(raw)
    except Exception as exc:
        raise HTTPException(422, f"Could not read a board from that image: {exc}")
    return {"kind": "sudoku", "ok": True, "board": board.to_dict()}
