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
    """The canonical case: two cells totalling 4 can only be {1,3}.

    The first thing to say about it is the bound — its partner can't go below 1,
    so this cell can't go above 3 — which takes out six digits in one line.
    """
    board = Board(cages=[Cage.of([(0, 0), (0, 1)], 4)])
    hint = T.cage_sum(board, _cg(board))
    assert hint.action == "eliminate"
    assert hint.cells == [(0, 0)]
    assert hint.digits == [4, 5, 6, 7, 8, 9]
    assert "must be at most 3" in hint.explanation


def test_cage_sum_still_reaches_what_the_bound_cannot():
    """The bound leaves 2 standing — only the no-repeat rule kills it.

    A clearer first step is worth having only if the rest still follows, so once
    the squeeze is applied the combination list must pick up the remainder.
    """
    board = Board(cages=[Cage.of([(0, 0), (0, 1)], 4)])
    cg = _cg(board)
    seen = []
    while (hint := T.cage_sum(board, cg)) is not None and len(seen) < 10:
        seen.append(hint)
        cg = apply_to_candidates(board, cg, hint)

    assert cg[(0, 0)] == cg[(0, 1)] == {1, 3}
    by_repeat = [h for h in seen if "{13}" in h.explanation]
    assert by_repeat and all(h.digits == [2] for h in by_repeat)


def test_cage_sum_handles_a_partially_filled_cage():
    """A 15-cage with a 9 already placed needs 6 from two cells: {1,5} or {2,4}."""
    board = Board(cages=[Cage.of([(0, 0), (0, 1), (0, 2)], 15)])
    board.set_value(0, 0, 9)
    hint = T.cage_sum(board, _cg(board))
    assert hint.action == "eliminate"
    assert hint.cells == [(0, 1)]
    assert hint.digits == [6, 7, 8]


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
    board = Board(cages=[Cage.of([(0, 0), (0, 1)], 17)])
    board.set_value(3, 0, 9)
    hint = T.cage_sum(board, _cg(board))
    assert "the 17-cage at r1c1" in hint.explanation
    assert "{89}" in hint.explanation
    assert hint.units == ["the 17-cage at r1c1"]


def test_cage_sum_keeps_quiet_rather_than_listing_too_many_sets():
    """A hint the player cannot check is worse than no hint.

    An empty 5-cell cage totalling 25 has dozens of workable sets and no useful
    bound, so there is nothing to say about it that a person could act on.
    """
    cells = [(0, 0), (0, 1), (0, 2), (0, 3), (0, 4)]
    board = Board(cages=[Cage.of(cells, 25)])
    cg = _cg(board)
    _, _, combos, _ = T._cage_options(board, cg, board.cages[0])
    assert len(combos) > T.MAX_LISTED_COMBOS
    assert T._squeezed_out(cells[0], cells, cg, 25) is None

    assert T.cage_sum(board, cg) is None


def test_cage_sum_offers_the_shortest_argument_first():
    """Two cages both have something to say; the two-set one is the checkable one."""
    tight = Cage.of([(0, 0), (0, 1)], 4)  # {13} only
    loose = Cage.of([(4, 0), (4, 1), (4, 2), (4, 3)], 20)  # dozens of sets
    board = Board(cages=[loose, tight])
    cg = _cg(board)
    for cell in loose.cells:  # leave the loose cage nothing a bound can catch
        cg[cell] -= {1, 9}

    hint = T.cage_sum(board, cg)
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


# ---------------------------------------------------------------------------
# Killer Sudoku: the 45-rule
# ---------------------------------------------------------------------------

# Box 1 is rows 1-3 x columns 1-3. These three cages sit wholly inside it and
# cover six of its nine cells, totalling 30.
_BOX1_PARTIAL = [
    Cage.of([(0, 0), (0, 1)], 10),
    Cage.of([(1, 0), (1, 1)], 11),
    Cage.of([(2, 0), (2, 1)], 9),
]


def test_forty_five_rule_finds_an_innie():
    """Cages inside box 1 total 38 and cover all but r1c3, so it must be 45-38."""
    board = Board(cages=_BOX1_PARTIAL + [Cage.of([(1, 2), (2, 2)], 8)])
    hint = T.forty_five_rule(board, _cg(board))
    assert hint.technique == "45-rule (innie)"
    assert hint.action == "place"
    assert hint.cells == [(0, 2)]
    assert hint.digits == [7]
    assert hint.units == ["box 1"]
    assert "45 − 38 = 7" in hint.explanation


def test_forty_five_rule_finds_an_outie():
    """Cages meeting box 1 cover it and spill into r3c4 alone, so that cell is
    pinned by their total minus 45."""
    board = Board(
        cages=_BOX1_PARTIAL + [Cage.of([(0, 2), (1, 2), (2, 2), (2, 3)], 22)]
    )
    hint = T.forty_five_rule(board, _cg(board))
    assert hint.technique == "45-rule (outie)"
    assert hint.action == "place"
    assert hint.cells == [(2, 3)]
    assert hint.digits == [7]
    assert hint.units == ["box 1"]
    assert "52 − 45 = 7" in hint.explanation


def test_forty_five_rule_applies_to_a_row():
    """Four cages inside row 1 total 38 and leave only r1c9."""
    board = Board(
        cages=[
            Cage.of([(0, 0), (0, 1)], 10),
            Cage.of([(0, 2), (0, 3)], 11),
            Cage.of([(0, 4), (0, 5)], 9),
            Cage.of([(0, 6), (0, 7)], 8),
        ]
    )
    hint = T.forty_five_rule(board, _cg(board))
    assert hint.cells == [(0, 8)]
    assert hint.digits == [7]
    assert hint.units == ["row 1"]


def test_forty_five_rule_applies_to_a_column():
    board = Board(
        cages=[
            Cage.of([(0, 0), (1, 0)], 10),
            Cage.of([(2, 0), (3, 0)], 11),
            Cage.of([(4, 0), (5, 0)], 9),
            Cage.of([(6, 0), (7, 0)], 8),
        ]
    )
    hint = T.forty_five_rule(board, _cg(board))
    assert hint.cells == [(8, 0)]
    assert hint.digits == [7]
    assert hint.units == ["column 1"]


def test_forty_five_rule_is_silent_when_two_cells_are_unaccounted_for():
    """Two cells short of a full unit, the difference constrains a set rather
    than pinning a value — out of scope for the single-cell rule."""
    board = Board(cages=_BOX1_PARTIAL)
    assert T.forty_five_rule(board, _cg(board)) is None


def test_forty_five_rule_is_silent_on_a_classic_board():
    board = Board.from_string(EASY)
    assert T.forty_five_rule(board, _cg(board)) is None


def test_forty_five_rule_runs_after_cage_sum():
    names = [fn.__name__ for fn in T.TECHNIQUES]
    assert names.index("cage_sum") < names.index("forty_five_rule")


def _box_cages_leaving_one_innie():
    """Four cages wholly inside each box, covering eight of its nine cells.

    The row-aligned tiling used elsewhere never yields a single innie (every box
    comes up three cells short), so the 45-rule needs its own layout. The ninth
    cell of each box is deliberately left uncaged — a part-caged board is legal,
    and the innie arithmetic doesn't care whether that cell belongs to a cage.
    """
    solved = Board.from_string(SOLUTION)
    total = lambda group: sum(solved.value(r, c) for r, c in group)
    cages = []
    for br in range(3):
        for bc in range(3):
            r0, c0 = br * 3, bc * 3
            for group in (
                [(r0, c0), (r0, c0 + 1)],
                [(r0 + 1, c0), (r0 + 1, c0 + 1)],
                [(r0 + 2, c0), (r0 + 2, c0 + 1)],
                [(r0, c0 + 2), (r0 + 1, c0 + 2)],
            ):
                cages.append(Cage.of(group, total(group)))
    return cages


def test_forty_five_rule_never_contradicts_a_known_solution():
    """Every cage sum comes from SOLUTION, so SOLUTION satisfies them all; an
    innie's value is forced by those sums, so it must agree with SOLUTION."""
    solution = Board.from_string(SOLUTION)
    board = Board(cages=_box_cages_leaving_one_innie())
    cg = working_candidates(board)
    fired = 0
    while (hint := T.forty_five_rule(board, cg)) is not None and fired < 300:
        fired += 1
        r, c = hint.cells[0]
        assert hint.digits[0] == solution.value(r, c), (
            f"placed {hint.digits[0]} at {(r, c)}, solution has {solution.value(r, c)}"
        )
        board.set_value(r, c, hint.digits[0])
        apply_to_candidates(board, cg, hint)
    assert fired == 9, f"expected one innie per box, got {fired}"


# ---------------------------------------------------------------------------
# The player's own notes
# ---------------------------------------------------------------------------


def test_impossible_pencil_mark_flags_a_row_conflict():
    board = Board.from_string(EASY)
    board.cell(0, 2).pencil_marks = {1, 2, 4, 5}  # r1c1 already holds the 5
    hint = T.impossible_pencil_mark(board, _cg(board))
    assert hint.technique == "Impossible pencil mark"
    assert hint.action == "eliminate"
    assert hint.cells == [(0, 2)]
    assert 5 in hint.digits
    assert "r1c1" in hint.explanation


def test_impossible_pencil_mark_flags_a_cage_mate():
    """The case that actually bites on Killer boards: a cage-mate rules the digit
    out even though it shares no row, column or box, which most apps' auto-notes
    don't account for."""
    cage = Cage.of([(0, 2), (1, 2), (1, 3)], 15)
    board = Board(cages=[cage])
    board.set_value(1, 3, 4)
    board.cell(0, 2).pencil_marks = {1, 4, 7}
    assert 4 in Board().candidates(0, 2)  # legal but for the cage
    hint = T.impossible_pencil_mark(board, _cg(board))
    assert hint.cells == [(0, 2)]
    assert hint.digits == [4]
    assert "r2c4" in hint.explanation
    assert "15-cage" in hint.explanation
    assert hint.units == ["the 15-cage at r1c3"]


def test_impossible_pencil_mark_is_silent_when_marks_are_legal():
    board = Board.from_string(EASY)
    board.cell(0, 2).pencil_marks = set(board.candidates(0, 2))
    assert T.impossible_pencil_mark(board, _cg(board)) is None


def test_impossible_pencil_mark_is_silent_without_marks():
    board = Board.from_string(EASY)
    assert T.impossible_pencil_mark(board, _cg(board)) is None


def test_impossible_pencil_mark_runs_before_everything_else():
    """It has to come first: a deduction drawn from corrected candidates is
    unreadable to someone still looking at the uncorrected marks."""
    assert T.TECHNIQUES[0].__name__ == "impossible_pencil_mark"


def test_a_stale_mark_is_reported_before_the_single_it_hides():
    """Regression for the reported bug: the engine offered a hidden single that
    the player could not see, because it had quietly dropped the mark that made
    the digit ambiguous."""
    board = Board.from_string(EASY)
    board.cell(0, 2).pencil_marks = {1, 2, 4, 5}
    first = find_hint(board)
    assert first.technique == "Impossible pencil mark"


def test_solve_with_techniques_terminates_despite_stale_marks():
    """A stale mark is already absent from the candidate grid, so eliminating it
    changes nothing there — the run must strip it from the board's marks too or
    the same hint is re-found forever."""
    board = Board.from_string(EASY)
    board.cell(0, 2).pencil_marks = {1, 2, 4, 5}
    final, steps, solved = solve_with_techniques(board)
    assert solved
    assert any(s.technique == "Impossible pencil mark" for s in steps)
    assert 5 not in final.cell(0, 2).pencil_marks
