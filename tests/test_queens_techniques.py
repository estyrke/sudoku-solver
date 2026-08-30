from queens.model import EMPTY, MARKED, QUEEN, Board
from queens.solver import techniques as T
from queens.solver.hint import (
    apply_hint,
    find_hint,
    solve,
    solve_with_techniques,
    working_candidates,
)

# A 4x4 board split into four 2x2 quadrant regions; see test_queens_model.py for
# the same layout and its one non-attacking placement (SOLUTION).
QUADRANTS = [
    [0, 0, 1, 1],
    [0, 0, 1, 1],
    [2, 2, 3, 3],
    [2, 2, 3, 3],
]
SOLUTION = [(0, 1), (1, 3), (2, 0), (3, 2)]


def quadrant_board() -> Board:
    return Board.from_grid(QUADRANTS)


def test_backtracking_solver():
    board = quadrant_board()
    solved = solve(board)
    assert solved is not None
    assert solved.is_solved()
    assert sorted(solved.queen_cells()) == sorted(SOLUTION)


def test_backtracking_solver_respects_existing_queens_and_marks():
    board = quadrant_board()
    # Pin the known solution's row-2 queen up front...
    board.set_state(2, 0, QUEEN)
    # ...and mark out a cell that isn't part of any completion, to confirm
    # marked cells are honored as never-a-queen rather than just skipped by luck.
    board.set_state(0, 0, MARKED)
    solved = solve(board)
    assert solved is not None
    assert solved.state(2, 0) == QUEEN
    assert solved.state(0, 0) == MARKED
    assert solved.is_solved()
    assert sorted(solved.queen_cells()) == sorted(SOLUTION)


def test_backtracking_solver_no_solution():
    board = quadrant_board()
    # Two queens sharing a region up front makes the board unsolvable.
    board.set_state(0, 0, QUEEN)
    board.set_state(1, 1, QUEEN)
    assert solve(board) is None


def test_backtracking_solver_leaves_original_board_untouched():
    board = quadrant_board()
    solve(board)
    assert all(board.state(r, c) == EMPTY for r, c in board.coords())


# ---------------------------------------------------------------------------
# working_candidates (elimination-propagation bookkeeping)
# ---------------------------------------------------------------------------


def test_working_candidates_wide_open_board_is_every_empty_cell():
    board = quadrant_board()
    assert working_candidates(board) == set(board.coords())


def test_working_candidates_excludes_marks_and_queens_peers_and_neighbors():
    board = quadrant_board()
    board.set_state(0, 0, QUEEN)
    board.set_state(3, 3, MARKED)
    cg = working_candidates(board)
    # The queen's own cell, its row/column/region peers, and its 8-neighbors
    # are all gone...
    assert (0, 0) not in cg
    assert (0, 1) not in cg  # row peer
    assert (1, 0) not in cg  # column peer
    assert (1, 1) not in cg  # region peer + neighbor
    # ...as is the independently-marked cell...
    assert (3, 3) not in cg
    # ...while an untouched cell out of the queen's reach survives.
    assert (2, 3) in cg


# ---------------------------------------------------------------------------
# forced_placement (individual technique tests, synthetic board + cg)
# ---------------------------------------------------------------------------


def test_forced_placement_single_candidate_in_unit():
    board = quadrant_board()
    # Hand-built cg, not derived from board state (mirrors
    # tests/test_techniques.py's test_naked_single idiom): row 1 is down to
    # its one remaining live cell; nothing else in cg matters for this check.
    cg = {(0, 0)}
    hint = T.forced_placement(board, cg)
    assert hint is not None
    assert hint.action == "place"
    assert hint.cells == [(0, 0)]
    assert hint.units == ["row 1"]
    assert hint.technique == "Forced placement"


def test_forced_placement_none_when_every_unit_has_multiple_candidates():
    board = quadrant_board()
    cg = working_candidates(board)  # wide open: every unit has 4 live cells
    assert T.forced_placement(board, cg) is None


def test_forced_placement_skips_unit_that_already_has_a_queen():
    # A bare, unpainted board (no regions) isolates the guard to row/column
    # units, so a stray column-of-1 elsewhere can't coincidentally fire too.
    board = Board(4)
    board.set_state(0, 1, QUEEN)
    all_cells = set(board.coords())
    # A stale cg that (incorrectly) still lists row 1 as down to one live
    # cell — every other row/column stays fully open, so the guard against a
    # unit that's already satisfied is the only thing that can suppress a hit.
    cg = all_cells - {(0, 0), (0, 1), (0, 3)}
    assert T.forced_placement(board, cg) is None


# ---------------------------------------------------------------------------
# End-to-end hint pipeline
# ---------------------------------------------------------------------------


def test_hint_pipeline_solves_a_board_reduced_to_forced_singles():
    # Mark every cell that isn't part of the known SOLUTION, so each row,
    # column and region is down to exactly one live cell from the start —
    # a board solvable purely by forced placement, chained four times.
    board = quadrant_board()
    solution_set = set(SOLUTION)
    for r, c in board.coords():
        if (r, c) not in solution_set:
            board.set_state(r, c, MARKED)

    final, steps, solved = solve_with_techniques(board)

    assert solved
    assert steps, "expected at least one hint"
    assert all(step.technique == "Forced placement" for step in steps)
    assert all(step.action == "place" for step in steps)
    assert sorted(final.queen_cells()) == sorted(SOLUTION)


def test_find_hint_returns_correct_placement_step_by_step():
    board = quadrant_board()
    solution_set = set(SOLUTION)
    for r, c in board.coords():
        if (r, c) not in solution_set:
            board.set_state(r, c, MARKED)

    for _ in range(len(SOLUTION)):
        hint = find_hint(board)
        assert hint is not None
        assert hint.action == "place"
        (r, c) = hint.cells[0]
        assert (r, c) in solution_set  # every step matches the known solution
        board = apply_hint(board, hint)

    assert board.is_solved()
    assert sorted(board.queen_cells()) == sorted(SOLUTION)
    assert find_hint(board) is None


# ---------------------------------------------------------------------------
# No hint on solved / invalid boards
# ---------------------------------------------------------------------------


def test_no_hint_on_already_solved_board():
    board = quadrant_board()
    for r, c in SOLUTION:
        board.set_state(r, c, QUEEN)
    assert board.is_solved()
    assert find_hint(board) is None


def test_no_hint_on_invalid_board():
    board = quadrant_board()
    board.set_state(0, 0, QUEEN)
    board.set_state(0, 2, QUEEN)  # two queens in row 1 — invalid
    assert not board.is_valid()
    assert find_hint(board) is None
