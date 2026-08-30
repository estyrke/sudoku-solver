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
        return {
            "ok": False,
            "reason": "No solution exists for this board — check the cage sums.",
        }
    return {"ok": True, "board": solved.to_dict()}


@app.post("/killer/hint")
def killer_hint_endpoint(data: KillerBoardModel) -> dict:
    """Killer hints run the same escalating technique list as classic Sudoku.

    Cage no-repeat already constrains candidates (cage-mates are peers), so
    these hints are sound on a Killer board today; the cage-*sum* techniques
    land in issues #12 and #13 and slot into the same list.
    """
    board = _killer_board_from_model(data)
    if not board.is_valid():
        return {
            "ok": False,
            "reason": "The board is invalid — a digit repeats in a unit or a cage, "
            "or a cage can no longer reach its sum.",
        }
    if board.is_solved():
        return {"ok": False, "reason": "This board is already solved. 🎉"}
    hint = find_hint(board)
    if hint is None:
        return {
            "ok": False,
            "reason": "No technique in the current set applies. The board may need a "
            "more advanced strategy than is implemented yet.",
        }
    return {
        "ok": True,
        "nudge": _nudge(hint),
        "technique": hint.technique,
        "hint": hint.to_dict(),
    }
