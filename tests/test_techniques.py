from sudoku.model import COORDS, Board
from sudoku.solver import techniques as T
from sudoku.solver.hint import find_hint, solve, solve_with_techniques


# A board with no values; techniques are driven purely by the synthetic cg we pass.
EMPTY = Board()


def test_naked_single():
    cg = {(0, 0): {5}, (0, 1): {3, 7}}
    hint = T.naked_single(EMPTY, cg)
    assert hint is not None
    assert hint.action == "place"
    assert hint.cells == [(0, 0)]
    assert hint.digits == [5]


def test_hidden_single_in_row():
    # In row 0, digit 7 is a candidate only in r1c4, which also holds 1,2.
    cg = {(0, c): {1, 2} for c in range(9)}
    cg[(0, 3)] = {1, 2, 7}
    hint = T.hidden_single(EMPTY, cg)
    assert hint is not None
    assert hint.action == "place"
    assert hint.cells == [(0, 3)]
    assert hint.digits == [7]


def test_naked_pair_eliminates():
    cg = {(0, 0): {1, 2}, (0, 1): {1, 2}, (0, 2): {1, 2, 3}, (0, 3): {3, 4}}
    hint = T.naked_pair(EMPTY, cg)
    assert hint is not None
    assert hint.action == "eliminate"
    assert (0, 2) in hint.cells
    assert set(hint.digits) >= {1, 2}


def test_hidden_pair_eliminates():
    # In row 0, digits 8 and 9 appear only in r1c1 and r1c2 (each cluttered with extras).
    cg = {(0, c): {1, 2, 3} for c in range(9)}
    cg[(0, 0)] = {1, 8, 9}
    cg[(0, 1)] = {2, 8, 9}
    hint = T.hidden_pair(EMPTY, cg)
    assert hint is not None
    assert hint.action == "eliminate"
    assert set(hint.cells) == {(0, 0), (0, 1)}
    # the extras (1 and 2) get removed, leaving the hidden pair
    assert set(hint.digits) == {1, 2}


def test_pointing_box_to_line():
    # In box 0, digit 4 is a candidate only in row 0 (r1c1, r1c2). r1c6 holds 4 too.
    cg = {}
    cg[(0, 0)] = {4, 5}
    cg[(0, 1)] = {4, 6}
    cg[(2, 2)] = {7}  # box 0, no 4 -> doesn't break the row-confinement
    cg[(0, 5)] = {4, 1}  # same row, outside box -> elimination target
    hint = T.pointing(EMPTY, cg)
    assert hint is not None
    assert hint.action == "eliminate"
    assert hint.digits == [4]
    assert (0, 5) in hint.cells


def test_claiming_line_to_box():
    # In row 0, digit 3 only appears inside box 0 (cols 0,1). r3c1 (box 0) also has 3.
    cg = {}
    cg[(0, 0)] = {3, 5}
    cg[(0, 1)] = {3, 6}
    cg[(2, 0)] = {3, 9}  # box 0, different row -> elimination target
    hint = T.claiming(EMPTY, cg)
    assert hint is not None
    assert hint.action == "eliminate"
    assert hint.digits == [3]
    assert (2, 0) in hint.cells


def test_x_wing_rows():
    # Digit 4 in rows 0 and 4 appears in exactly columns 2 and 6 -> eliminate 4 from
    # those columns elsewhere (r9c3).
    cg = {}
    cg[(0, 2)] = {4, 1}
    cg[(0, 6)] = {4, 1}
    cg[(4, 2)] = {4, 5}
    cg[(4, 6)] = {4, 5}
    cg[(8, 2)] = {4, 9}  # col 2, other row -> elimination target
    hint = T.x_wing(EMPTY, cg)
    assert hint is not None
    assert hint.action == "eliminate"
    assert hint.digits == [4]
    assert (8, 2) in hint.cells


# ---------------------------------------------------------------------------
# End-to-end
# ---------------------------------------------------------------------------

EASY = "530070000600195000098000060800060003400803001700020006060000280000419005000080079"
SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179"


def test_backtracking_solver():
    board = Board.from_string(EASY)
    solved = solve(board)
    assert solved is not None
    assert solved.is_solved()
    flat = "".join(str(solved.value(r, c)) for r, c in COORDS)
    assert flat == SOLUTION


def test_hint_pipeline_is_consistent_with_solution():
    board = Board.from_string(EASY)
    solution = Board.from_string(SOLUTION)
    final, steps, solved = solve_with_techniques(board)
    assert steps, "expected at least one hint"
    # every placement the engine made must match the true solution
    for r, c in COORDS:
        v = final.value(r, c)
        if v is not None:
            assert v == solution.value(r, c), f"wrong placement at {(r, c)}"
    assert final.is_valid()


def test_find_hint_on_solved_board_is_none():
    board = Board.from_string(SOLUTION)
    assert find_hint(board) is None
