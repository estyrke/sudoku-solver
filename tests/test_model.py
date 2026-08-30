from sudoku.model import Board, box_index, cell_name


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
