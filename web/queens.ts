// Queens tab front-end: manual entry (region painting, mark/queen gestures) and
// backtracking solve.
//
// Registers itself with the puzzle-type shell (see shell.ts) and mounts its UI
// into the container the shell hands it. State is module-level (private to
// this module) so it survives tab switches the same way sudoku.ts's does.

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

// The page's own markup, so every lookup in mount() is known to succeed.
let panelEl!: HTMLElement;
let sizeInput!: HTMLInputElement;
let paletteEl!: HTMLElement;
let boardEl!: HTMLElement;
let resultEl!: HTMLElement;
let hintEl!: HTMLElement;
let revealEl!: HTMLElement;
let applyBtn!: HTMLButtonElement;

// --- state ------------------------------------------------------------
let n = DEFAULT_N;
let cells = makeEmpty(n); // row-major; each {state: "empty"|"marked"|"queen", region: int|null}
let regionCount = 1; // number of swatches offered so far (region ids 0..regionCount-1)
let tool: "cursor" | "paint" = "cursor"; // "cursor" (mark/queen gestures) | "paint" (paint activeRegion)
let activeRegion = 0;
let isMouseDown = false;
let pendingClick: { i: number; timer: number } | null = null; // debounced single-click awaiting a possible dblclick
let currentHint: HintReply | null = null;
let revealLevel = 0;

function makeEmpty(size: number): QueensCell[] {
  // Unpainted cells default to region: null (never inferred, never region 0 —
  // see queens/model.py's Cell docstring for why null is the sentinel).
  return Array.from({ length: size * size }, () => ({ state: "empty" as CellState, region: null }));
}

function colorForRegion(id: number): string {
  if (id < PALETTE_POOL.length) return PALETTE_POOL[id];
  // Beyond the built-in pool (boards can have more regions than we ship
  // swatches for), spread further hues out using the golden angle.
  return `hsl(${(id * 137.508) % 360}, 65%, 72%)`;
}

const idx = (r: number, c: number) => r * n + c;

// --- rendering ----------------------------------------------------------
function buildGrid(): void {
  boardEl.innerHTML = "";
  boardEl.style.setProperty("--n", String(n));
  boardEl.style.gridTemplateColumns = `repeat(${n}, var(--cell))`;
  boardEl.style.gridTemplateRows = `repeat(${n}, var(--cell))`;
  for (let i = 0; i < n * n; i++) {
    const el = document.createElement("div");
    el.className = "qcell";
    el.dataset.i = String(i);
    el.addEventListener("mousedown", () => onCellMouseDown(i));
    el.addEventListener("mouseenter", () => onCellMouseEnter(i));
    el.addEventListener("click", () => onCellClick(i));
    el.addEventListener("dblclick", () => onCellDblClick(i));
    boardEl.appendChild(el);
  }
}

function render(): void {
  for (let i = 0; i < n * n; i++) {
    const el = boardEl.children[i] as HTMLElement;
    const cell = cells[i];
    el.style.background = cell.region === null ? "" : colorForRegion(cell.region);
    el.classList.remove("target");
    el.innerHTML = "";
    if (cell.state === "queen") {
      el.appendChild(glyph("queen", "♛"));
    } else if (cell.state === "marked") {
      el.appendChild(glyph("mark", "✕"));
    }
  }
  applyHintHighlight();
}

function applyHintHighlight(): void {
  // Full-reveal level highlights the hint's target cell(s), the same way
  // Sudoku highlights `.target` cells on its board.
  if (!currentHint || revealLevel < 3) return;
  for (const { r, c } of currentHint.hint.cells) {
    boardEl.children[idx(r, c)].classList.add("target");
  }
}

function glyph(cls: string, text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "qmark " + cls;
  d.textContent = text;
  return d;
}

function renderPalette(): void {
  paletteEl.innerHTML = "";

  const cursorBtn = document.createElement("button");
  cursorBtn.type = "button";
  cursorBtn.className = "swatch cursor" + (tool === "cursor" ? " active" : "");
  cursorBtn.textContent = "✎";
  cursorBtn.title = "Mark / Queen tool";
  cursorBtn.addEventListener("click", () => {
    tool = "cursor";
    renderPalette();
  });
  paletteEl.appendChild(cursorBtn);

  for (let i = 0; i < regionCount; i++) {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "swatch" + (tool === "paint" && activeRegion === i ? " active" : "");
    sw.style.background = colorForRegion(i);
    sw.title = `Region ${i + 1}`;
    sw.addEventListener("click", () => {
      tool = "paint";
      activeRegion = i;
      renderPalette();
    });
    paletteEl.appendChild(sw);
  }

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "swatch add";
  plus.textContent = "+";
  plus.title = "Add a region color";
  plus.addEventListener("click", () => {
    tool = "paint";
    activeRegion = regionCount;
    regionCount++;
    renderPalette();
  });
  paletteEl.appendChild(plus);
}

// --- painting -------------------------------------------------------------
function paintCell(i: number): void {
  if (tool !== "paint") return;
  if (cells[i].region === activeRegion) return;
  cells[i].region = activeRegion;
  clearHint();
  render();
}

function onCellMouseDown(i: number): void {
  if (tool !== "paint") return;
  isMouseDown = true;
  paintCell(i);
}

function onCellMouseEnter(i: number): void {
  if (tool !== "paint" || !isMouseDown) return;
  paintCell(i);
}

// --- mark/queen gestures ----------------------------------------------
function onCellClick(i: number): void {
  if (tool !== "cursor") return;
  cancelPendingClick();
  pendingClick = {
    i,
    timer: window.setTimeout(() => {
      pendingClick = null;
      commitSingleClick(i);
    }, CLICK_DEBOUNCE_MS),
  };
}

function onCellDblClick(i: number): void {
  if (tool !== "cursor") return;
  cancelPendingClick();
  commitDoubleClick(i);
}

function cancelPendingClick(): void {
  if (pendingClick) {
    window.clearTimeout(pendingClick.timer);
    pendingClick = null;
  }
}

function commitSingleClick(i: number): void {
  const cell = cells[i];
  cell.state = cell.state === "empty" ? "marked" : "empty";
  clearResult();
  clearHint();
  render();
}

function commitDoubleClick(i: number): void {
  const cell = cells[i];
  cell.state = cell.state === "queen" ? "empty" : "queen";
  clearResult();
  clearHint();
  render();
}

// --- board lifecycle --------------------------------------------------
function newBoard(): void {
  const requested = Number(sizeInput.value) || DEFAULT_N;
  n = Math.max(1, Math.min(16, Math.round(requested)));
  sizeInput.value = String(n);
  resetState();
  buildGrid();
  render();
}

function clearBoard(): void {
  // Same N as currently sized, region palette reset to empty too — a "clear"
  // wipes the whole manual entry, not just marks/queens.
  resetState();
  buildGrid();
  render();
}

function resetState(): void {
  cells = makeEmpty(n);
  regionCount = 1;
  activeRegion = 0;
  tool = "cursor";
  clearResult();
  clearHint();
  renderPalette();
}

function loadSolvedBoard(data: { cells: QueensCell[] }): void {
  cells = data.cells.map((c) => ({ state: c.state, region: c.region }));
  // The solved board can't introduce new region ids, but keep the palette at
  // least as wide as whatever regions are actually present.
  const maxRegion = cells.reduce((m, c) => Math.max(m, c.region ?? -1), -1);
  regionCount = Math.max(regionCount, maxRegion + 1);
  renderPalette();
  clearHint();
  render();
}

// --- solve --------------------------------------------------------------
function toPayload() {
  return { n, cells: cells.map((c) => ({ state: c.state, region: c.region })) };
}

function clearResult(): void {
  resultEl.className = "hint empty";
  resultEl.textContent = "No solve yet.";
}

async function solveBoard(): Promise<void> {
  resultEl.className = "hint empty";
  resultEl.textContent = "Solving…";
  try {
    const res = await window.fetch("/queens/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload()),
    });
    const data = await res.json();
    if (!data.ok) {
      resultEl.className = "hint";
      resultEl.innerHTML = `<span class="warn">${data.reason}</span>`;
      return;
    }
    loadSolvedBoard(data.board);
    resultEl.className = "hint";
    resultEl.textContent = "Solved!";
  } catch (err) {
    resultEl.className = "hint";
    resultEl.innerHTML = `<span class="warn">Solve failed: ${(err as Error).message}</span>`;
  }
}

// --- hints ----------------------------------------------------------------
function clearHint(): void {
  currentHint = null;
  revealLevel = 0;
  applyBtn.disabled = true;
  revealEl.hidden = true;
  hintEl.className = "hint empty";
  hintEl.textContent = "No hint yet.";
  // Callers re-render afterward (mirrors sudoku.ts) — resetState() in
  // particular calls this before buildGrid() rebuilds the board DOM for a
  // possibly different N, so rendering here would touch stale/mismatched
  // cell elements.
}

async function getHint(): Promise<void> {
  let data;
  try {
    const res = await window.fetch("/queens/hint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload()),
    });
    data = await res.json();
  } catch (err) {
    currentHint = null;
    revealEl.hidden = true;
    applyBtn.disabled = true;
    hintEl.className = "hint";
    hintEl.innerHTML = `<span class="warn">Hint request failed: ${(err as Error).message}</span>`;
    render();
    return;
  }
  if (!data.ok) {
    currentHint = null;
    revealEl.hidden = true;
    applyBtn.disabled = true;
    hintEl.className = "hint";
    hintEl.innerHTML = `<span class="warn">${data.reason}</span>`;
    render();
    return;
  }
  currentHint = data as HintReply;
  revealLevel = 1;
  applyBtn.disabled = false;
  revealEl.hidden = false;
  showReveal();
}

function showReveal(): void {
  if (!currentHint) return;
  const { nudge, technique, hint } = currentHint;
  let html = "";
  if (revealLevel >= 1) html += `<div>${nudge}</div>`;
  if (revealLevel >= 2) html += `<div class="tech">${technique}</div>`;
  if (revealLevel >= 3) html += `<div>${hint.explanation}</div>`;
  hintEl.className = "hint";
  hintEl.innerHTML = html;
  revealEl.querySelectorAll<HTMLElement>("button").forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.level) === revealLevel)
  );
  render(); // refresh the board highlight for level 3
}

function applyStep(): void {
  if (!currentHint) return;
  const h = currentHint.hint;
  if (h.action === "place") {
    const { r, c } = h.cells[0];
    cells[idx(r, c)].state = "queen";
  } else {
    // Elimination hints (issues #7/#8): the ruled-out cells become Marks,
    // same as a player manually ruling them out.
    for (const { r, c } of h.cells) {
      cells[idx(r, c)].state = "marked";
    }
  }
  clearResult();
  clearHint();
  render();
}

// --- mount --------------------------------------------------------------
function mount(containerEl: HTMLElement): void {
  panelEl = containerEl;
  sizeInput = panelEl.querySelector("#qSize")!;
  paletteEl = panelEl.querySelector("#qPalette")!;
  boardEl = panelEl.querySelector("#qBoard")!;
  resultEl = panelEl.querySelector("#qResult")!;
  hintEl = panelEl.querySelector("#qHint")!;
  revealEl = panelEl.querySelector("#qReveal")!;
  applyBtn = panelEl.querySelector("#qApply")!;

  panelEl.querySelector("#qNew")!.addEventListener("click", newBoard);
  panelEl.querySelector("#qClear")!.addEventListener("click", clearBoard);
  panelEl.querySelector("#qSolve")!.addEventListener("click", solveBoard);
  panelEl.querySelector("#qGetHint")!.addEventListener("click", getHint);
  applyBtn.addEventListener("click", applyStep);
  revealEl.querySelectorAll<HTMLElement>("button").forEach((b) =>
    b.addEventListener("click", () => {
      revealLevel = Number(b.dataset.level);
      showReveal();
    })
  );
  window.addEventListener("mouseup", () => {
    isMouseDown = false;
  });

  renderPalette();
  buildGrid();
  render();
}

window.PuzzleShell.register({ id: "queens", label: "Queens", mount });
