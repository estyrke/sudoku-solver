"""FastAPI app: serves the board UI and the hint/parse/confirm endpoints.

Run with::

    uvicorn app:app --reload

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
from sudoku.solver.audit import audit
from sudoku.solver.hint import find_hint, solve

from queens.model import Board as QueensBoard
from queens.solver.hint import find_hint as queens_find_hint
from queens.solver.hint import solve as queens_solve

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


class CoordModel(BaseModel):
    r: int
    c: int


class CageModel(BaseModel):
    cells: list[CoordModel]
    sum: int


class KillerBoardModel(BoardModel):
    """A Killer board is a classic board plus cages — same context, same model,
    per ``docs/adr/0002-killer-sudoku-extends-sudoku-context.md``."""

    cages: list[CageModel] = []


def _killer_board_from_model(data: KillerBoardModel) -> Board:
    if len(data.cells) != 81:
        raise HTTPException(400, "board must have 81 cells")
    try:
        return Board.from_dict(
            {
                "cells": [c.model_dump() for c in data.cells],
                "cages": [cage.model_dump() for cage in data.cages],
            }
        )
    except ValueError as exc:
        # Cage rules (contiguity, size, reachable sum, overlap) are enforced in
        # the model; surface the message rather than a 500.
        raise HTTPException(400, str(exc))


class QueensCellModel(BaseModel):
    state: str = "empty"
    region: int | None = None


class QueensBoardModel(BaseModel):
    n: int
    cells: list[QueensCellModel]


def _queens_board_from_model(data: QueensBoardModel) -> QueensBoard:
    if len(data.cells) != data.n * data.n:
        raise HTTPException(400, f"board of size {data.n} must have {data.n * data.n} cells")
    return QueensBoard.from_dict({"n": data.n, "cells": [c.model_dump() for c in data.cells]})


def _nudge(hint) -> str:
    """The gentlest hint: which region to look at, without saying what to do."""
    if hint.units:
        return f"Look at {hint.units[0]}."
    from sudoku.model import cell_name

    return f"Look at {cell_name(*hint.cells[0])}."


def _queens_nudge(hint) -> str:
    """The gentlest hint: which row/column/region to look at, without saying
    what to do. Kept separate from ``_nudge`` (rather than shared) so the
    queens and sudoku web-layer code stay independent, per
    ``docs/adr/0001-sudoku-and-queens-as-separate-contexts.md``."""
    if hint.units:
        return f"Look at {hint.units[0]}."
    from queens.model import cell_name

    return f"Look at {cell_name(*hint.cells[0])}."


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


@app.post("/hint")
def hint_endpoint(data: BoardModel) -> dict:
    board = _board_from_model(data)
    if not board.is_valid():
        return {"ok": False, "reason": "The board is invalid — a digit repeats in a unit."}
    if board.is_solved():
        return {"ok": False, "reason": "This board is already solved. 🎉"}
    hint = find_hint(board)
    if hint is None:
        return {
            "ok": False,
            "reason": "No technique in the current set applies. The board may need a "
            "more advanced strategy than is implemented yet.",
        }
    # Progressive reveal levels: nudge -> technique name -> full reasoning.
    return {
        "ok": True,
        "nudge": _nudge(hint),
        "technique": hint.technique,
        "hint": hint.to_dict(),
    }


@app.post("/solve")
def solve_endpoint(data: BoardModel) -> dict:
    board = _board_from_model(data)
    solved = solve(board)
    if solved is None:
        return {"ok": False, "reason": "No solution exists for this board."}
    return {"ok": True, "board": solved.to_dict()}


@app.post("/parse")
async def parse_endpoint(image: UploadFile = File(...)) -> dict:
    """Read a board from an uploaded screenshot. Wired to the CV reader, imported
    lazily so the rest of the app runs without OpenCV installed."""
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


@app.post("/queens/solve")
def queens_solve_endpoint(data: QueensBoardModel) -> dict:
    board = _queens_board_from_model(data)
    solved = queens_solve(board)
    if solved is None:
        return {"ok": False, "reason": "No solution exists for this board."}
    return {"ok": True, "board": solved.to_dict()}


@app.post("/queens/hint")
def queens_hint_endpoint(data: QueensBoardModel) -> dict:
    board = _queens_board_from_model(data)
    if not board.is_valid():
        return {
            "ok": False,
            "reason": "The board is invalid — two queens share a row, column, "
            "or region, or sit adjacent to each other.",
        }
    if board.is_solved():
        return {"ok": False, "reason": "This board is already solved. 🎉"}
    hint = queens_find_hint(board)
    if hint is None:
        return {
            "ok": False,
            "reason": "No technique in the current set applies. The board may need a "
            "more advanced strategy than is implemented yet.",
        }
    # Progressive reveal levels: nudge -> technique name -> full reasoning.
    return {
        "ok": True,
        "nudge": _queens_nudge(hint),
        "technique": hint.technique,
        "hint": hint.to_dict(),
    }


# Static assets (css/js) served under /static.
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.post("/killer/solve")
def killer_solve_endpoint(data: KillerBoardModel) -> dict:
    board = _killer_board_from_model(data)
    solved = solve(board)
    if solved is None:
        # "No solution exists — check the cage sums" was the old answer, and it
        # sent people to the cages when the culprit was usually a digit they'd
        # entered. The audit says which.
        report = audit(board)
        return {"ok": False, "reason": report.message, "audit": report.to_dict()}
    return {"ok": True, "board": solved.to_dict()}


@app.post("/killer/hint")
def killer_hint_endpoint(data: KillerBoardModel) -> dict:
    """Killer hints run the same escalating technique list as classic Sudoku,
    with the cage-sum and 45-rule techniques slotted into it.

    When nothing applies the board is audited rather than shrugged at: "no
    technique applies" is the right answer only when the board is actually clean.
    """
    board = _killer_board_from_model(data)
    if board.is_solved():
        return {"ok": False, "reason": "This board is already solved. 🎉"}

    # Audit before hinting, not after. A hint deduced from a wrong entry or in a
    # world where a needed pencil mark has been rubbed out is worse than no hint:
    # it looks authoritative and sends the player further off. "incomplete" is not
    # a mistake, just a board still being drawn, so it doesn't block anything.
    report = audit(board)
    if not report.clean and report.verdict != "incomplete":
        return {"ok": False, "reason": report.message, "audit": report.to_dict()}

    hint = find_hint(board)
    if hint is not None:
        return {
            "ok": True,
            "nudge": _nudge(hint),
            "technique": hint.technique,
            "hint": hint.to_dict(),
            "audit": report.to_dict(),
        }
    return {
        "ok": False,
        "reason": "No mistakes on the board — this one needs a technique that "
        "isn't implemented yet.",
        "audit": report.to_dict(),
    }


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
