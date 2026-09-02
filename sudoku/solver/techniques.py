"""Human solving techniques, ordered by difficulty.

Each technique is a function ``(board, cg) -> Optional[Hint]`` where ``cg`` is the
working candidate grid: ``{(r, c): set_of_candidates}`` for every empty cell. A
technique inspects ``cg`` and returns the *first* deduction it finds, or ``None``.
They never mutate anything — a hint describes one step, the caller decides whether
to apply it.

Passing ``cg`` in (rather than deriving it from values inside each technique) is
what lets elimination steps persist: pointing/box-line/subset moves narrow ``cg``,
and a later single can then become visible. The caller seeds ``cg`` from the user's
pencil marks when present, falling back to candidates derived from board values
(see :func:`sudoku.solver.hint.working_candidates`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations
from typing import Optional

from ..model import COORDS, DIGITS, Board, Cage, box_index, cell_name

Coord = tuple[int, int]
CandGrid = dict[Coord, set[int]]


@dataclass
class Hint:
    """One solving step.

    ``action`` is ``"place"`` (write ``digits[0]`` into ``cells[0]``) or
    ``"eliminate"`` (remove ``digits`` from the candidates of every cell in
    ``cells``). ``level`` ranks difficulty so callers can show "simplest first".
    """

    technique: str
    level: int
    action: str  # "place" | "eliminate"
    cells: list[Coord]
    digits: list[int]
    units: list[str] = field(default_factory=list)
    explanation: str = ""

    def to_dict(self) -> dict:
        return {
            "technique": self.technique,
            "level": self.level,
            "action": self.action,
            "cells": [{"r": r, "c": c} for r, c in self.cells],
            "digits": self.digits,
            "units": self.units,
            "explanation": self.explanation,
        }


def _names(cells: list[Coord]) -> str:
    return ", ".join(cell_name(r, c) for r, c in cells)


def _empties(cells: list[Coord], cg: CandGrid) -> list[Coord]:
    return [cell for cell in cells if cell in cg]


# ---------------------------------------------------------------------------
# The player's own notes
# ---------------------------------------------------------------------------


def _ruled_out_by(board: Board, cell: Coord, d: int) -> Optional[tuple[Coord, str]]:
    """The placed ``d`` that makes it impossible at ``cell``, and how it relates."""
    r, c = cell
    cage = board.cage_at(r, c)
    for peer in sorted(board.peers(r, c)):
        if board.value(*peer) != d:
            continue
        pr, pc = peer
        if pr == r:
            return peer, f"row {r + 1}"
        if pc == c:
            return peer, f"column {c + 1}"
        if box_index(pr, pc) == box_index(r, c):
            return peer, f"box {box_index(r, c) + 1}"
        if cage is not None and peer in cage.cells:
            return peer, _cage_label(cage)
    return None


def impossible_pencil_mark(board: Board, cg: CandGrid) -> Optional[Hint]:
    """Flag a pencil mark that a placed digit already rules out.

    The engine reasons over the player's marks intersected with what is actually
    legal, so an impossible mark is quietly ignored. That makes a later deduction
    look like sleight of hand — "8 fits only in r8c9" reads as nonsense to someone
    who can still see an 8 pencilled in r8c8. Correcting the marks is the missing
    first step, not something to apply behind the player's back
    (``sudoku/CONTEXT.md``, *Pencil mark*).

    It matters most on Killer boards, where a cage-mate rules out a digit even
    though it shares no row, column or box — a constraint most apps' auto-notes
    don't apply.
    """
    for r, c in COORDS:
        if board.value(r, c) is not None:
            continue
        marks = board.cell(r, c).pencil_marks
        if not marks:
            continue
        stale = sorted(marks - board.candidates(r, c))
        if not stale:
            continue

        blame = {d: _ruled_out_by(board, (r, c), d) for d in stale}
        parts = [
            f"{d} is already in {cell_name(*found[0])} ({found[1]})"
            for d, found in blame.items()
            if found is not None
        ]
        first = next((f for f in blame.values() if f is not None), None)
        return Hint(
            technique="Impossible pencil mark",
            level=0,
            action="eliminate",
            cells=[(r, c)],
            digits=stale,
            units=[first[1]] if first else [],
            explanation=(
                f"{cell_name(r, c)} is pencilled "
                f"{', '.join(str(d) for d in stale)}, but "
                + "; ".join(parts)
                + ". Rub that out before looking for anything cleverer — "
                "the board reads differently once it's gone."
            ),
        )
    return None


# ---------------------------------------------------------------------------
# Singles
# ---------------------------------------------------------------------------


def naked_single(board: Board, cg: CandGrid) -> Optional[Hint]:
    for (r, c), cands in cg.items():
        if len(cands) == 1:
            (d,) = tuple(cands)
            return Hint(
                technique="Naked single",
                level=1,
                action="place",
                cells=[(r, c)],
                digits=[d],
                explanation=(
                    f"{cell_name(r, c)} has only one remaining candidate, {d}, "
                    f"so it must go there."
                ),
            )
    return None


def hidden_single(board: Board, cg: CandGrid) -> Optional[Hint]:
    for label, cells in board.units():
        empties = _empties(cells, cg)
        for d in range(1, 10):
            holders = [cell for cell in empties if d in cg[cell]]
            if len(holders) == 1:
                r, c = holders[0]
                if len(cg[(r, c)]) == 1:
                    continue  # already a naked single, reported by the simpler rule
                return Hint(
                    technique="Hidden single",
                    level=2,
                    action="place",
                    cells=[(r, c)],
                    digits=[d],
                    units=[label],
                    explanation=(
                        f"In {label}, {d} fits only in {cell_name(r, c)}, "
                        f"so it must go there."
                    ),
                )
    return None


# ---------------------------------------------------------------------------
# Naked / hidden subsets
# ---------------------------------------------------------------------------


def _naked_subset(board: Board, cg: CandGrid, n: int, level: int, name: str) -> Optional[Hint]:
    for label, cells in board.units():
        empties = _empties(cells, cg)
        for combo in combinations(empties, n):
            union: set[int] = set().union(*(cg[cell] for cell in combo))
            if len(union) != n:
                continue
            elim_cells = [
                cell for cell in empties if cell not in combo and cg[cell] & union
            ]
            if elim_cells:
                return Hint(
                    technique=f"Naked {name}",
                    level=level,
                    action="eliminate",
                    cells=elim_cells,
                    digits=sorted(union),
                    units=[label],
                    explanation=(
                        f"In {label}, {_names(list(combo))} together hold only "
                        f"{sorted(union)}, so those digits can be removed from "
                        f"{_names(elim_cells)}."
                    ),
                )
    return None


def naked_pair(board, cg):
    return _naked_subset(board, cg, 2, 3, "pair")


def naked_triple(board, cg):
    return _naked_subset(board, cg, 3, 4, "triple")


def naked_quad(board, cg):
    return _naked_subset(board, cg, 4, 5, "quad")


def _hidden_subset(board: Board, cg: CandGrid, n: int, level: int, name: str) -> Optional[Hint]:
    for label, cells in board.units():
        empties = _empties(cells, cg)
        present = [d for d in range(1, 10) if any(d in cg[cell] for cell in empties)]
        for combo in combinations(present, n):
            holders = [cell for cell in empties if cg[cell] & set(combo)]
            if len(holders) != n:
                continue
            elim_cells = [cell for cell in holders if cg[cell] - set(combo)]
            if elim_cells:
                removed = sorted(
                    set().union(*(cg[cell] for cell in elim_cells)) - set(combo)
                )
                return Hint(
                    technique=f"Hidden {name}",
                    level=level,
                    action="eliminate",
                    cells=sorted(elim_cells),
                    digits=removed,
                    units=[label],
                    explanation=(
                        f"In {label}, {sorted(combo)} appear only in "
                        f"{_names(sorted(holders))}, so other candidates "
                        f"({removed}) can be removed from those cells."
                    ),
                )
    return None


def hidden_pair(board, cg):
    return _hidden_subset(board, cg, 2, 4, "pair")


def hidden_triple(board, cg):
    return _hidden_subset(board, cg, 3, 5, "triple")


# ---------------------------------------------------------------------------
# Intersections
# ---------------------------------------------------------------------------


def pointing(board: Board, cg: CandGrid) -> Optional[Hint]:
    """Box -> line: a digit confined to one row/col within a box clears that line
    elsewhere."""
    for b in range(9):
        box = _empties(Board.box_cells(b), cg)
        for d in range(1, 10):
            holders = [(r, c) for (r, c) in box if d in cg[(r, c)]]
            if len(holders) < 2:
                continue
            rows = {r for r, _ in holders}
            cols = {c for _, c in holders}
            if len(rows) == 1:
                (r,) = tuple(rows)
                line = _empties(Board.row_cells(r), cg)
                line_label = f"row {r + 1}"
            elif len(cols) == 1:
                (c,) = tuple(cols)
                line = _empties(Board.col_cells(c), cg)
                line_label = f"column {c + 1}"
            else:
                continue
            elim = [cell for cell in line if cell not in box and d in cg[cell]]
            if elim:
                return Hint(
                    technique="Pointing pair/triple",
                    level=6,
                    action="eliminate",
                    cells=elim,
                    digits=[d],
                    units=[f"box {b + 1}", line_label],
                    explanation=(
                        f"In box {b + 1}, {d} can only sit in {line_label} "
                        f"({_names(holders)}), so {d} is removed from the rest of "
                        f"{line_label}: {_names(elim)}."
                    ),
                )
    return None


def claiming(board: Board, cg: CandGrid) -> Optional[Hint]:
    """Line -> box: a digit confined to one box within a row/col clears the rest of
    that box."""
    lines: list[tuple[str, list[Coord]]] = []
    for r in range(9):
        lines.append((f"row {r + 1}", Board.row_cells(r)))
    for c in range(9):
        lines.append((f"column {c + 1}", Board.col_cells(c)))
    for label, cells in lines:
        empties = _empties(cells, cg)
        for d in range(1, 10):
            holders = [cell for cell in empties if d in cg[cell]]
            if len(holders) < 2:
                continue
            boxes = {box_index(r, c) for r, c in holders}
            if len(boxes) != 1:
                continue
            (b,) = tuple(boxes)
            box = _empties(Board.box_cells(b), cg)
            elim = [cell for cell in box if cell not in holders and d in cg[cell]]
            if elim:
                return Hint(
                    technique="Box/line reduction",
                    level=6,
                    action="eliminate",
                    cells=elim,
                    digits=[d],
                    units=[label, f"box {b + 1}"],
                    explanation=(
                        f"In {label}, {d} can only sit inside box {b + 1} "
                        f"({_names(holders)}), so {d} is removed from the rest of "
                        f"box {b + 1}: {_names(elim)}."
                    ),
                )
    return None


# ---------------------------------------------------------------------------
# Fish
# ---------------------------------------------------------------------------


def x_wing(board: Board, cg: CandGrid) -> Optional[Hint]:
    def search(by_row: bool) -> Optional[Hint]:
        for d in range(1, 10):
            positions: dict[int, list[int]] = {}
            for i in range(9):
                cross = []
                for j in range(9):
                    r, c = (i, j) if by_row else (j, i)
                    if (r, c) in cg and d in cg[(r, c)]:
                        cross.append(j)
                if len(cross) == 2:
                    positions[i] = cross
            for a, b in combinations(positions, 2):
                if positions[a] != positions[b]:
                    continue
                p, q = positions[a]
                elim: list[Coord] = []
                for k in range(9):
                    if k in (a, b):
                        continue
                    for cross in (p, q):
                        r, c = (k, cross) if by_row else (cross, k)
                        if (r, c) in cg and d in cg[(r, c)]:
                            elim.append((r, c))
                if elim:
                    orient = "rows" if by_row else "columns"
                    return Hint(
                        technique="X-Wing",
                        level=7,
                        action="eliminate",
                        cells=elim,
                        digits=[d],
                        explanation=(
                            f"{d} forms an X-Wing across {orient} {a + 1} and "
                            f"{b + 1}, so {d} is removed from {_names(elim)}."
                        ),
                    )
        return None

    return search(by_row=True) or search(by_row=False)


# Ordered simplest -> hardest. find_hint() walks this list and returns the first hit.
# ---------------------------------------------------------------------------
# Killer Sudoku: cage sums
# ---------------------------------------------------------------------------


def _cage_label(cage: Cage) -> str:
    """``the 15-cage at r1c1`` — anchored on the topmost-then-leftmost cell,
    the same one the UI prints the sum in."""
    return f"the {cage.sum}-cage at {cell_name(*min(cage.cells))}"


def _deals_out(digits: tuple[int, ...], cells: list[Coord], cg: CandGrid) -> bool:
    """Whether ``digits`` can be dealt one-each to ``cells`` respecting candidates.

    A combination can total correctly yet still be impossible — e.g. {1,3} is no
    use if both cells have already lost the 3. Matching cells to digits rules
    that out, keeping eliminations sound.
    """
    owner: dict[int, Coord] = {}  # index into digits -> cell holding it

    def place(cell: Coord, tried: set[int]) -> bool:
        for i, d in enumerate(digits):
            if i in tried or d not in cg[cell]:
                continue
            tried.add(i)
            if i not in owner or place(owner[i], tried):
                owner[i] = cell
                return True
        return False

    return all(place(cell, set()) for cell in cells)


def _cage_options(board: Board, cg: CandGrid, cage: Cage):
    """For one cage: its empty cells, the digits actually placeable in each, and
    the combinations considered. ``None`` when the cage has nothing to say."""
    empties = [cell for cell in sorted(cage.cells) if cell in cg]
    if not empties:
        return None
    filled = [board.value(r, c) for r, c in cage.cells if board.value(r, c) is not None]
    remaining = cage.sum - sum(filled)
    pool = sorted(set(DIGITS) - set(filled))

    combos: list[tuple[int, ...]] = []
    allowed: dict[Coord, set[int]] = {cell: set() for cell in empties}
    for combo in combinations(pool, len(empties)):
        if sum(combo) != remaining or not _deals_out(combo, empties, cg):
            continue
        combos.append(combo)
        for cell in empties:
            others = [x for x in empties if x != cell]
            for d in combo:
                if d in cg[cell] and d not in allowed[cell]:
                    rest = list(combo)
                    rest.remove(d)
                    if _deals_out(tuple(rest), others, cg):
                        allowed[cell].add(d)
    if not combos:
        return None  # cage is unsatisfiable; that's is_valid's business, not a hint
    return empties, allowed, combos, remaining


def _combo_list(combos: list[tuple[int, ...]]) -> str:
    return ", ".join("{" + "".join(str(d) for d in combo) + "}" for combo in combos)


# The combination list is checked by hand — the player has to hold every set in
# their head and confirm the digit really is absent from (or present in) all of
# them. Past a handful that stops being an explanation and becomes an assertion:
# "the only workable sets are {13579}, {13678}, {14569} and 17 more, so 2 cannot go
# in r4c8" is impossible to verify, and impossible to act on if the reason it fires
# is a mistyped pencil mark rather than a real deduction. So a cage whose reasoning
# is longer than this is left alone: another technique speaks instead, or the hint
# engine escalates past cage sums entirely.
MAX_LISTED_COMBOS = 4


def _reach(cells: list[Coord], cg: CandGrid) -> Optional[tuple[int, int]]:
    """The loosest bounds on what ``cells`` can total between them.

    Bounds the sum by the smallest and the largest distinct digits still pencilled
    anywhere across the group. That is weaker than a true per-cell assignment — it
    admits totals no real placement reaches — but it is only ever used to *prove* a
    digit impossible, and a bound that admits too much never proves too much. It
    buys a one-line argument the player can check against their own marks instead
    of a list of sets they have to take on trust.
    """
    if not cells:
        return None
    pool = sorted(set().union(*(cg[cell] for cell in cells)))
    if len(pool) < len(cells):
        return None
    k = len(cells)
    return sum(pool[:k]), sum(pool[-k:])


def _squeezed_out(
    cell: Coord, empties: list[Coord], cg: CandGrid, remaining: int
) -> Optional[tuple[list[int], str]]:
    """Digits ``cell`` can't hold because of what the rest of the cage must total.

    What the other cells can reach pins ``cell`` between two values, so a whole
    run of digits falls at once — the elimination and its reason are the same
    sentence.
    """
    others = [x for x in empties if x != cell]
    bounds = _reach(others, cg)
    if bounds is None:
        return None
    low, high = bounds
    n = _cells_phrase(len(others))
    too_small = sorted(d for d in cg[cell] if remaining - d > high)
    if too_small:
        return too_small, (
            f"The other {n} can total at most {high}, so {cell_name(*cell)} "
            f"must be at least {remaining - high}"
        )
    too_big = sorted(d for d in cg[cell] if remaining - d < low)
    if too_big:
        return too_big, (
            f"The other {n} can total at least {low}, so {cell_name(*cell)} "
            f"must be at most {remaining - low}"
        )
    return None


def _cells_phrase(n: int) -> str:
    return "cell" if n == 1 else f"{n} cells"


def cage_sum(board: Board, cg: CandGrid) -> Optional[Hint]:
    """Restrict a cage's candidates to digit sets that can reach its sum.

    Purely about sum reachability — a cage's no-repeat rule is already handled
    by cage-mates being peers, so it never has to be re-derived here.

    Cages are worked cheapest-first rather than in board order, and the wording
    prefers a bound over a list of sets, because a hint nobody can follow is worse
    than no hint: it leaves the player unable to tell a real deduction from a
    consequence of one bad pencil mark.
    """
    if not board.cages:
        return None
    analysed = []
    for cage in board.cages:
        options = _cage_options(board, cg, cage)
        if options is not None:
            analysed.append((cage, *options))
    # Fewest sets to check first, then fewest cells — the shortest argument wins.
    analysed.sort(key=lambda a: (len(a[3]), len(a[1])))
    short = [a for a in analysed if len(a[3]) <= MAX_LISTED_COMBOS]

    # A cell only one digit can occupy is the stronger deduction, so look first.
    for cage, empties, allowed, combos, remaining in short:
        for cell in empties:
            if len(allowed[cell]) == 1 and len(cg[cell]) > 1:
                d = next(iter(allowed[cell]))
                return Hint(
                    technique="Cage sum",
                    level=3,
                    action="place",
                    cells=[cell],
                    digits=[d],
                    units=[_cage_label(cage)],
                    explanation=(
                        f"{_cage_label(cage)} needs {remaining} more across "
                        f"{_cells_phrase(len(empties))}. The only workable sets are "
                        f"{_combo_list(combos)}, and every one of them puts {d} "
                        f"in {cell_name(*cell)}."
                    ),
                )

    # Digits the cage's arithmetic squeezes out are one line to check, so they beat
    # any set list — even a set list from a cage with fewer combinations.
    for cage, empties, allowed, combos, remaining in analysed:
        for cell in empties:
            if not allowed[cell]:
                continue
            squeezed = _squeezed_out(cell, empties, cg, remaining)
            if squeezed is None:
                continue
            gone, why = squeezed
            return Hint(
                technique="Cage sum",
                level=3,
                action="eliminate",
                cells=[cell],
                digits=gone,
                units=[_cage_label(cage)],
                explanation=(
                    f"{_cage_label(cage)} needs {remaining} more across "
                    f"{_cells_phrase(len(empties))}. {why} — "
                    f"{', '.join(str(d) for d in gone)} cannot go there."
                ),
            )

    for cage, empties, allowed, combos, remaining in short:
        for cell in empties:
            gone = sorted(cg[cell] - allowed[cell])
            if gone and allowed[cell]:
                return Hint(
                    technique="Cage sum",
                    level=3,
                    action="eliminate",
                    cells=[cell],
                    digits=gone,
                    units=[_cage_label(cage)],
                    explanation=(
                        f"{_cage_label(cage)} needs {remaining} more across "
                        f"{_cells_phrase(len(empties))}. The only workable sets are "
                        f"{_combo_list(combos)}, so "
                        f"{', '.join(str(d) for d in gone)} cannot go in "
                        f"{cell_name(*cell)}."
                    ),
                )
    return None


# ---------------------------------------------------------------------------
# Killer Sudoku: the 45-rule (innies and outies)
# ---------------------------------------------------------------------------

UNIT_TOTAL = sum(DIGITS)  # 45 — every unit holds each digit exactly once


def _covered(cages: list[Cage]) -> set[Coord]:
    out: set[Coord] = set()
    for cage in cages:
        out |= cage.cells
    return out


# How many units a 45-rule span may cover. Two and three rows (or columns) are
# where the rule earns its keep: a single row often has no cage lying wholly
# inside it, while a band of two or three usually does, and the arithmetic closes
# on a band exactly as it does on one unit. On the board that prompted this,
# every single unit was silent and rows 1-2 immediately pinned a cell.
MAX_BAND = 3


def _spans(board: Board):
    """``(label, cells, total)`` for every span the 45-rule can be applied to.

    The nine rows, columns and boxes, plus runs of two and three adjacent rows or
    columns. Adjacent only because that is where cages cluster: any set of whole
    units is arithmetically valid, but scanning all of them costs far more and
    finds almost nothing.
    """
    for label, cells in board.units():
        yield label, set(cells), UNIT_TOTAL
    for n in range(2, MAX_BAND + 1):
        for start in range(9 - n + 1):
            span = f"{start + 1}-{start + n}"
            yield (
                f"rows {span}",
                {(r, c) for r in range(start, start + n) for c in range(9)},
                UNIT_TOTAL * n,
            )
            yield (
                f"columns {span}",
                {(r, c) for c in range(start, start + n) for r in range(9)},
                UNIT_TOTAL * n,
            )


def _unaccounted(board: Board, span: set[Coord], total: int):
    """The cells a span's 45-rule arithmetic leaves over, and what they total.

    Yields ``(kind, cells, owed, cages_total)``: the *innies* are the span's cells
    no cage inside it covers, and the *outies* are the cells outside it that the
    cages meeting it spill onto. ``cages_total`` is carried so the explanation can
    show the subtraction rather than assert its result.
    """
    inside = [cage for cage in board.cages if cage.cells <= span]
    innies = span - _covered(inside)
    if innies:
        held = sum(cage.sum for cage in inside)
        yield "innie", innies, total - held, held

    touching = [cage for cage in board.cages if cage.cells & span]
    reach = _covered(touching)
    if span <= reach:  # otherwise part of the span is uncaged and nothing closes
        outies = reach - span
        if outies:
            held = sum(cage.sum for cage in touching)
            yield "outie", outies, held - total, held


def _forty_five_placement(
    cg: CandGrid, cell: Coord, value: int
) -> bool:
    """Whether ``value`` at ``cell`` is a placement worth reporting."""
    if not 1 <= value <= 9 or cell not in cg:
        return False
    if value not in cg[cell]:
        return False  # contradiction, not a hint — is_valid's business
    return len(cg[cell]) > 1  # a lone candidate is a naked single, reported simpler


def forty_five_rule(board: Board, cg: CandGrid) -> Optional[Hint]:
    """Pin a single innie or outie by the 45-rule.

    Two arithmetic shapes, both from "every unit totals 45":

    *Innie* — the cages lying wholly inside a span cover all but one of its
    cells, so that cell holds ``total - (those cages' sum)``.

    *Outie* — the cages meeting a span cover it entirely and spill outside it by
    exactly one cell, so that cell holds ``(their sum) - total``.

    Applied to runs of up to three rows or columns as well as to single units;
    see ``_spans``. When more than one cell is left over the difference
    constrains a set rather than pinning a value — that is ``forty_five_sets``,
    which is a harder read and sits much later in the catalog.
    """
    if not board.cages:
        return None

    for label, span, total in _spans(board):
        for kind, cells, owed, held in _unaccounted(board, span, total):
            if len(cells) != 1:
                continue
            cell = next(iter(cells))
            if not _forty_five_placement(cg, cell, owed):
                continue
            name = cell_name(*cell)
            why = (
                f"The cages wholly inside {label} total {held} and cover all "
                f"but {name}. {label} must total {total}, so {name} is "
                f"{total} \u2212 {held} = {owed}."
                if kind == "innie"
                else f"The cages meeting {label} total {held} and cover it "
                f"entirely, sticking out only into {name}. {label} must total "
                f"{total}, so {name} is {held} \u2212 {total} = {owed}."
            )
            return Hint(
                technique=f"45-rule ({kind})",
                level=4,
                action="place",
                cells=[cell],
                digits=[owed],
                units=[label],
                explanation=why,
            )
    return None


# ---------------------------------------------------------------------------
# Killer Sudoku: the 45-rule over several cells at once
# ---------------------------------------------------------------------------

# Beyond four the total says almost nothing: the reachable range is nearly the
# whole of 1-9 for every cell, so the bound never bites and the work is wasted.
MAX_LEFTOVER = 4


def _all_distinct(cells: list[Coord]) -> bool:
    """Whether these cells are guaranteed to hold different digits.

    They are if they share a row, a column or a box. It matters because the bound
    in ``_squeezed_out`` sums *distinct* digits: allow repeats and the true
    minimum drops to k copies of the smallest, and the elimination is unsound.
    Innies of a single unit always qualify; innies of a wider span and outies
    often don't, and those are simply left alone.
    """
    return (
        len({r for r, _ in cells}) == 1
        or len({c for _, c in cells}) == 1
        or len({box_index(r, c) for r, c in cells}) == 1
    )


def forty_five_sets(board: Board, cg: CandGrid) -> Optional[Hint]:
    """Use the 45-rule when it leaves several cells over rather than one.

    The leftover cells still have a known total, which is worth two things: if
    every one but a single cell has since been filled in, that cell is pinned
    after all; and while several are empty, what the others can reach bounds each
    one — the same squeeze ``cage_sum`` applies within a cage, applied to a group
    the cages don't draw.

    Last in the catalog. It is the hardest of these to see by hand, and offering
    it before a naked pair would be answering a question nobody asked.
    """
    if not board.cages:
        return None

    for label, span, total in _spans(board):
        for kind, cells, owed, held in _unaccounted(board, span, total):
            if not 2 <= len(cells) <= MAX_LEFTOVER:
                continue
            filled = [board.value(*cell) for cell in cells if board.value(*cell) is not None]
            empties = sorted(cell for cell in cells if cell in cg)
            if len(empties) + len(filled) != len(cells):
                continue  # a cell that is neither empty-with-candidates nor filled
            remaining = owed - sum(filled)
            where = f"{'inside' if kind == 'innie' else 'spilling out of'} {label}"

            if len(empties) == 1:
                cell = empties[0]
                if _forty_five_placement(cg, cell, remaining):
                    return Hint(
                        technique=f"45-rule ({kind} set)",
                        level=7,
                        action="place",
                        cells=[cell],
                        digits=[remaining],
                        units=[label],
                        explanation=(
                            f"The {len(cells)} cells {where} must total {owed}, "
                            f"and all but {cell_name(*cell)} are filled in — "
                            f"leaving {remaining} for it."
                        ),
                    )
                continue

            if not _all_distinct(empties):
                continue  # without distinctness the bound below would be unsound
            for cell in empties:
                squeezed = _squeezed_out(cell, empties, cg, remaining)
                if squeezed is None:
                    continue
                gone, why = squeezed
                return Hint(
                    technique=f"45-rule ({kind} set)",
                    level=7,
                    action="eliminate",
                    cells=[cell],
                    digits=gone,
                    units=[label],
                    explanation=(
                        f"{label} must total {total}, which leaves "
                        f"{_names(sorted(cells))} {where} to make {owed}"
                        + (f" — {remaining} once the filled ones are taken off" if filled else "")
                        + f". {why} — {', '.join(str(d) for d in gone)} cannot go "
                        f"there."
                    ),
                )
    return None


TECHNIQUES = [
    # First: the player's own notes must be right before anything derived from
    # them will make sense to them.
    impossible_pencil_mark,
    naked_single,
    hidden_single,
    cage_sum,
    forty_five_rule,
    naked_pair,
    naked_triple,
    hidden_pair,
    naked_quad,
    hidden_triple,
    pointing,
    claiming,
    x_wing,
    # Last: the hardest of these to see by hand, and it only ever fires when
    # everything simpler has already been exhausted.
    forty_five_sets,
]
