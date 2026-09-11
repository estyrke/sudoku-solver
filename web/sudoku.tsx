// Classic Sudoku tab: editable board, manual entry, screenshot import, hints
// and solving.
//
// Hinting and solving run the ported engine in the page (web/sudoku/*.ts); the
// only thing left that talks to the server is reading a screenshot.
//
// Browser APIs are reached through `window` (`window.fetch`, `window.FormData`,
// …) rather than as bare globals, so the jsdom page harness can substitute them
// per boot — see tests/ui/harness.js.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { PuzzleType } from "./app.tsx";
import { Grid } from "./ui/Grid.tsx";
import { PencilMarks } from "./ui/PencilMarks.tsx";
import { Numpad } from "./ui/Numpad.tsx";
import { ModeToggle } from "./ui/ModeToggle.tsx";
import { DropZone } from "./ui/DropZone.tsx";
import { HintPanel, NO_HINT, type HintView } from "./ui/HintPanel.tsx";
import { onSharedReading, type SharedReading } from "./ui/shared-reading.ts";
import { Board } from "./sudoku/model.ts";
import { findHint, hintToWire, nudge, type WireHint } from "./sudoku/hint.ts";
import { solve } from "./sudoku/solver.ts";

const N = 9;
const idx = (r: number, c: number) => r * N + c;
const rc = (i: number): [number, number] => [Math.floor(i / N), i % N];

/** A cell as the page holds it. */
interface Cell {
  value: number | null;
  is_given: boolean;
  pencil_marks: number[];
  low_confidence: boolean;
}

/** A cell as the server sends and receives it. */
interface WireCell {
  value: number | null;
  is_given?: boolean;
  pencil_marks?: number[];
  low_confidence?: boolean;
}

/** A hint plus the gentler thing the reveal ladder says before it. */
interface Reveal {
  nudge: string;
  hint: WireHint;
  level: number;
}

const emptyBoard = (): Cell[] =>
  Array.from({ length: N * N }, () => ({
    value: null,
    is_given: false,
    pencil_marks: [] as number[],
    low_confidence: false,
  }));

const toWire = (cells: Cell[]) => ({
  cells: cells.map((c) => ({
    value: c.value,
    is_given: c.is_given,
    pencil_marks: [...c.pencil_marks].sort(),
    low_confidence: c.low_confidence,
  })),
});

const fromWire = (wire: WireCell[]): Cell[] =>
  wire.map((c) => ({
    value: c.value ?? null,
    is_given: !!c.is_given,
    pencil_marks: c.pencil_marks || [],
    low_confidence: !!c.low_confidence,
  }));

function SudokuPanel({ active }: { active: boolean }) {
  const [cells, setCells] = useState(emptyBoard);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<"pen" | "pencil">("pen");
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [hint, setHint] = useState<HintView>(NO_HINT);
  const [result, setResult] = useState<string | null>(null);
  const [dropStatus, setDropStatus] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [canConfirm, setCanConfirm] = useState(false);
  const boardRef = useRef<HTMLElement | null>(null);

  const clearHint = useCallback(() => {
    setReveal(null);
    setHint(NO_HINT);
  }, []);

  // --- editing ------------------------------------------------------------
  const editCell = (i: number, change: (cell: Cell) => Cell) => {
    setCells((current) => {
      if (current[i].is_given) return current; // don't overwrite givens
      const next = current.slice();
      next[i] = change(current[i]);
      return next;
    });
    clearHint();
  };

  const inputDigit = (d: number) =>
    editCell(selected, (cell) => {
      if (mode === "pen") {
        return { ...cell, value: cell.value === d ? null : d, pencil_marks: [] };
      }
      if (cell.value) return cell;
      return {
        ...cell,
        pencil_marks: cell.pencil_marks.includes(d)
          ? cell.pencil_marks.filter((m) => m !== d)
          : [...cell.pencil_marks, d],
      };
    });

  const clearCell = () =>
    editCell(selected, (cell) => ({ ...cell, value: null, pencil_marks: [] }));

  const select = (i: number) => {
    setSelected(i);
    boardRef.current?.focus();
  };

  useEffect(() => {
    if (!active) return; // this tab isn't in front — don't steal input
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.matches("input")) return;
      const [r, c] = rc(selected);
      if (e.key >= "1" && e.key <= "9") inputDigit(Number(e.key));
      else if (e.key === "0" || e.key === "Backspace" || e.key === "Delete") clearCell();
      else if (e.key === "ArrowUp") select(idx((r + 8) % N, c));
      else if (e.key === "ArrowDown") select(idx((r + 1) % N, c));
      else if (e.key === "ArrowLeft") select(idx(r, (c + 8) % N));
      else if (e.key === "ArrowRight") select(idx(r, (c + 1) % N));
      else if (e.key === "p") setMode("pencil");
      else if (e.key === "n") setMode("pen");
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  });

  // --- solving ------------------------------------------------------------
  // Runs entirely in the browser: no /solve request (see web/sudoku/solver.ts).
  const doSolve = () => {
    const solved = solve(Board.fromWire(toWire(cells)));
    if (!solved) {
      setResult("No solution exists for this board.");
      return;
    }
    const wire = solved.toWire();
    setCells((current) =>
      current.map((cell, i) => ({ ...cell, value: wire.cells[i].value, pencil_marks: [] })),
    );
    setResult("Solved.");
    clearHint();
  };

  // --- hints --------------------------------------------------------------
  /**
   * Find and show a hint. Runs the ported engine in the page — no request.
   *
   * The refusals are worded exactly as the deleted `/hint` endpoint worded
   * them, and are checked in the same order: an invalid board first, then a
   * solved one, then a board no implemented technique can speak to.
   */
  const getHint = () => {
    const board = Board.fromWire(toWire(cells));
    const refuse = (reason: string) => {
      setReveal(null);
      setHint({ kind: "message", text: reason, warn: true });
    };

    if (!board.isValid()) {
      refuse("The board is invalid — a digit repeats in a unit.");
      return;
    }
    if (board.isSolved()) {
      refuse("This board is already solved. 🎉");
      return;
    }
    const found = findHint(board);
    if (found === null) {
      refuse(
        "No technique in the current set applies. The board may need a " +
          "more advanced strategy than is implemented yet.",
      );
      return;
    }
    showReveal({ nudge: nudge(found), hint: hintToWire(found), level: 1 });
  };

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

  const applyStep = () => {
    if (!reveal) return;
    const h = reveal.hint;
    setCells((current) => {
      const next = current.slice();
      if (h.action === "place") {
        const { r, c } = h.cells[0];
        next[idx(r, c)] = { ...next[idx(r, c)], value: h.digits[0], pencil_marks: [] };
      } else {
        for (const { r, c } of h.cells) {
          const cell = next[idx(r, c)];
          next[idx(r, c)] = {
            ...cell,
            pencil_marks: cell.pencil_marks.filter((m) => !h.digits.includes(m)),
          };
        }
      }
      return next;
    });
    clearHint();
  };

  // --- screenshot import --------------------------------------------------
  /** Put an already-parsed reading onto the board. Shared with the share target. */
  const applyParsed = (data: { board: { cells: WireCell[] } }) => {
    setCells(fromWire(data.board.cells));
    clearHint();
    setCanConfirm(true);
    const low = data.board.cells.filter((c) => c.low_confidence).length;
    setDropStatus(
      low
        ? `Read board — ${low} cell(s) flagged low-confidence (outlined red). Please check them.`
        : "Read board — please verify before requesting a hint.",
    );
  };

  const sendImage = async (file: File) => {
    setImageFile(file);
    setCanConfirm(false);
    setDropStatus("Reading board…");
    const fd = new window.FormData();
    fd.append("image", file);
    try {
      const res = await window.fetch("/parse", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setDropStatus(data.detail || data.reason || "Could not read the image.");
        return;
      }
      applyParsed(data);
    } catch (err) {
      setDropStatus("Upload failed: " + (err as Error).message);
    }
  };

  /**
   * Adopt a screenshot the share target has already read.
   *
   * The file is kept, not just the reading: "Confirm reading" teaches the digit
   * recognizer by re-extracting glyphs from the original image, so a shared
   * board would silently lose the ability to learn from corrections without it.
   */
  useEffect(
    () =>
      onSharedReading("sudoku", (file: File, data: SharedReading) => {
        setImageFile(file);
        applyParsed(data as { board: { cells: WireCell[] } });
      }),
    [],
  );

  const confirmReading = async () => {
    if (!imageFile) return;
    const fd = new window.FormData();
    fd.append("image", imageFile);
    fd.append("board", JSON.stringify(toWire(cells)));
    setDropStatus("Learning from your corrections…");
    try {
      const res = await window.fetch("/confirm", { method: "POST", body: fd });
      const data = await res.json();
      setDropStatus(
        data.ok
          ? `Thanks — learned ${data.learned} digit example(s). Future reads will improve.`
          : data.detail || "Could not learn from this board.",
      );
    } catch (err) {
      setDropStatus("Confirm failed: " + (err as Error).message);
    }
  };

  // --- rendering ----------------------------------------------------------
  const [sr, sc] = rc(selected);
  const targets = new Set(
    reveal && reveal.level >= 3 ? reveal.hint.cells.map(({ r, c }) => idx(r, c)) : [],
  );
  const hotDigits = reveal?.hint.action === "eliminate" ? reveal.hint.digits : [];

  const cellClass = (r: number, c: number) => {
    const i = idx(r, c);
    const cell = cells[i];
    const target = targets.has(i);
    const peer =
      i !== selected &&
      (r === sr ||
        c === sc ||
        (Math.floor(r / 3) === Math.floor(sr / 3) &&
          Math.floor(c / 3) === Math.floor(sc / 3)));
    return (
      "cell" +
      (i === selected ? " sel" : "") +
      (peer && !target ? " peer" : "") +
      (target ? " target" : "") +
      (cell.low_confidence ? " low" : "")
    );
  };

  return (
    <>
      <p class="sub">
        Paste or drop a screenshot, fix any misreads, then get the simplest next step.
      </p>

      <DropZone
        id="drop"
        inputId="file"
        statusId="dropStatus"
        prompt="Drop / paste a screenshot here"
        status={dropStatus}
        active={active}
        onFile={sendImage}
      />

      <div class="layout">
        <div class="board-wrap">
          <Grid
            id="board"
            className="board"
            size={N}
            tabIndex={0}
            elementRef={(el) => (boardRef.current = el)}
            cellClass={cellClass}
            cellProps={(r, c) => ({ onClick: () => select(idx(r, c)) })}
            cell={(r, c) => {
              const cell = cells[idx(r, c)];
              if (cell.value) {
                return (
                  <div class={"val " + (cell.is_given ? "given" : "pen")}>{cell.value}</div>
                );
              }
              if (cell.pencil_marks.length) {
                return (
                  <PencilMarks
                    marks={cell.pencil_marks}
                    hot={targets.has(idx(r, c)) ? hotDigits : []}
                  />
                );
              }
              return null;
            }}
          />

          <ModeToggle
            attr="mode"
            value={mode}
            options={[
              { value: "pen", label: "Pen" },
              { value: "pencil", label: "Pencil" },
            ]}
            onChange={setMode}
          >
            <span class="hintkeys">click a cell, type 1–9 · 0/⌫ clears</span>
          </ModeToggle>

          <Numpad
            id="numpad"
            clearId="numClear"
            value={cells[selected].value}
            marks={cells[selected].pencil_marks}
            onDigit={inputDigit}
            onClear={clearCell}
          />

          <div class="actions">
            <button id="getHint" type="button" class="primary" onClick={getHint}>
              Get hint
            </button>
            <button id="apply" type="button" disabled={!reveal} onClick={applyStep}>
              Apply step
            </button>
            <button id="solve" type="button" onClick={doSolve}>
              Solve
            </button>
            <button
              id="confirmRead"
              type="button"
              disabled={!canConfirm}
              title="Teach the reader from your corrections"
              onClick={confirmReading}
            >
              Confirm reading
            </button>
            <button
              id="clear"
              type="button"
              onClick={() => {
                setCells(emptyBoard());
                clearHint();
                setResult(null);
              }}
            >
              Clear board
            </button>
          </div>
        </div>

        <HintPanel
          hintId="hint"
          revealId="reveal"
          resultId="result"
          hint={hint}
          onReveal={(level) => reveal && showReveal({ ...reveal, level })}
          result={result}
        />
      </div>
    </>
  );
}

export const SudokuPuzzle: PuzzleType = {
  id: "sudoku",
  label: "Sudoku",
  Panel: SudokuPanel,
  acceptsShared: true,
};
