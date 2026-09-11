// Queens tab: manual entry (region painting, mark/queen gestures) and
// backtracking solve.
//
// Unlike the two Sudoku tabs, this one still asks the server to solve and to
// hint — the Queens engine has not been ported to the browser.
//
// Browser APIs are reached through `window` (`window.fetch`, …) rather than as
// bare globals, so the jsdom page harness can substitute them per boot.

import { useEffect, useRef, useState } from "preact/hooks";
import type { PuzzleType } from "./app.tsx";
import { Grid } from "./ui/Grid.tsx";
import { HintPanel, NO_HINT, type HintView } from "./ui/HintPanel.tsx";

const DEFAULT_N = 8;
const CLICK_DEBOUNCE_MS = 200; // let a dblclick cancel the leading click first
const PALETTE_POOL = [
  "#fda4af", "#fdba74", "#fde047", "#bef264",
  "#5eead4", "#93c5fd", "#c4b5fd", "#f0abfc",
];

type CellState = "empty" | "marked" | "queen";

interface QueensCell {
  state: CellState;
  region: number | null;
}

interface Hint {
  action: "place" | "eliminate";
  cells: { r: number; c: number }[];
  explanation: string;
}

/** The /queens/hint reply, once it is known to be a hint rather than a refusal. */
interface HintReply {
  ok: true;
  nudge: string;
  technique: string;
  hint: Hint;
}

// Unpainted cells default to region: null (never inferred, never region 0 —
// see queens/model.py's Cell docstring for why null is the sentinel).
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
  const [reveal, setReveal] = useState<(HintReply & { level: number }) | null>(null);
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

  const loadSolvedBoard = (data: { cells: QueensCell[] }) => {
    const loaded = data.cells.map((c) => ({ state: c.state, region: c.region }));
    setCells(() => loaded);
    // The solved board can't introduce new region ids, but keep the palette at
    // least as wide as whatever regions are actually present.
    const maxRegion = loaded.reduce((m, c) => Math.max(m, c.region ?? -1), -1);
    setRegionCount((count) => Math.max(count, maxRegion + 1));
    clearHint();
  };

  // --- solve --------------------------------------------------------------
  const payload = () => ({ n, cells: cells.map((c) => ({ state: c.state, region: c.region })) });

  const solveBoard = async () => {
    setResult({ text: "Solving…" });
    try {
      const res = await window.fetch("/queens/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      const data = await res.json();
      if (!data.ok) {
        setResult({ text: data.reason, warn: true });
        return;
      }
      loadSolvedBoard(data.board);
      setResult({ text: "Solved!" });
    } catch (err) {
      setResult({ text: "Solve failed: " + (err as Error).message, warn: true });
    }
  };

  // --- hints --------------------------------------------------------------
  const showReveal = (next: HintReply & { level: number }) => {
    setReveal(next);
    setHint({
      kind: "reveal",
      level: next.level,
      nudge: next.nudge,
      technique: next.technique,
      explanation: next.hint.explanation,
    });
  };

  const getHint = async () => {
    const refuse = (reason: string) => {
      setReveal(null);
      setHint({ kind: "message", text: reason, warn: true });
    };
    let data;
    try {
      const res = await window.fetch("/queens/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      data = await res.json();
    } catch (err) {
      refuse("Hint request failed: " + (err as Error).message);
      return;
    }
    if (!data.ok) {
      refuse(data.reason);
      return;
    }
    showReveal({ ...(data as HintReply), level: 1 });
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
