from queens.model import EMPTY, MARKED, QUEEN, Board
from queens.solver.hint import solve

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
