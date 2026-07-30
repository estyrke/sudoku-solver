from queens.model import EMPTY, MARKED, QUEEN, Board, cell_name

# A 4x4 board split into four 2x2 quadrant regions (0=top-left, 1=top-right,
# 2=bottom-left, 3=bottom-right), used across several tests below.
QUADRANTS = [
    [0, 0, 1, 1],
    [0, 0, 1, 1],
    [2, 2, 3, 3],
    [2, 2, 3, 3],
]

# One valid non-attacking placement on QUADRANTS: one queen per row, column and
# region, no two adjacent (incl. diagonally).
SOLUTION = [(0, 1), (1, 3), (2, 0), (3, 2)]


def quadrant_board() -> Board:
    return Board.from_grid(QUADRANTS)


def test_cell_name():
    assert cell_name(0, 0) == "r1c1"
    assert cell_name(3, 2) == "r4c3"


def test_neighbors_corner_and_middle():
    board = quadrant_board()
    assert board.neighbors(0, 0) == {(0, 1), (1, 0), (1, 1)}
    assert board.neighbors(1, 1) == {
        (0, 0), (0, 1), (0, 2),
        (1, 0), (1, 2),
        (2, 0), (2, 1), (2, 2),
    }


def test_peers_row_col_region():
    board = quadrant_board()
    peers = board.peers(0, 0)
    assert peers == {
        (0, 1), (0, 2), (0, 3),  # row
        (1, 0), (2, 0), (3, 0),  # column
        (1, 1),  # region-mate, not otherwise counted
    }
    assert (0, 0) not in peers


def test_units_cover_rows_cols_regions():
    board = quadrant_board()
    units = list(board.units())
    assert len(units) == 4 + 4 + 4
    assert all(len(cells) == 4 for _, cells in units)


def test_region_cells_and_region_ids():
    board = quadrant_board()
    assert board.region_ids() == {0, 1, 2, 3}
    assert set(board.region_cells(0)) == {(0, 0), (0, 1), (1, 0), (1, 1)}


def test_unpainted_region_defaults_to_none():
    board = Board(3)
    assert all(board.region(r, c) is None for r, c in board.coords())
    assert board.region_ids() == set()


def test_row_conflict_invalid():
    board = quadrant_board()
    board.set_state(0, 0, QUEEN)
    board.set_state(0, 2, QUEEN)
    assert not board.is_valid()


def test_column_conflict_invalid():
    board = quadrant_board()
    board.set_state(0, 0, QUEEN)
    board.set_state(2, 0, QUEEN)
    assert not board.is_valid()


def test_region_conflict_invalid():
    board = quadrant_board()
    board.set_state(0, 0, QUEEN)
    board.set_state(1, 1, QUEEN)  # both region 0, not adjacent-relevant here
    assert not board.is_valid()


def test_adjacency_conflict_invalid_including_diagonal():
    board = quadrant_board()
    board.set_state(0, 1, QUEEN)
    board.set_state(1, 2, QUEEN)  # diagonal neighbor, different row/col/region
    assert not board.is_valid()


def test_non_adjacent_distinct_units_is_valid():
    board = quadrant_board()
    for r, c in SOLUTION:
        board.set_state(r, c, QUEEN)
    assert board.is_valid()


def test_is_solved():
    board = quadrant_board()
    for r, c in SOLUTION:
        board.set_state(r, c, QUEEN)
    assert board.is_solved()


def test_is_solved_false_when_incomplete():
    board = quadrant_board()
    board.set_state(0, 1, QUEEN)
    assert not board.is_solved()


def test_marks_do_not_affect_validity_or_solved():
    board = quadrant_board()
    for r, c in SOLUTION:
        board.set_state(r, c, QUEEN)
    board.set_state(3, 3, MARKED)
    assert board.is_valid()
    assert board.is_solved()


def test_serialization_roundtrip():
    board = quadrant_board()
    board.set_state(0, 1, QUEEN)
    board.set_state(2, 2, MARKED)
    again = Board.from_dict(board.to_dict())
    assert again.to_dict() == board.to_dict()
    assert again.n == board.n
    assert again.state(0, 1) == QUEEN
    assert again.state(2, 2) == MARKED
    assert again.region(0, 1) == board.region(0, 1)


def test_from_grid_builds_empty_board_with_regions():
    board = quadrant_board()
    assert board.n == 4
    assert all(board.state(r, c) == EMPTY for r, c in board.coords())
    assert board.region(3, 3) == 3
