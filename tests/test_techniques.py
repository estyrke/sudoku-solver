from sudoku.model import COORDS, Board, Cage
from sudoku.solver import techniques as T
from sudoku.solver.hint import (
    apply_to_candidates,
    find_hint,
    solve,
    solve_with_techniques,
    working_candidates,
)


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


# ---------------------------------------------------------------------------
# Killer Sudoku: cage-aware solving
# ---------------------------------------------------------------------------

_SPANS = [(0, 2), (2, 4), (4, 6), (6, 9)]


def _cages_from_solution():
    """Tile each row of SOLUTION with contiguous runs of 2,2,2,3 cells — a full
    81-cell partition whose cages are legal by construction (same-row digits
    differ) and consistent with EASY's unique solution."""
    solved = Board.from_string(SOLUTION)
    return [
        Cage.of(
            [(r, c) for c in range(a, b)],
            sum(solved.value(r, c) for c in range(a, b)),
        )
        for r in range(9)
        for a, b in _SPANS
    ]


def test_solve_satisfies_every_cage_sum():
    board = Board(cages=_cages_from_solution())
    solved = solve(board)
    assert solved is not None
    assert solved.is_solved()
    for cage in solved.cages:
        assert sum(solved.value(r, c) for r, c in cage.cells) == cage.sum


def test_solve_rejects_a_classic_valid_but_sum_invalid_board():
    """EASY has a unique classic solution in which r1c1+r1c2 = 5+3 = 8.

    Pinning that pair to any other total leaves the board classically solvable
    but with no cage-satisfying solution, so solve() must return None. Without
    cage-sum pruning in the backtracker it would return the classic solution.
    """
    classic = solve(Board.from_string(EASY))
    assert classic.value(0, 0) + classic.value(0, 1) == 8

    contradictory = Board(Board.from_string(EASY).cells, [Cage.of([(0, 0), (0, 1)], 9)])
    assert solve(contradictory) is None


def test_cage_consistent_sum_still_solves():
    board = Board.from_string(EASY)
    board = Board(board.cells, [Cage.of([(0, 0), (0, 1)], 8)])
    solved = solve(board)
    assert solved is not None and solved.is_solved()
    assert solved.value(0, 0) + solved.value(0, 1) == 8


# ---------------------------------------------------------------------------
# Killer Sudoku: cage-sum candidate restriction
# ---------------------------------------------------------------------------


def _cg(board):
    return working_candidates(board)


def test_cage_sum_two_cell_cage_of_four():
    """The canonical case: two cells totalling 4 can only be {1,3}."""
    board = Board(cages=[Cage.of([(0, 0), (0, 1)], 4)])
    hint = T.cage_sum(board, _cg(board))
    assert hint.action == "eliminate"
    assert hint.cells == [(0, 0)]
    assert hint.digits == [2, 4, 5, 6, 7, 8, 9]


def test_cage_sum_handles_a_partially_filled_cage():
    """A 15-cage with a 9 already placed needs 6 from two cells: {1,5} or {2,4}."""
    board = Board(cages=[Cage.of([(0, 0), (0, 1), (0, 2)], 15)])
    board.set_value(0, 0, 9)
    hint = T.cage_sum(board, _cg(board))
    assert hint.action == "eliminate"
    assert hint.cells == [(0, 1)]
    assert hint.digits == [3, 6, 7, 8]


def test_cage_sum_places_a_forced_digit():
    """A 17-cage must be {8,9}; if one cell can't be 9, it has to be the 8."""
    board = Board(cages=[Cage.of([(0, 0), (0, 1)], 17)])
    board.set_value(3, 0, 9)  # column peer removes 9 from r1c1
    hint = T.cage_sum(board, _cg(board))
    assert hint.action == "place"
    assert hint.cells == [(0, 0)]
    assert hint.digits == [8]
    assert "the 17-cage at r1c1" in hint.units


def test_cage_sum_explanation_names_cage_and_combinations():
    board = Board(cages=[Cage.of([(0, 0), (0, 1)], 4)])
    hint = T.cage_sum(board, _cg(board))
    assert "the 4-cage at r1c1" in hint.explanation
    assert "{13}" in hint.explanation
    assert hint.units == ["the 4-cage at r1c1"]


def test_cage_sum_is_silent_on_a_classic_board():
    board = Board.from_string(EASY)
    assert T.cage_sum(board, _cg(board)) is None


def test_cage_sum_ignores_combinations_its_cells_cannot_take():
    """{1,3} totals 4, but if neither cell can hold a 3 the cage is unsatisfiable
    and the technique stays quiet rather than eliminating everything."""
    board = Board(cages=[Cage.of([(0, 0), (0, 1)], 4)])
    cg = _cg(board)
    cg[(0, 0)].discard(3)
    cg[(0, 1)].discard(3)
    assert T.cage_sum(board, cg) is None


def test_a_classic_single_beats_a_cage_sum_deduction():
    """Both deductions are available; find_hint must offer the simpler one."""
    board = Board.from_string(EASY)
    board = Board(board.cells, [Cage.of([(0, 1), (0, 2)], 4)])
    hint = find_hint(board)
    assert hint.technique in ("Naked single", "Hidden single")


def test_cage_sum_sits_between_singles_and_subsets():
    names = [fn.__name__ for fn in T.TECHNIQUES]
    assert names.index("hidden_single") < names.index("cage_sum")
    assert names.index("cage_sum") < names.index("naked_pair")


def test_cage_sum_never_contradicts_a_known_solution():
    """Soundness: SOLUTION satisfies every cage, so it is a live witness that
    each of its digits is possible. cage_sum must therefore never eliminate one,
    nor place anything that disagrees with it."""
    solution = Board.from_string(SOLUTION)
    board = Board(Board.from_string(EASY).cells, _cages_from_solution())
    cg = working_candidates(board)

    fired = 0
    while (hint := T.cage_sum(board, cg)) is not None and fired < 300:
        fired += 1
        if hint.action == "place":
            r, c = hint.cells[0]
            assert hint.digits[0] == solution.value(r, c), (
                f"placed {hint.digits[0]} at {(r, c)}, solution has "
                f"{solution.value(r, c)}"
            )
            board.set_value(r, c, hint.digits[0])
        else:
            for r, c in hint.cells:
                assert solution.value(r, c) not in hint.digits, (
                    f"eliminated {solution.value(r, c)} at {(r, c)}, which the "
                    f"solution needs"
                )
        apply_to_candidates(board, cg, hint)

    assert fired, "expected cage_sum to find at least one deduction"
