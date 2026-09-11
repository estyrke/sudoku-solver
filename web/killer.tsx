// Killer Sudoku tab: a classic 9x9 board plus cages.
//
// Two input modes, because painting cages and entering digits want different
// gestures on the same grid:
//
//   Cages  — drag across cells to select a group, then give it a sum. Clicking
//            an existing cage selects it for editing or deletion.
//   Digits — click a cell and type; Pen writes a value, Pencil toggles marks.
//
// Cage legality (2+ cells, orthogonally contiguous, reachable sum, no overlap)
// is enforced by the model, in `Cage`'s constructor; the checks here exist only
// to give immediate feedback while a cage is being painted, and to word it in
// terms of the gesture that just failed.
//
// Hinting, solving and the mistake audit all run in the page, against the same
// engine the Sudoku tab uses — Killer is part of that context, not a separate
// one (docs/adr/0002-killer-sudoku-extends-sudoku-context.md). The server is
// asked for nothing but screenshot reading.
//
// Browser APIs are reached through `window` (`window.fetch`, `window.FormData`,
// `window.prompt`, …) rather than as bare globals, so the jsdom page harness can
// substitute them per boot — see tests/ui/harness.js.

import { useEffect, useState } from "preact/hooks";
import type { PuzzleType } from "./app.tsx";
import { Grid } from "./ui/Grid.tsx";
import { PencilMarks } from "./ui/PencilMarks.tsx";
import { Numpad } from "./ui/Numpad.tsx";
import { ModeToggle } from "./ui/ModeToggle.tsx";
import { DropZone } from "./ui/DropZone.tsx";
import { HintPanel, NO_HINT, type HintView } from "./ui/HintPanel.tsx";
import {
  onSharedReading,
  onShareStatus,
  type SharedReading,
} from "./ui/shared-reading.ts";
import { Board, sumBounds } from "./sudoku/model.ts";
import { audit, auditToWire, type WireAudit } from "./sudoku/audit.ts";
import { findHint, hintToWire, nudge, type WireHint } from "./sudoku/hint.ts";
import { solve } from "./sudoku/solver.ts";

const N = 9;
const idx = (r: number, c: number) => r * N + c;

type Coord = [number, number];

/** A cell as the page holds it; marks are an array, in the order typed. */
interface KillerCell {
  value: number | null;
  marks: number[];
}

interface Cage {
  cells: Coord[];
  sum: number;
}

/** A hint the page is showing, with its gentlest reveal already worded. */
interface Reveal {
  nudge: string;
  hint: WireHint;
  level: number;
}

/** A reading of a Killer screenshot, from /killer/parse or the share target. */
interface ParsedReading {
  board: {
    cells: { value: number | null; pencil_marks?: number[] }[];
    cages?: { cells: { r: number; c: number }[]; sum: number }[];
  };
  unsure?: { r: number; c: number }[];
  fully_caged?: boolean;
  checksum_ok?: boolean;
  sum_total?: number;
  needs_review?: boolean;
}

const blankCells = (): KillerCell[] =>
  Array.from({ length: N * N }, () => ({ value: null, marks: [] as number[] }));

// ---- cage helpers --------------------------------------------------------

const key = (r: number, c: number) => `${r},${c}`;
const parseKey = (k: string): Coord => k.split(",").map(Number) as Coord;

const cageIndexAt = (cages: Cage[], r: number, c: number) =>
  cages.findIndex((cage) => cage.cells.some(([cr, cc]) => cr === r && cc === c));

function isContiguous(coords: Coord[]): boolean {
  if (coords.length === 0) return false;
  const want = new Set(coords.map(([r, c]) => key(r, c)));
  const seen = new Set([[...want][0]]);
  const stack: Coord[] = [parseKey([...want][0])];
  while (stack.length) {
    const [r, c] = stack.pop()!;
    for (const [nr, nc] of [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ] as Coord[]) {
      const k = key(nr, nc);
      if (want.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push([nr, nc]);
      }
    }
  }
  return seen.size === want.size;
}

function describeCageProblem(coords: Coord[], total: number): string | null {
  if (coords.length < 2) return "A cage needs at least 2 cells.";
  if (coords.length > 9) return "A cage cannot exceed 9 cells.";
  if (!isContiguous(coords))
    return "A cage's cells must touch edge-to-edge (diagonals don't count).";
  const [lo, hi] = sumBounds(coords.length);
  if (!(total >= lo && total <= hi))
    return `A ${coords.length}-cell cage must total between ${lo} and ${hi}.`;
  return null;
}

/** The cell a cage prints its sum in: topmost row, then leftmost column. */
const cageAnchor = (cage: Cage): Coord =>
  cage.cells.reduce((best, cur) =>
    cur[0] < best[0] || (cur[0] === best[0] && cur[1] < best[1]) ? cur : best,
  );

// Every unit holds 1-9 exactly once, so a board fully covered by cages has
// sums totalling 9 x 45. Shown live: the reader's own check goes stale the
// moment a sum is corrected by hand, which is exactly when it's needed.
const UNIT_TOTAL = 45;
const FULL_TOTAL = UNIT_TOTAL * N;

function totalsLine(cages: Cage[]): { text: string; state: string } {
  if (!cages.length) return { text: "", state: "" };
  const covered = cages.reduce((n, cage) => n + cage.cells.length, 0);
  const total = cages.reduce((n, cage) => n + cage.sum, 0);
  const bits = [
    `${cages.length} cage${cages.length === 1 ? "" : "s"}`,
    `${covered}/${N * N} cells`,
    `sums total ${total}`,
  ];
  let state = "";
  if (covered < N * N) {
    bits.push(`${FULL_TOTAL - total} left to account for`);
  } else if (total === FULL_TOTAL) {
    bits.push("matches 405 ✓");
    state = " ok";
  } else {
    const off = total - FULL_TOTAL;
    bits.push(`should be ${FULL_TOTAL} — ${Math.abs(off)} too ${off > 0 ? "high" : "low"}`);
    state = " bad";
  }
  return { text: bits.join(" · "), state };
}

const CAGES_HELP = "Drag across empty cells to make a cage; click a cage to edit it.";
const DIGITS_HELP = "Click a cell, then type 1–9. 0 or ⌫ clears.";

function KillerPanel({ active }: { active: boolean }) {
  const [cells, setCells] = useState(blankCells);
  const [cages, setCages] = useState<Cage[]>([]);
  const [mode, setMode] = useState<"cages" | "digits">("cages");
  const [pen, setPen] = useState<"pen" | "pencil">("pen");
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);
  /** Index into `cages`, while in cages mode. */
  const [selectedCage, setSelectedCage] = useState<number | null>(null);
  /** The "r,c" keys under the cage being painted right now. */
  const [dragging, setDragging] = useState<Set<string> | null>(null);
  /** Cage anchors whose sum the reader flagged as doubtful. */
  const [unsure, setUnsure] = useState<Set<string>>(new Set());
  /** "r,c" keys the last audit called wrong. */
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [hint, setHint] = useState<HintView>(NO_HINT);
  const [result, setResult] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({
    text: CAGES_HELP,
  });
  const [dropStatus, setDropStatus] = useState<{ text: string; error?: boolean }>({
    text: "",
  });
  const [sumText, setSumText] = useState("");

  const clearHint = () => {
    setReveal(null);
    setHint(NO_HINT);
    setMistakes([]);
  };

  const reset = () => {
    setCells(blankCells());
    setCages([]);
    setSelected(null);
    setSelectedCage(null);
    setUnsure(new Set());
  };

  // ---- cage painting -----------------------------------------------------
  const beginDrag = (r: number, c: number, ev: Event) => {
    if (mode !== "cages") return;
    ev.preventDefault();
    // Clicking inside an existing cage selects it rather than starting a paint.
    const existing = cageIndexAt(cages, r, c);
    if (existing >= 0) {
      setSelectedCage(existing);
      setSumText(String(cages[existing].sum));
      setDragging(null);
      return;
    }
    setSelectedCage(null);
    setDragging(new Set([key(r, c)]));
  };

  const extendDrag = (r: number, c: number) => {
    setDragging((current) => {
      if (!current) return current;
      if (cageIndexAt(cages, r, c) >= 0) return current; // don't paint over a cage
      if (current.has(key(r, c))) return current;
      return new Set(current).add(key(r, c));
    });
  };

  const endDrag = () => {
    if (!dragging) return;
    const painted = dragging;
    setDragging(null);
    const coords = [...painted].map(parseKey);
    if (coords.length < 2) {
      setStatus({ text: "A cage needs at least 2 cells.", error: true });
      return;
    }
    if (!isContiguous(coords)) {
      setStatus({
        text: "Those cells aren't connected edge-to-edge — cage not created.",
        error: true,
      });
      return;
    }
    const [lo, hi] = sumBounds(coords.length);
    const raw = window.prompt(`Sum for this ${coords.length}-cell cage (${lo}–${hi}):`);
    if (raw == null) return;
    const total = Number(raw);
    const problem = describeCageProblem(coords, total);
    if (problem) {
      setStatus({ text: problem, error: true });
      return;
    }
    setSelectedCage(cages.length);
    setCages([...cages, { cells: coords, sum: total }]);
    setSumText(String(total));
    setStatus({ text: `Cage added (${coords.length} cells, sum ${total}).` });
  };

  // Re-registered every render on purpose (no dependency list): a drag ends on
  // the document, not on a cell, and the handler has to see the cells the drag
  // has painted so far rather than the ones it started with.
  useEffect(() => {
    const up = () => endDrag();
    document.addEventListener("mouseup", up);
    return () => document.removeEventListener("mouseup", up);
  });

  // ---- digit entry -------------------------------------------------------
  const setDigit = (d: number) => {
    if (mode !== "digits" || !selected) return;
    const i = idx(selected.r, selected.c);
    setCells((current) => {
      const cell = current[i];
      const next = current.slice();
      if (pen === "pen") {
        next[i] = { value: cell.value === d ? null : d, marks: [] };
      } else {
        if (cell.value != null) return current;
        next[i] = {
          ...cell,
          marks: cell.marks.includes(d)
            ? cell.marks.filter((m) => m !== d)
            : [...cell.marks, d],
        };
      }
      return next;
    });
    clearHint();
  };

  const clearCell = () => {
    if (mode !== "digits" || !selected) return;
    const i = idx(selected.r, selected.c);
    setCells((current) => {
      const next = current.slice();
      next[i] = { value: null, marks: [] };
      return next;
    });
    clearHint();
  };

  useEffect(() => {
    if (!active || mode !== "digits" || !selected) return;
    const onKeydown = (ev: KeyboardEvent) => {
      if (ev.key >= "1" && ev.key <= "9") setDigit(Number(ev.key));
      else if (ev.key === "0" || ev.key === "Backspace" || ev.key === "Delete") clearCell();
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  });

  // ---- the engine --------------------------------------------------------
  /**
   * The page's board as the engine's Board, cages and all.
   *
   * Throws when the cages break a rule the painting checks let through — the
   * model is the source of truth for that, and its wording is what the player
   * used to see come back from the server.
   */
  const toBoard = (): Board =>
    Board.fromWire({
      cells: cells.map((cell) => ({
        value: cell.value,
        is_given: false,
        pencil_marks: cell.marks.slice().sort(),
        low_confidence: false,
      })),
      cages: cages.map((cage) => ({
        cells: cage.cells.map(([r, c]) => ({ r, c })),
        sum: cage.sum,
      })),
    });

  // Runs entirely in the browser: no /killer/solve request.
  //
  // An unsolvable board is audited rather than blamed on the cages. "No
  // solution exists — check the cage sums" was the old answer, and it sent
  // people to the cages when the culprit was usually a digit they had entered;
  // the audit says which.
  const doSolve = () => {
    // No "Solving…" placeholder: the solve is synchronous, so the browser never
    // gets a frame in which to paint one. (queens.tsx still has one; it is
    // still awaiting a response.)
    try {
      const board = toBoard();
      const solved = solve(board);
      if (solved === null) {
        setResult(audit(board).message);
        return;
      }
      setCells(solved.cells.map((cell) => ({ value: cell.value, marks: [] })));
      setResult("Solved.");
    } catch (err) {
      setResult((err as Error).message);
    }
  };

  // ---- hints -------------------------------------------------------------
  //
  // Killer hints are the ones that most need their reasoning shown: "look at
  // the 32-cage at r4c8" is not something a player can act on, and unlike a
  // classic single they usually can't reconstruct the argument themselves.
  // Same three levels as the other two tabs, so nobody is forced past a nudge.

  const showReveal = (next: Reveal) => {
    setReveal(next);
    setHint({
      kind: "reveal",
      level: next.level,
      nudge: next.nudge,
      technique: next.hint.technique,
      explanation: next.hint.explanation,
    });
  };

  /**
   * Find and show a hint, running the ported engine in the page — no request.
   *
   * The board is audited *before* it is hinted, and a real mistake gets the
   * audit's message instead of a hint: a hint deduced from a wrong entry, or in
   * a world where a needed pencil mark has been rubbed out, is worse than no
   * hint because it looks authoritative and sends the player further off.
   * "incomplete" is not a mistake — just a board still being drawn — so it
   * blocks nothing.
   */
  const doHint = () => {
    const refuse = (reason: string, report?: WireAudit) => {
      setReveal(null);
      setHint({ kind: "message", text: reason });
      // A mistake report names cells; point at them the way a hint does, since
      // "r1c1 is wrong" is only useful once you've found r1c1.
      setMistakes((report?.cells ?? []).map((m) => key(m.r, m.c)));
    };

    let board: Board;
    try {
      board = toBoard();
    } catch (err) {
      refuse((err as Error).message);
      return;
    }

    if (board.isSolved()) {
      refuse("This board is already solved. 🎉");
      return;
    }

    const report = audit(board);
    if (!report.clean && report.verdict !== "incomplete") {
      refuse(report.message, auditToWire(report));
      return;
    }

    const found = findHint(board);
    if (found === null) {
      refuse(
        "No mistakes on the board — this one needs a technique that isn't implemented yet.",
      );
      return;
    }

    setMistakes([]);
    showReveal({ nudge: nudge(found), hint: hintToWire(found), level: 1 });
  };

  // ---- screenshot import -------------------------------------------------
  /**
   * Put an already-parsed reading onto the board.
   *
   * Shared with the Android share sheet, which has the payload in hand before
   * the tab is even in front. Every warning below — uncaged cells, doubtful
   * sums, the 405 checksum — matters just as much when the picture came from
   * the share sheet as when it was dropped here.
   */
  const applyParsed = (data: ParsedReading) => {
    const loadedCages = (data.board.cages || []).map((cage) => ({
      cells: cage.cells.map((cell) => [cell.r, cell.c] as Coord),
      sum: cage.sum,
    }));
    const doubtful = new Set((data.unsure || []).map((u) => key(u.r, u.c)));
    setCages(loadedCages);
    setCells(
      data.board.cells.map((cell) => ({
        value: cell.value,
        marks: cell.pencil_marks || [],
      })),
    );
    setUnsure(doubtful);
    setSelected(null);
    setSelectedCage(null);
    clearHint();

    const notes = [`Read ${loadedCages.length} cages.`];
    if (!data.fully_caged) notes.push("Some cells aren't in a cage — check the outlines.");
    if (doubtful.size)
      notes.push(`${doubtful.size} cage sum(s) look doubtful (highlighted).`);
    // Cage sums must total 45 per unit. A mismatch means a sum was misread even
    // when every individual read looked confident.
    if (data.fully_caged && !data.checksum_ok) {
      notes.push(
        `Cage sums total ${data.sum_total}, but a full board must total 405 — ` +
          `at least one sum is wrong.`,
      );
    }
    setDropStatus({ text: notes.join(" "), error: !!data.needs_review });
    setStatus({
      text: doubtful.size
        ? "Click a highlighted cage to correct its sum."
        : "Board read. Check it over, then solve.",
    });
  };

  const importImage = async (file: File) => {
    setDropStatus({ text: "Reading…" });
    const body = new window.FormData();
    body.append("image", file);
    try {
      const res = await window.fetch("/killer/parse", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDropStatus({
          text: data.detail || `Could not read that image (${res.status}).`,
          error: true,
        });
        return;
      }
      applyParsed(data);
    } catch (err) {
      setDropStatus({ text: (err as Error).message, error: true });
    }
  };

  // The share handoff talks to this tab twice: once with its own progress line
  // (it is the tab the shared screenshot lands in), then with the reading.
  useEffect(() => onShareStatus((text, error) => setDropStatus({ text, error })), []);
  useEffect(
    () =>
      onSharedReading("killer", (_file: File, data: SharedReading) =>
        applyParsed(data as ParsedReading),
      ),
    [],
  );

  // ---- rendering ---------------------------------------------------------
  const targets = new Set(
    reveal && reveal.level >= 3 ? reveal.hint.cells.map(({ r, c }) => idx(r, c)) : [],
  );
  // At full reveal, point at the cells on the board too — a cage is named by
  // its anchor, and finding r4c8 by counting rows is its own small chore.
  const hotDigits =
    reveal && reveal.level >= 3 && reveal.hint.action === "eliminate"
      ? reveal.hint.digits
      : [];
  const totals = totalsLine(cages);
  const activeCage = selectedCage != null ? cages[selectedCage] : null;

  const cellClass = (r: number, c: number) => {
    const ci = cageIndexAt(cages, r, c);
    let cls = "cell kcell";
    if (ci < 0) cls += " uncaged";
    else {
      if (ci === selectedCage) cls += " cage-selected";
      if (unsure.has(key(...cageAnchor(cages[ci])))) cls += " cage-unsure";
    }
    if (mistakes.includes(key(r, c))) cls += " mistake";
    if (dragging?.has(key(r, c))) cls += " dragging";
    if (mode === "digits" && selected?.r === r && selected?.c === c) cls += " sel";
    if (targets.has(idx(r, c))) cls += " target";
    return cls;
  };

  const cageDecoration = (r: number, c: number) => {
    const ci = cageIndexAt(cages, r, c);
    if (ci < 0) return null;
    const cage = cages[ci];
    const inCage = (rr: number, cc: number) =>
      cage.cells.some(([a, b]) => a === rr && b === cc);
    // Dash only the edges that leave the cage, so a cage reads as one outline.
    // All four live on one overlay element: separate ::before/::after
    // pseudo-elements would collide on cells needing two adjacent edges. On the
    // sides where the cage continues, stretch the overlay to the cell edge
    // instead — otherwise every cell insets its outline, the dashes break at
    // each internal junction, and one cage reads as a row of separate boxes.
    const edges = (
      [
        ["t", r - 1, c],
        ["b", r + 1, c],
        ["l", r, c - 1],
        ["r", r, c + 1],
      ] as [string, number, number][]
    ).map(([side, rr, cc]) => (inCage(rr, cc) ? `x-${side}` : side));
    const [ar, ac] = cageAnchor(cage);
    return (
      <>
        <div class={"cage-edge " + edges.join(" ")} />
        {ar === r && ac === c && <span class="cage-sum">{cage.sum}</span>}
      </>
    );
  };

  return (
    <>
      <p class="sub">
        Drop a screenshot, or drag out the cages and give each one its sum, then fill in
        digits or solve.
      </p>

      <DropZone
        id="kDrop"
        inputId="kFile"
        statusId="kDropStatus"
        prompt="Drop / paste a Killer screenshot here"
        status={dropStatus.text}
        error={dropStatus.error}
        active={active}
        onFile={importImage}
      />

      <div id="kStatus" class={"status" + (status.error ? " error" : "")}>
        {status.text}
      </div>
      <div id="kTotals" class={"totals" + totals.state}>
        {totals.text}
      </div>

      <div class="layout">
        <div class="board-wrap">
          <Grid
            id="kBoard"
            className="board kboard"
            size={N}
            cellClass={cellClass}
            cellProps={(r, c) => ({
              onMouseDown: (ev: Event) => beginDrag(r, c, ev),
              onMouseOver: () => extendDrag(r, c),
              onClick: () => mode === "digits" && setSelected({ r, c }),
            })}
            cell={(r, c) => {
              const cell = cells[idx(r, c)];
              return (
                <>
                  {cageDecoration(r, c)}
                  {cell.value != null ? (
                    <span class="val">{cell.value}</span>
                  ) : cell.marks.length ? (
                    <PencilMarks
                      marks={cell.marks}
                      hot={targets.has(idx(r, c)) ? hotDigits : []}
                    />
                  ) : null}
                </>
              );
            }}
          />

          {/* Right under the board and above the numpad — same reach as the
              digit buttons, since these get tapped just as often while working
              the board. */}
          <ModeToggle
            attr="kmode"
            className="kcontrols"
            value={mode}
            options={[
              { value: "cages", label: "Cages" },
              { value: "digits", label: "Digits" },
            ]}
            onChange={(next) => {
              setMode(next);
              setSelected(null);
              setSelectedCage(null);
              setStatus({ text: next === "cages" ? CAGES_HELP : DIGITS_HELP });
            }}
          >
            <button
              id="kClear"
              type="button"
              onClick={() => {
                reset();
                setStatus({ text: "Board cleared." });
                setResult(null);
                clearHint();
              }}
            >
              Clear board
            </button>
          </ModeToggle>

          <ModeToggle
            id="kDigitControls"
            attr="kpen"
            className="kcontrols"
            hidden={mode !== "digits"}
            value={pen}
            options={[
              { value: "pen", label: "Pen" },
              { value: "pencil", label: "Pencil" },
            ]}
            onChange={setPen}
          />

          <div id="kSumRow" class="kcontrols" hidden={!activeCage}>
            <span id="kSumLabel">
              {activeCage ? `Cage of ${activeCage.cells.length} cells` : ""}
            </span>
            <label>
              Sum{" "}
              <input
                id="kSumInput"
                type="number"
                min="3"
                max="45"
                value={sumText}
                onInput={(e) => setSumText((e.target as HTMLInputElement).value)}
                onChange={(e) => {
                  if (selectedCage == null) return;
                  const cage = cages[selectedCage];
                  // Read the field rather than `sumText`: a sum can also be set
                  // by something that never typed into it.
                  const total = Number((e.target as HTMLInputElement).value);
                  const problem = describeCageProblem(cage.cells, total);
                  if (problem) {
                    setStatus({ text: problem, error: true });
                    setSumText(String(cage.sum));
                    return;
                  }
                  setCages((current) =>
                    current.map((c, i) => (i === selectedCage ? { ...c, sum: total } : c)),
                  );
                  setUnsure((current) => {
                    const next = new Set(current);
                    next.delete(key(...cageAnchor(cage)));
                    return next;
                  });
                  setStatus({ text: `Cage sum updated to ${total}.` });
                  clearHint();
                }}
              />
            </label>
            <button
              id="kDeleteCage"
              type="button"
              onClick={() => {
                if (selectedCage == null) return;
                // Clear the selection first: an index into the old array is
                // out of bounds the instant the shorter one renders.
                setSelectedCage(null);
                setCages((current) => current.filter((_, i) => i !== selectedCage));
                setStatus({ text: "Cage deleted." });
                clearHint();
              }}
            >
              Delete cage
            </button>
          </div>

          <Numpad
            id="kNumpad"
            clearId="kNumClear"
            value={mode === "digits" && selected ? cells[idx(selected.r, selected.c)].value : null}
            marks={mode === "digits" && selected ? cells[idx(selected.r, selected.c)].marks : []}
            onDigit={setDigit}
            onClear={clearCell}
          />

          <div class="actions">
            <button id="kGetHint" type="button" class="primary" onClick={doHint}>
              Get hint
            </button>
            <button id="kSolve" type="button" onClick={doSolve}>
              Solve
            </button>
          </div>
        </div>

        <HintPanel
          hintId="kHint"
          revealId="kReveal"
          resultId="kResult"
          hint={hint}
          onReveal={(level) => reveal && showReveal({ ...reveal, level })}
          result={result}
        />
      </div>
    </>
  );
}

export const KillerPuzzle: PuzzleType = {
  id: "killer",
  label: "Killer",
  Panel: KillerPanel,
  acceptsShared: true,
};
