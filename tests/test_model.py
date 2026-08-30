import pytest

from sudoku.model import Board, Cage, box_index, cell_name


def test_box_index_and_name():
    assert box_index(0, 0) == 0
    assert box_index(4, 4) == 4
    assert box_index(8, 8) == 8
    assert cell_name(0, 0) == "r1c1"
    assert cell_name(3, 6) == "r4c7"


def test_peers_count():
    peers = Board().peers(4, 4)
    assert len(peers) == 20
    assert (4, 4) not in peers
    assert (4, 0) in peers and (0, 4) in peers and (3, 3) in peers


def test_units_cover_all():
    board = Board()
    units = list(board.units())
    assert len(units) == 27
    assert all(len(cells) == 9 for _, cells in units)


def test_candidates_from_values():
    board = Board.from_string("." * 81)
    # fill a full row except one cell -> that cell's row constraint is tight
    for c in range(8):
        board.set_value(0, c, c + 1)  # 1..8 in r1c1..r1c8
    # r1c9 cannot be 1..8; box/col also constrain but at least 9 is allowed
    assert board.candidates(0, 8) == {9}


def test_string_roundtrip_and_validity():
    s = "530070000600195000098000060800060003400803001700020006060000280000419005000080079"
    board = Board.from_string(s)
    assert board.is_valid()
    assert not board.is_solved()
    # serialization round-trips
    again = Board.from_dict(board.to_dict())
    assert again.to_dict() == board.to_dict()


def test_invalid_detected():
    board = Board.from_string("." * 81)
    board.set_value(0, 0, 5)
    board.set_value(0, 1, 5)
    assert not board.is_valid()


# ---------------------------------------------------------------------------
# Killer Sudoku: cages
# ---------------------------------------------------------------------------


def _killer_cages(grid: list[list[int]]) -> list[Cage]:
    """Partition every row into contiguous runs of 2,2,2,3 cells.

    Same-row cells always hold distinct digits, so each cage is legal by
    construction and consistent with ``grid`` as a solution.
    """
    spans = [(0, 2), (2, 4), (4, 6), (6, 9)]
    return [
        Cage.of([(r, c) for c in range(a, b)], sum(grid[r][c] for c in range(a, b)))
        for r in range(9)
        for a, b in spans
    ]


SOLUTION = [
    [5, 3, 4, 6, 7, 8, 9, 1, 2],
    [6, 7, 2, 1, 9, 5, 3, 4, 8],
    [1, 9, 8, 3, 4, 2, 5, 6, 7],
    [8, 5, 9, 7, 6, 1, 4, 2, 3],
    [4, 2, 6, 8, 5, 3, 7, 9, 1],
    [7, 1, 3, 9, 2, 4, 8, 5, 6],
    [9, 6, 1, 5, 3, 7, 2, 8, 4],
    [2, 8, 7, 4, 1, 9, 6, 3, 5],
    [3, 4, 5, 2, 8, 6, 1, 7, 9],
]


def test_cage_rejects_single_cell():
    with pytest.raises(ValueError, match="at least 2 cells"):
        Cage.of([(0, 0)], 5)


def test_cage_rejects_non_contiguous():
    with pytest.raises(ValueError, match="contiguous"):
        Cage.of([(0, 0), (0, 2)], 10)


def test_cage_rejects_diagonal_only_contact():
    # touching at a corner is not orthogonal adjacency
    with pytest.raises(ValueError, match="contiguous"):
        Cage.of([(0, 0), (1, 1)], 10)


def test_cage_rejects_unreachable_sums():
    # two distinct digits total 3..17
    with pytest.raises(ValueError, match="must total 3..17"):
        Cage.of([(0, 0), (0, 1)], 2)
    with pytest.raises(ValueError, match="must total 3..17"):
        Cage.of([(0, 0), (0, 1)], 18)


def test_cage_rejects_overlap():
    a = Cage.of([(0, 0), (0, 1)], 8)
    b = Cage.of([(0, 1), (0, 2)], 8)
    with pytest.raises(ValueError, match="more than one cage"):
        Board(cages=[a, b])


# An L-shaped cage whose ends share no row, column or box: (0,2) is in box 0,
# (1,3) in box 1, on different rows and columns. Two orthogonally-adjacent cells
# always share a row or column, so it takes 3 cells to get a cage-mate that
# isn't already a classic peer — which is what makes these tests discriminating.
_L_CAGE = [(0, 2), (1, 2), (1, 3)]


def test_cage_mates_are_peers():
    board = Board(cages=[Cage.of(_L_CAGE, 15)])
    assert (1, 3) not in Board().peers(0, 2)  # not a peer without the cage
    assert (1, 3) in board.peers(0, 2)  # the cage put it there
    assert len(board.peers(0, 2)) == 21  # classic 20 plus exactly that one


def test_uncaged_board_has_exactly_the_classic_peers():
    assert len(Board().peers(4, 4)) == 20


def test_candidates_exclude_cage_mate_values():
    board = Board(cages=[Cage.of(_L_CAGE, 15)])
    board.set_value(1, 3, 4)
    assert 4 in Board().candidates(0, 2)  # legal without the cage
    assert 4 not in board.candidates(0, 2)  # the cage's no-repeat rules it out


def test_cage_validity_flags_repeat_and_overshoot():
    cage = Cage.of([(0, 0), (1, 0)], 10)  # vertical, crosses no box boundary
    board = Board(cages=[cage])
    board.set_value(0, 0, 4)
    assert board.is_valid()
    board.set_value(1, 0, 9)  # 4 + 9 = 13 > 10
    assert not board.is_valid()


def test_cage_validity_flags_unreachable_remainder():
    # three cells totalling 24 is only 7+8+9; if one is a 1 the rest can't reach 23
    cage = Cage.of([(0, 0), (0, 1), (0, 2)], 24)
    board = Board(cages=[cage])
    board.set_value(0, 0, 1)
    assert not board.is_valid()


def test_full_cage_must_hit_its_sum_exactly():
    cage = Cage.of([(0, 0), (0, 1)], 10)
    board = Board(cages=[cage])
    board.set_value(0, 0, 3)
    board.set_value(0, 1, 6)  # 9, not 10
    assert not board.is_valid()
    board.set_value(0, 1, 7)  # 10
    assert board.is_valid()


def test_is_fully_caged():
    assert not Board().is_fully_caged()
    assert Board(cages=_killer_cages(SOLUTION)).is_fully_caged()


def test_cage_serialization_roundtrip():
    board = Board(cages=_killer_cages(SOLUTION))
    board.set_value(0, 0, 5)
    again = Board.from_dict(board.to_dict())
    assert again.to_dict() == board.to_dict()
    assert len(again.cages) == len(board.cages)
    assert again.cage_at(0, 0) is not None
    assert again.cage_at(0, 0).sum == board.cage_at(0, 0).sum


def test_cageless_board_omits_cages_from_serialization():
    assert "cages" not in Board().to_dict()
