// Queens tab: manual entry (region painting, mark/queen gestures), hinting and
// backtracking solve.
//
// Hinting and solving run entirely in the browser against web/queens/ — no
// request — the same way the two Sudoku tabs run web/sudoku/. The two engines
// share no model, Hint type or reveal code (see
// docs/adr/0001-sudoku-and-queens-as-separate-contexts.md).
//
// Browser APIs are reached through `window` (`window.setTimeout`, …) rather
// than as bare globals, so the jsdom page harness can substitute them per boot.

import { useEffect, useRef, useState } from "preact/hooks";
import type { PuzzleType } from "./app.tsx";
import { Grid } from "./ui/Grid.tsx";
import { HintPanel, NO_HINT, type HintView } from "./ui/HintPanel.tsx";
import { Board, type Cell as QueensCell } from "./queens/model.ts";
import { findHint, hintToWire, nudge, type WireHint } from "./queens/hint.ts";
import { solve } from "./queens/solver.ts";

const DEFAULT_N = 8;
const CLICK_DEBOUNCE_MS = 200; // let a dblclick cancel the leading click first
const PALETTE_POOL = [
  "#fda4af", "#fdba74", "#fde047", "#bef264",
  "#5eead4", "#93c5fd", "#c4b5fd", "#f0abfc",
];

type CellState = QueensCell["state"];

/** A found hint plus how much of it is on show. */
interface Reveal {
  nudge: string;
  hint: WireHint;
  level: number;
}

// Unpainted cells default to region: null (never inferred, never region 0 —
// see web/queens/model.ts's Cell docstring for why null is the sentinel).
const emptyBoard = (size: number): QueensCell[] =>
  Array.from({ length: size * size }, () => ({ state: "empty" as CellState, region: null }));

function colorForRegion(id: number): string {
  if (id < PALETTE_POOL.length) return PALETTE_POOL[id];
  // Beyond the built-in pool (boards can have more regions than we ship
  // swatches for), spread further hues out using the golden angle.
  return `hsl(${(id * 137.508) % 360}, 65%, 72%)`;
}

function QueensPanel(_: { active: boolean }) {
  // N and the cells are one fact, not two: a board of a given size *is* that
  // many cells. Held apart, a resize renders one before the other and the grid
  // asks a 10x10 loop for cells an 8x8 array does not have.
  const [board, setBoard] = useState(() => ({
    n: DEFAULT_N,
    cells: emptyBoard(DEFAULT_N),
  }));
  const { n, cells } = board;
  const [sizeText, setSizeText] = useState(String(DEFAULT_N));
  /** How many swatches are on offer; region ids run 0..regionCount-1. */
  const [regionCount, setRegionCount] = useState(1);
  const [tool, setTool] = useState<"cursor" | "paint">("cursor");
  const [activeRegion, setActiveRegion] = useState(0);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [hint, setHint] = useState<HintView>(NO_HINT);
  const [result, setResult] = useState<{ text: string; warn?: boolean } | null>(null);

  const painting = useRef(false);
  /** A single click waiting to see whether a dblclick follows it. */
  const pendingClick = useRef<number | null>(null);

  useEffect(() => {
    const up = () => (painting.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const clearHint = () => {
    setReveal(null);
    setHint(NO_HINT);
  };

  const setCells = (change: (cells: QueensCell[]) => QueensCell[]) =>
    setBoard((current) => ({ ...current, cells: change(current.cells) }));

  const setCell = (i: number, change: (cell: QueensCell) => QueensCell) =>
    setCells((current) => {
      const next = current.slice();
      next[i] = change(current[i]);
      return next;
    });

  // --- painting -----------------------------------------------------------
  const paintCell = (i: number) => {
    if (tool !== "paint") return;
    if (cells[i].region === activeRegion) return;
    setCell(i, (cell) => ({ ...cell, region: activeRegion }));
    clearHint();
  };

  // --- mark/queen gestures ------------------------------------------------
  const cancelPendingClick = () => {
    if (pendingClick.current !== null) {
      window.clearTimeout(pendingClick.current);
      pendingClick.current = null;
    }
  };

  const onCellClick = (i: number) => {
    if (tool !== "cursor") return;
    cancelPendingClick();
    pendingClick.current = window.setTimeout(() => {
      pendingClick.current = null;
      setCell(i, (cell) => ({ ...cell, state: cell.state === "empty" ? "marked" : "empty" }));
      setResult(null);
      clearHint();
    }, CLICK_DEBOUNCE_MS);
  };

  const onCellDblClick = (i: number) => {
    if (tool !== "cursor") return;
    cancelPendingClick();
    setCell(i, (cell) => ({ ...cell, state: cell.state === "queen" ? "empty" : "queen" }));
    setResult(null);
    clearHint();
  };

  // --- board lifecycle ----------------------------------------------------
  /** Same N or a new one, but always a full reset: a "clear" wipes the manual
   *  entry entirely, palette included, not just the marks and queens. */
  const resetTo = (size: number) => {
    setBoard({ n: size, cells: emptyBoard(size) });
    setSizeText(String(size));
    setRegionCount(1);
    setActiveRegion(0);
    setTool("cursor");
    setResult(null);
    clearHint();
  };

  const newBoard = () => {
    const requested = Number(sizeText) || DEFAULT_N;
    resetTo(Math.max(1, Math.min(16, Math.round(requested))));
  };

  const loadSolvedBoard = (solved: Board) => {
    const loaded = solved.toWire().cells;
    setCells(() => loaded);
    // The solved board can't introduce new region ids, but keep the palette at
    // least as wide as whatever regions are actually present.
    const maxRegion = loaded.reduce((m, c) => Math.max(m, c.region ?? -1), -1);
    setRegionCount((count) => Math.max(count, maxRegion + 1));
    clearHint();
  };

  // --- solve --------------------------------------------------------------
  // Runs entirely in the browser: no /queens/solve request.
  const engineBoard = () => Board.fromWire({ n, cells });

  const solveBoard = () => {
    const solved = solve(engineBoard());
    if (solved === null) {
      setResult({ text: "No solution exists for this board.", warn: true });
      return;
    }
    loadSolvedBoard(solved);
    setResult({ text: "Solved!" });
  };

  // --- hints --------------------------------------------------------------
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
   * Find and show a hint. Runs the ported engine in the page — no request.
   *
   * The refusals are worded exactly as the deleted `/queens/hint` endpoint
   * worded them, and are checked in the same order: an invalid board first,
   * then a solved one, then a board no implemented technique can speak to.
   */
  const getHint = () => {
    const current = engineBoard();
    const refuse = (reason: string) => {
      setReveal(null);
      setHint({ kind: "message", text: reason, warn: true });
    };

    if (!current.isValid()) {
      refuse(
        "The board is invalid — two queens share a row, column, " +
          "or region, or sit adjacent to each other.",
      );
      return;
    }
    if (current.isSolved()) {
      refuse("This board is already solved. 🎉");
      return;
    }
    const found = findHint(current);
    if (found === null) {
      refuse(
        "No technique in the current set applies. The board may need a " +
          "more advanced strategy than is implemented yet.",
      );
      return;
    }
    showReveal({ nudge: nudge(found), hint: hintToWire(found), level: 1 });
  };

  const applyStep = () => {
    if (!reveal) return;
    const h = reveal.hint;
    const idx = (r: number, c: number) => r * n + c;
    setCells((current) => {
      const next = current.slice();
      if (h.action === "place") {
        const { r, c } = h.cells[0];
        next[idx(r, c)] = { ...next[idx(r, c)], state: "queen" };
      } else {
        // Elimination hints (issues #7/#8): the ruled-out cells become Marks,
        // same as a player manually ruling them out.
        for (const { r, c } of h.cells) {
          next[idx(r, c)] = { ...next[idx(r, c)], state: "marked" };
        }
      }
      return next;
    });
    setResult(null);
    clearHint();
  };

  // --- rendering ----------------------------------------------------------
  // Full reveal highlights the hint's target cells, the same way Sudoku does.
  const targets = new Set(
    reveal && reveal.level >= 3 ? reveal.hint.cells.map(({ r, c }) => r * n + c) : [],
  );

  return (
    <>
      <p class="sub">
        Set the board size, paint regions with the palette, place marks/queens, then solve.
      </p>

      <div class="qcontrols">
        <label>
          Size N{" "}
          <input
            id="qSize"
            type="number"
            min="3"
            max="16"
            value={sizeText}
            onInput={(e) => setSizeText((e.target as HTMLInputElement).value)}
          />
        </label>
        <button id="qNew" type="button" onClick={newBoard}>
          New board
        </button>
        <button id="qClear" type="button" onClick={() => resetTo(n)}>
          Clear board
        </button>
      </div>

      <div id="qPalette" class="palette">
        <button
          type="button"
          class={"swatch cursor" + (tool === "cursor" ? " active" : "")}
          title="Mark / Queen tool"
          onClick={() => setTool("cursor")}
        >
          ✎
        </button>
        {Array.from({ length: regionCount }, (_, i) => (
          <button
            key={i}
            type="button"
            class={"swatch" + (tool === "paint" && activeRegion === i ? " active" : "")}
            style={{ background: colorForRegion(i) }}
            title={`Region ${i + 1}`}
            onClick={() => {
              setTool("paint");
              setActiveRegion(i);
            }}
          />
        ))}
        <button
          type="button"
          class="swatch add"
          title="Add a region color"
          onClick={() => {
            setTool("paint");
            setActiveRegion(regionCount);
            setRegionCount(regionCount + 1);
          }}
        >
          +
        </button>
      </div>

      <div class="layout">
        <div class="board-wrap">
          <Grid
            id="qBoard"
            className="qboard"
            size={n}
            style={{
              "--n": String(n),
              gridTemplateColumns: `repeat(${n}, var(--cell))`,
              gridTemplateRows: `repeat(${n}, var(--cell))`,
            }}
            cellClass={(r, c) => "qcell" + (targets.has(r * n + c) ? " target" : "")}
            cellProps={(r, c) => {
              const i = r * n + c;
              return {
                style: {
                  background: cells[i].region === null ? "" : colorForRegion(cells[i].region!),
                },
                onMouseDown: () => {
                  if (tool !== "paint") return;
                  painting.current = true;
                  paintCell(i);
                },
                onMouseEnter: () => painting.current && paintCell(i),
                onClick: () => onCellClick(i),
                onDblClick: () => onCellDblClick(i),
              };
            }}
            cell={(r, c) => {
              const { state } = cells[r * n + c];
              if (state === "queen") return <div class="qmark queen">♛</div>;
              if (state === "marked") return <div class="qmark mark">✕</div>;
              return null;
            }}
          />
          <div class="actions">
            <button id="qGetHint" type="button" class="primary" onClick={getHint}>
              Get hint
            </button>
            <button id="qApply" type="button" disabled={!reveal} onClick={applyStep}>
              Apply step
            </button>
            <button id="qSolve" type="button" onClick={solveBoard}>
              Solve
            </button>
          </div>
        </div>

        <HintPanel
          hintId="qHint"
          revealId="qReveal"
          resultId="qResult"
          hint={hint}
          onReveal={(level) => reveal && showReveal({ ...reveal, level })}
          result={result?.text ?? null}
          resultWarn={result?.warn}
        />
      </div>
    </>
  );
}

export const QueensPuzzle: PuzzleType = {
  id: "queens",
  label: "Queens",
  Panel: QueensPanel,
};
