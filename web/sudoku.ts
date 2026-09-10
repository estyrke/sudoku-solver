// Sudoku Helper front-end: editable board, manual entry, image parse, hint reveal.
//
// Hinting and solving run the ported engine in the page (web/sudoku/*.ts); the
// only thing left that talks to the server is reading a screenshot.
//
// Registers itself with the puzzle-type shell (see shell.ts) and mounts its
// UI into the container the shell hands it. All state below is module-level
// (private to this module) so it lives for the lifetime of the page — the
// shell only ever hides/shows the panel, never destroys it, which is what
// keeps this tab's board state intact across tab switches.
//
// Browser APIs are reached through `window` (`window.fetch`, `window.FormData`,
// `window.prompt`, …) rather than as bare globals, so the jsdom page harness can
// substitute them per boot — see tests/ui/harness.js.

import type { SharedReading } from "./shell";
import { Board } from "./sudoku/model.ts";
import { findHint, hintToWire, nudge, type WireHint } from "./sudoku/hint.ts";
import { solve } from "./sudoku/solver.ts";

const N = 9;

/** A cell as the page holds it: pencil marks are a Set for editing convenience. */
interface Cell {
  value: number | null;
  is_given: boolean;
  pencil_marks: Set<number>;
  low_confidence: boolean;
}

/** A cell as the server sends and receives it. */
interface WireCell {
  value: number | null;
  is_given?: boolean;
  pencil_marks?: number[];
  low_confidence?: boolean;
}

/** A hint plus the two gentler things the reveal ladder says before it. */
interface Reveal {
  nudge: string;
  hint: WireHint;
}

// The page's own markup, so every lookup below is known to succeed; a miss is a
// bug in index.html, not a state the code can carry on from.
let boardEl!: HTMLElement;
let hintEl!: HTMLElement;
let revealEl!: HTMLElement;
let applyBtn!: HTMLButtonElement;
let dropStatus!: HTMLElement;
let panelEl!: HTMLElement;
let resultEl!: HTMLElement;
let numButtons!: HTMLElement[];

// --- state ----------------------------------------------------------------
// 81 cells, row-major. pencil_marks is a Set for editing convenience.
let cells = makeEmpty();
let selected = 0;
let mode: "pen" | "pencil" = "pen";
let currentHint: Reveal | null = null;
let revealLevel = 0;
let lastImageFile: File | null = null;

function makeEmpty(): Cell[] {
  return Array.from({ length: N * N }, () => ({
    value: null,
    is_given: false,
    pencil_marks: new Set<number>(),
    low_confidence: false,
  }));
}

const idx = (r: number, c: number) => r * N + c;
const rc = (i: number): [number, number] => [Math.floor(i / N), i % N];

// --- rendering ------------------------------------------------------------
function buildGrid(): void {
  boardEl.innerHTML = "";
  for (let i = 0; i < N * N; i++) {
    const [r, c] = rc(i);
    const el = document.createElement("div");
    el.className = "cell";
    el.dataset.r = String(r);
    el.dataset.c = String(c);
    el.dataset.i = String(i);
    el.addEventListener("click", () => select(i));
    boardEl.appendChild(el);
  }
}

function render(): void {
  for (let i = 0; i < N * N; i++) {
    const el = boardEl.children[i] as HTMLElement;
    const cell = cells[i];
    el.classList.remove("sel", "peer", "target", "low");
    el.innerHTML = "";
    if (cell.value) {
      const v = document.createElement("div");
      v.className = "val " + (cell.is_given ? "given" : "pen");
      v.textContent = String(cell.value);
      el.appendChild(v);
    } else if (cell.pencil_marks.size) {
      const m = document.createElement("div");
      m.className = "marks";
      for (let d = 1; d <= 9; d++) {
        const s = document.createElement("span");
        s.textContent = cell.pencil_marks.has(d) ? String(d) : "";
        s.dataset.d = String(d);
        m.appendChild(s);
      }
      el.appendChild(m);
    }
    if (cell.low_confidence) el.classList.add("low");
  }
  applyHighlights();
  syncNumpad();
}

// The numpad does double duty (write a value in Pen, toggle a mark in
// Pencil), so it answers "what's already in this cell?" before the next tap:
// a pencilled digit's button gets a ring, the cell's actual value's button
// gets filled solid.
function syncNumpad(): void {
  const cell = cells[selected];
  for (const btn of numButtons) {
    const d = Number(btn.dataset.digit);
    btn.classList.toggle("marked", cell.pencil_marks.has(d));
    btn.classList.toggle("current", cell.value === d);
  }
}

function applyHighlights(): void {
  const [sr, sc] = rc(selected);
  for (let i = 0; i < N * N; i++) {
    const [r, c] = rc(i);
    const el = boardEl.children[i] as HTMLElement;
    el.classList.toggle("sel", i === selected);
    const samePeer =
      i !== selected &&
      (r === sr || c === sc ||
        (Math.floor(r / 3) === Math.floor(sr / 3) &&
          Math.floor(c / 3) === Math.floor(sc / 3)));
    el.classList.toggle("peer", samePeer && !el.classList.contains("target"));
  }
  // hint targets
  if (currentHint && revealLevel >= 3) {
    const h = currentHint.hint;
    for (const { r, c } of h.cells) {
      const el = boardEl.children[idx(r, c)] as HTMLElement;
      el.classList.add("target");
      // highlight the relevant candidate digits for eliminations
      if (h.action === "eliminate") {
        el.querySelectorAll<HTMLElement>(".marks span").forEach((s) => {
          if (h.digits.includes(Number(s.dataset.d))) s.classList.add("hot");
        });
      }
    }
  }
}

function select(i: number): void {
  selected = i;
  render();
  boardEl.focus();
}

// --- editing --------------------------------------------------------------
function setMode(m: "pen" | "pencil"): void {
  mode = m;
  panelEl.querySelectorAll<HTMLElement>(".mode").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === m)
  );
}

function inputDigit(d: number): void {
  const cell = cells[selected];
  if (cell.is_given) return; // don't overwrite givens
  if (mode === "pen") {
    cell.value = cell.value === d ? null : d;
    cell.pencil_marks.clear();
  } else {
    if (cell.value) return;
    cell.pencil_marks.has(d) ? cell.pencil_marks.delete(d) : cell.pencil_marks.add(d);
  }
  clearHint();
  render();
}

function clearCell(): void {
  const cell = cells[selected];
  if (cell.is_given) return;
  cell.value = null;
  cell.pencil_marks.clear();
  clearHint();
  render();
}

function onKeydown(e: KeyboardEvent): void {
  if (panelEl.hidden) return; // this tab isn't active — don't steal input
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
}

// --- serialization --------------------------------------------------------
function toPayload() {
  return {
    cells: cells.map((c) => ({
      value: c.value,
      is_given: c.is_given,
      pencil_marks: [...c.pencil_marks].sort(),
      low_confidence: c.low_confidence,
    })),
  };
}

function loadBoard(data: { cells: WireCell[] }): void {
  cells = data.cells.map((c) => ({
    value: c.value ?? null,
    is_given: !!c.is_given,
    pencil_marks: new Set(c.pencil_marks || []),
    low_confidence: !!c.low_confidence,
  }));
  clearHint();
  render();
}

// --- solving ----------------------------------------------------------
// Runs entirely in the browser: no /solve request (see web/sudoku/solver.ts).
function doSolve(): void {
  const solved = solve(Board.fromWire(toPayload()));
  if (!solved) {
    resultEl.textContent = "No solution exists for this board.";
    resultEl.classList.remove("empty");
    return;
  }
  const wire = solved.toWire();
  wire.cells.forEach((c, i) => {
    cells[i].value = c.value;
    cells[i].pencil_marks.clear();
  });
  resultEl.textContent = "Solved.";
  resultEl.classList.remove("empty");
  clearHint();
  render();
}

// --- hints ----------------------------------------------------------------
function clearHint(): void {
  currentHint = null;
  revealLevel = 0;
  applyBtn.disabled = true;
  revealEl.hidden = true;
  hintEl.className = "hint empty";
  hintEl.textContent = "No hint yet.";
}

/**
 * Find and show a hint. Runs the ported engine in the page — no request.
 *
 * The refusals are worded exactly as the deleted `/hint` endpoint worded them,
 * and are checked in the same order: an invalid board first, then a solved one,
 * then a board no implemented technique can speak to.
 */
function getHint(): void {
  const board = Board.fromWire(toPayload());
  const refuse = (reason: string): void => {
    currentHint = null;
    revealEl.hidden = true;
    applyBtn.disabled = true;
    hintEl.className = "hint";
    hintEl.innerHTML = `<span class="warn">${reason}</span>`;
  };

  if (!board.isValid()) {
    refuse("The board is invalid — a digit repeats in a unit.");
    return;
  }
  if (board.isSolved()) {
    refuse("This board is already solved. 🎉");
    return;
  }
  const hint = findHint(board);
  if (hint === null) {
    refuse(
      "No technique in the current set applies. The board may need a " +
        "more advanced strategy than is implemented yet."
    );
    return;
  }

  // Progressive reveal levels: nudge -> technique name -> full reasoning.
  currentHint = { nudge: nudge(hint), hint: hintToWire(hint) };
  revealLevel = 1;
  applyBtn.disabled = false;
  revealEl.hidden = false;
  showReveal();
}

function showReveal(): void {
  if (!currentHint) return;
  const { nudge, hint } = currentHint;
  let html = "";
  if (revealLevel >= 1) html += `<div>${nudge}</div>`;
  if (revealLevel >= 2) html += `<div class="tech">${hint.technique}</div>`;
  if (revealLevel >= 3) html += `<div>${hint.explanation}</div>`;
  hintEl.className = "hint";
  hintEl.innerHTML = html;
  revealEl.querySelectorAll<HTMLElement>("button").forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.level) === revealLevel)
  );
  render(); // refresh highlights for level 3
}

function applyStep(): void {
  if (!currentHint) return;
  const h = currentHint.hint;
  if (h.action === "place") {
    const { r, c } = h.cells[0];
    const cell = cells[idx(r, c)];
    cell.value = h.digits[0];
    cell.pencil_marks.clear();
  } else {
    for (const { r, c } of h.cells) {
      h.digits.forEach((d) => cells[idx(r, c)].pencil_marks.delete(d));
    }
  }
  clearHint();
  render();
}

// --- image upload ---------------------------------------------------------
async function sendImage(file: File): Promise<void> {
  lastImageFile = file;
  (panelEl.querySelector("#confirmRead") as HTMLButtonElement).disabled = true;
  dropStatus.textContent = "Reading board…";
  const fd = new window.FormData();
  fd.append("image", file);
  try {
    const res = await window.fetch("/parse", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      dropStatus.textContent = data.detail || data.reason || "Could not read the image.";
      return;
    }
    applyParsed(data);
  } catch (err) {
    dropStatus.textContent = "Upload failed: " + (err as Error).message;
  }
}

/** Put an already-parsed reading onto the board. Shared with the share target. */
function applyParsed(data: { board: { cells: WireCell[] } }): void {
  loadBoard(data.board);
  (panelEl.querySelector("#confirmRead") as HTMLButtonElement).disabled = false;
  const low = data.board.cells.filter((c) => c.low_confidence).length;
  dropStatus.textContent = low
    ? `Read board — ${low} cell(s) flagged low-confidence (outlined red). Please check them.`
    : "Read board — please verify before requesting a hint.";
}

/**
 * Adopt a screenshot the share target has already read.
 *
 * The file is kept, not just the reading: "Confirm reading" teaches the digit
 * recognizer by re-extracting glyphs from the original image, so a shared
 * board would silently lose the ability to learn from corrections without it.
 */
function acceptShared(file: File, data: SharedReading): void {
  lastImageFile = file;
  applyParsed(data as { board: { cells: WireCell[] } });
}

async function confirmReading(): Promise<void> {
  if (!lastImageFile) return;
  const fd = new window.FormData();
  fd.append("image", lastImageFile);
  fd.append("board", JSON.stringify(toPayload()));
  dropStatus.textContent = "Learning from your corrections…";
  try {
    const res = await window.fetch("/confirm", { method: "POST", body: fd });
    const data = await res.json();
    dropStatus.textContent = data.ok
      ? `Thanks — learned ${data.learned} digit example(s). Future reads will improve.`
      : data.detail || "Could not learn from this board.";
  } catch (err) {
    dropStatus.textContent = "Confirm failed: " + (err as Error).message;
  }
}

function onPaste(e: ClipboardEvent): void {
  if (panelEl.hidden) return; // this tab isn't active
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) {
    const file = item.getAsFile();
    if (file) sendImage(file);
  }
}

// --- mount ------------------------------------------------------------
function mount(containerEl: HTMLElement): void {
  panelEl = containerEl;
  boardEl = panelEl.querySelector("#board")!;
  hintEl = panelEl.querySelector("#hint")!;
  revealEl = panelEl.querySelector("#reveal")!;
  applyBtn = panelEl.querySelector("#apply")!;
  dropStatus = panelEl.querySelector("#dropStatus")!;
  resultEl = panelEl.querySelector("#result")!;

  // --- wiring ---------------------------------------------------------------
  const drop = panelEl.querySelector("#drop")!;
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const f = (e as DragEvent).dataTransfer?.files[0];
    if (f) sendImage(f);
  });
  panelEl.querySelector("#file")!.addEventListener("change", (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files && files[0]) sendImage(files[0]);
  });
  window.addEventListener("paste", onPaste);
  document.addEventListener("keydown", onKeydown);

  panelEl.querySelectorAll<HTMLElement>(".mode").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode as "pen" | "pencil"))
  );
  numButtons = [...panelEl.querySelectorAll<HTMLElement>(".num[data-digit]")];
  numButtons.forEach((b) =>
    b.addEventListener("click", () => inputDigit(Number(b.dataset.digit)))
  );
  panelEl.querySelector("#numClear")!.addEventListener("click", clearCell);
  panelEl.querySelector("#getHint")!.addEventListener("click", getHint);
  panelEl.querySelector("#solve")!.addEventListener("click", doSolve);
  panelEl.querySelector("#confirmRead")!.addEventListener("click", confirmReading);
  applyBtn.addEventListener("click", applyStep);
  panelEl.querySelector("#clear")!.addEventListener("click", () => {
    cells = makeEmpty();
    clearHint();
    resultEl.textContent = "No solve yet.";
    resultEl.classList.add("empty");
    render();
  });
  revealEl.querySelectorAll<HTMLElement>("button").forEach((b) =>
    b.addEventListener("click", () => {
      revealLevel = Number(b.dataset.level);
      showReveal();
    })
  );

  buildGrid();
  render();
}

window.PuzzleShell.register({ id: "sudoku", label: "Sudoku", mount, acceptShared });
