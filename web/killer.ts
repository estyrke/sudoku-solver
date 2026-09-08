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

import type { SharedReading } from "./shell";
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

/** A hint the page is currently showing, with its gentlest reveal already
 * worded. */
interface ShownHint {
  nudge: string;
  hint: WireHint;
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

// ---- state -------------------------------------------------------------
// Module-level, so it survives tab switches (the shell only hides panels).
let cells: KillerCell[] = [];
let cages: Cage[] = [];
let mode: "cages" | "digits" = "cages";
let pen: "pen" | "pencil" = "pen";
let selected: { r: number; c: number } | null = null; // in digits mode
let selectedCage: number | null = null; // index into `cages` in cages mode
let dragging: Set<string> | null = null; // Set of "r,c" keys while dragging
let unsure = new Set<string>(); // anchors whose sum the reader flagged as doubtful
let currentHint: ShownHint | null = null;
let revealLevel = 0;
let mistakes: string[] = []; // "r,c" keys the last audit flagged as wrong

function blankCells(): KillerCell[] {
  return Array.from({ length: N * N }, () => ({ value: null, marks: [] as number[] }));
}

function reset(): void {
  cells = blankCells();
  cages = [];
  selected = null;
  selectedCage = null;
  unsure = new Set();
}

// ---- cage helpers ------------------------------------------------------

const key = (r: number, c: number) => `${r},${c}`;
const parseKey = (k: string): Coord => k.split(",").map(Number) as Coord;

function cageIndexAt(r: number, c: number): number {
  return cages.findIndex((cage) =>
    cage.cells.some(([cr, cc]) => cr === r && cc === c)
  );
}

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

// The cell a cage prints its sum in: topmost row, then leftmost column.
function cageAnchor(cage: Cage): Coord {
  return cage.cells.reduce((best, cur) =>
    cur[0] < best[0] || (cur[0] === best[0] && cur[1] < best[1]) ? cur : best
  );
}

// ---- rendering ---------------------------------------------------------

// The page's own markup, so every lookup in mount() is known to succeed.
let boardEl!: HTMLElement;
let statusEl!: HTMLElement;
let resultEl!: HTMLElement;
let sumRow!: HTMLElement;
let sumInput!: HTMLInputElement;
let sumLabel!: HTMLElement;
let deleteBtn!: HTMLButtonElement;
let totalsEl!: HTMLElement;
let hintEl!: HTMLElement;
let revealEl!: HTMLElement;

function render(): void {
  boardEl.innerHTML = "";
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      boardEl.appendChild(renderCell(r, c));
    }
  }
  markHintTargets();
  renderCageEditor();
  renderTotals();
}

// Every unit holds 1-9 exactly once, so a board fully covered by cages has
// sums totalling 9 x 45. Shown live: the reader's own check goes stale the
// moment a sum is corrected by hand, which is exactly when it's needed.
const UNIT_TOTAL = 45;
const FULL_TOTAL = UNIT_TOTAL * N;

function renderTotals(): void {
  if (!totalsEl) return;
  if (!cages.length) {
    totalsEl.textContent = "";
    totalsEl.className = "totals";
    return;
  }
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
  totalsEl.textContent = bits.join(" · ");
  totalsEl.className = "totals" + state;
}

function renderCell(r: number, c: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "cell kcell";
  el.dataset.r = String(r);
  el.dataset.c = String(c);

  const ci = cageIndexAt(r, c);
  if (ci >= 0) {
    const cage = cages[ci];
    const inCage = (rr: number, cc: number) =>
      cage.cells.some(([a, b]) => a === rr && b === cc);
    // Dash only the edges that leave the cage, so a cage reads as one outline.
    // All four live on one overlay element: separate ::before/::after
    // pseudo-elements would collide on cells needing two adjacent edges.
    const edge = document.createElement("div");
    edge.className = "cage-edge";
    for (const [side, rr, cc] of [
      ["t", r - 1, c],
      ["b", r + 1, c],
      ["l", r, c - 1],
      ["r", r, c + 1],
    ] as [string, number, number][]) {
      // Dash the sides that leave the cage. On the sides where it continues,
      // stretch the overlay to the cell edge instead — otherwise every cell
      // insets its outline and the dashes break at each internal junction,
      // making one cage read as a row of separate boxes.
      edge.classList.add(inCage(rr, cc) ? `x-${side}` : side);
    }
    el.appendChild(edge);
    if (ci === selectedCage) el.classList.add("cage-selected");

    const [ar, ac] = cageAnchor(cage);
    if (unsure.has(key(ar, ac))) el.classList.add("cage-unsure");
    if (ar === r && ac === c) {
      const tag = document.createElement("span");
      tag.className = "cage-sum";
      tag.textContent = String(cage.sum);
      el.appendChild(tag);
    }
  } else {
    el.classList.add("uncaged");
  }

  if (mistakes.includes(key(r, c))) el.classList.add("mistake");
  if (dragging && dragging.has(key(r, c))) el.classList.add("dragging");
  if (mode === "digits" && selected && selected.r === r && selected.c === c)
    el.classList.add("sel");

  const cell = cells[idx(r, c)];
  if (cell.value != null) {
    const v = document.createElement("span");
    v.className = "val";
    v.textContent = String(cell.value);
    el.appendChild(v);
  } else if (cell.marks.length) {
    // One span per digit position, matching the 3x3 grid `.marks` lays out —
    // a single span of joined text collapses into the grid's first cell.
    const m = document.createElement("div");
    m.className = "marks";
    for (let d = 1; d <= 9; d++) {
      const s = document.createElement("span");
      s.dataset.d = String(d);
      s.textContent = cell.marks.includes(d) ? String(d) : "";
      m.appendChild(s);
    }
    el.appendChild(m);
  }
  return el;
}

function renderCageEditor(): void {
  const active = selectedCage != null && cages[selectedCage];
  sumRow.hidden = !active;
  if (!active) return;
  const cage = cages[selectedCage!];
  sumLabel.textContent = `Cage of ${cage.cells.length} cells`;
  sumInput.value = String(cage.sum);
}

function setStatus(msg: string, isError?: boolean): void {
  statusEl.textContent = msg || "";
  statusEl.classList.toggle("error", !!isError);
}

// ---- cage painting -----------------------------------------------------

function cellFromEvent(ev: Event): { r: number; c: number } | null {
  const el = (ev.target as Element | null)?.closest<HTMLElement>(".kcell");
  if (!el || !boardEl.contains(el)) return null;
  return { r: Number(el.dataset.r), c: Number(el.dataset.c) };
}

function beginDrag(ev: Event): void {
  if (mode !== "cages") return;
  const at = cellFromEvent(ev);
  if (!at) return;
  ev.preventDefault();

  // Clicking inside an existing cage selects it rather than starting a paint.
  const existing = cageIndexAt(at.r, at.c);
  if (existing >= 0) {
    selectedCage = existing;
    dragging = null;
    render();
    return;
  }
  selectedCage = null;
  dragging = new Set([key(at.r, at.c)]);
  render();
}

function extendDrag(ev: Event): void {
  if (!dragging) return;
  const at = cellFromEvent(ev);
  if (!at) return;
  if (cageIndexAt(at.r, at.c) >= 0) return; // don't paint over another cage
  dragging.add(key(at.r, at.c));
  render();
}

function endDrag(): void {
  if (!dragging) return;
  const coords = [...dragging].map(parseKey);
  dragging = null;
  if (coords.length < 2) {
    setStatus("A cage needs at least 2 cells.", true);
    render();
    return;
  }
  if (!isContiguous(coords)) {
    setStatus(
      "Those cells aren't connected edge-to-edge — cage not created.",
      true
    );
    render();
    return;
  }
  const [lo, hi] = sumBounds(coords.length);
  const raw = window.prompt(
    `Sum for this ${coords.length}-cell cage (${lo}–${hi}):`
  );
  if (raw == null) {
    render();
    return;
  }
  const total = Number(raw);
  const problem = describeCageProblem(coords, total);
  if (problem) {
    setStatus(problem, true);
    render();
    return;
  }
  cages.push({ cells: coords, sum: total });
  selectedCage = cages.length - 1;
  setStatus(`Cage added (${coords.length} cells, sum ${total}).`);
  render();
}

// ---- digit entry -------------------------------------------------------

function setDigit(d: number): void {
  if (mode !== "digits" || !selected) return;
  const cell = cells[idx(selected.r, selected.c)];
  if (pen === "pen") {
    cell.value = cell.value === d ? null : d;
    cell.marks = [];
  } else {
    if (cell.value != null) return;
    cell.marks = cell.marks.includes(d)
      ? cell.marks.filter((m) => m !== d)
      : [...cell.marks, d];
  }
  clearHint();
  render();
}

function clearCell(): void {
  if (mode !== "digits" || !selected) return;
  const cell = cells[idx(selected.r, selected.c)];
  cell.value = null;
  cell.marks = [];
  clearHint();
  render();
}

// ---- the engine ----------------------------------------------------------

/** The page's board as the engine's Board, cages and all.
 *
 * Throws when the cages break a rule the painting checks let through — the
 * model is the source of truth for that, and its wording is what the player
 * used to see come back from the server. */
function toBoard(): Board {
  return Board.fromWire({
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
}

// Runs entirely in the browser: no /killer/solve request.
//
// An unsolvable board is audited rather than blamed on the cages. "No solution
// exists — check the cage sums" was the old answer, and it sent people to the
// cages when the culprit was usually a digit they had entered; the audit says
// which.
function doSolve(): void {
  // No "Solving…" placeholder: the solve is synchronous now, so the browser
  // never gets a frame in which to paint one. (queens.ts still has one; it is
  // still awaiting a response.)
  resultEl.classList.remove("empty");
  try {
    const board = toBoard();
    const solved = solve(board);
    if (solved === null) {
      resultEl.textContent = audit(board).message;
      return;
    }
    solved.cells.forEach((cell, i) => {
      cells[i].value = cell.value;
      cells[i].marks = [];
    });
    resultEl.textContent = "Solved.";
    render();
  } catch (err) {
    resultEl.textContent = (err as Error).message;
  }
}

// ---- hints ---------------------------------------------------------------

// Killer hints are the ones that most need their reasoning shown: "look at the
// 32-cage at r4c8" is not something a player can act on, and unlike a classic
// single they usually can't reconstruct the argument themselves. Same three
// levels as the other two tabs, so nobody is forced past a nudge to get one.
function clearHint(): void {
  currentHint = null;
  revealLevel = 0;
  mistakes = [];
  if (!hintEl) return;
  revealEl.hidden = true;
  hintEl.className = "hint empty";
  hintEl.textContent = "No hint yet.";
}

/**
 * Find and show a hint, running the ported engine in the page — no request.
 *
 * The board is audited *before* it is hinted, and a real mistake gets the
 * audit's message instead of a hint: a hint deduced from a wrong entry, or in a
 * world where a needed pencil mark has been rubbed out, is worse than no hint
 * because it looks authoritative and sends the player further off. "incomplete"
 * is not a mistake — just a board still being drawn — so it blocks nothing.
 */
function doHint(): void {
  hintEl.className = "hint";
  const refuse = (reason: string, report?: WireAudit): void => {
    currentHint = null;
    revealEl.hidden = true;
    hintEl.textContent = reason;
    // A mistake report names cells; point at them the way a hint does, since
    // "r1c1 is wrong" is only useful once you've found r1c1.
    mistakes = (report?.cells ?? []).map((m) => key(m.r, m.c));
    render();
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

  const hint = findHint(board);
  if (hint === null) {
    refuse(
      "No mistakes on the board — this one needs a technique that " +
        "isn't implemented yet."
    );
    return;
  }

  mistakes = [];
  // Progressive reveal levels: nudge -> technique name -> full reasoning.
  currentHint = { nudge: nudge(hint), hint: hintToWire(hint) };
  revealLevel = 1;
  revealEl.hidden = false;
  renderHint();
}

function renderHint(): void {
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
  render();
}

// At full reveal, point at the cells on the board too — a cage is named by its
// anchor, and finding r4c8 by counting rows is its own small chore.
function markHintTargets(): void {
  if (!currentHint || revealLevel < 3) return;
  const h = currentHint.hint;
  for (const { r, c } of h.cells) {
    const el = boardEl.children[idx(r, c)];
    if (!el) continue;
    el.classList.add("target");
    if (h.action !== "eliminate") continue;
    el.querySelectorAll<HTMLElement>(".marks span").forEach((s) => {
      if (h.digits.includes(Number(s.dataset.d))) s.classList.add("hot");
    });
  }
}

// ---- screenshot import -------------------------------------------------

async function importImage(file: File | undefined, statusEl: HTMLElement): Promise<void> {
  if (!file) return;
  statusEl.textContent = "Reading…";
  const body = new window.FormData();
  body.append("image", file);
  try {
    const res = await window.fetch("/killer/parse", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = data.detail || `Could not read that image (${res.status}).`;
      return;
    }
    applyParsed(data, statusEl);
  } catch (err) {
    statusEl.textContent = (err as Error).message;
  }
}

/**
 * Put an already-parsed reading onto the board.
 *
 * Split out from the upload so a screenshot arriving from the Android share
 * sheet lands here too. That path has the payload in hand before the tab is
 * even in front (the share endpoint parses it to work out which puzzle it
 * is), and it must not diverge from the dropped-file path: every warning
 * below — uncaged cells, doubtful sums, the 405 checksum — matters just as
 * much when the picture came from the share sheet.
 */
function applyParsed(data: ParsedReading, statusEl: HTMLElement): void {
  cages = (data.board.cages || []).map((cage) => ({
    cells: cage.cells.map((cell) => [cell.r, cell.c] as Coord),
    sum: cage.sum,
  }));
  cells = data.board.cells.map((cell) => ({
    value: cell.value,
    marks: cell.pencil_marks || [],
  }));
  unsure = new Set((data.unsure || []).map((u) => key(u.r, u.c)));
  selected = null;
  selectedCage = null;
  clearHint();

  const notes = [`Read ${cages.length} cages.`];
  if (!data.fully_caged)
    notes.push("Some cells aren't in a cage — check the outlines.");
  if (unsure.size)
    notes.push(`${unsure.size} cage sum(s) look doubtful (highlighted).`);
  // Cage sums must total 45 per unit. A mismatch means a sum was misread even
  // when every individual read looked confident.
  if (data.fully_caged && !data.checksum_ok) {
    notes.push(
      `Cage sums total ${data.sum_total}, but a full board must total 405 — ` +
        `at least one sum is wrong.`
    );
  }
  statusEl.textContent = notes.join(" ");
  statusEl.classList.toggle("error", !!data.needs_review);
  setStatus(
    unsure.size
      ? "Click a highlighted cage to correct its sum."
      : "Board read. Check it over, then solve."
  );
  render();
}

/** Adopt a screenshot the share target has already read. */
function acceptShared(_file: File, data: SharedReading): void {
  applyParsed(data as ParsedReading, document.getElementById("kDropStatus")!);
}

function wireImport(panel: HTMLElement): void {
  const drop = panel.querySelector("#kDrop")!;
  const status = panel.querySelector<HTMLElement>("#kDropStatus")!;
  const file = panel.querySelector<HTMLInputElement>("#kFile")!;

  file.addEventListener("change", () => importImage(file.files?.[0], status));
  drop.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (ev) => {
    ev.preventDefault();
    drop.classList.remove("over");
    importImage((ev as DragEvent).dataTransfer?.files[0], status);
  });
  document.addEventListener("paste", (ev) => {
    if (panel.hidden) return;
    const item = [...((ev as ClipboardEvent).clipboardData?.items || [])].find((i) =>
      i.type.startsWith("image/")
    );
    if (item) importImage(item.getAsFile() ?? undefined, status);
  });
}

// ---- wiring ------------------------------------------------------------

function mount(panel: HTMLElement): void {
  boardEl = panel.querySelector("#kBoard")!;
  statusEl = panel.querySelector("#kStatus")!;
  resultEl = panel.querySelector("#kResult")!;
  sumRow = panel.querySelector("#kSumRow")!;
  sumInput = panel.querySelector("#kSumInput")!;
  sumLabel = panel.querySelector("#kSumLabel")!;
  deleteBtn = panel.querySelector("#kDeleteCage")!;
  totalsEl = panel.querySelector("#kTotals")!;
  hintEl = panel.querySelector("#kHint")!;
  revealEl = panel.querySelector("#kReveal")!;

  reset();

  boardEl.addEventListener("mousedown", beginDrag);
  boardEl.addEventListener("mouseover", extendDrag);
  document.addEventListener("mouseup", endDrag);

  boardEl.addEventListener("click", (ev) => {
    if (mode !== "digits") return;
    const at = cellFromEvent(ev);
    if (at) {
      selected = at;
      render();
    }
  });

  panel.querySelectorAll<HTMLElement>("[data-kmode]").forEach((btn) =>
    btn.addEventListener("click", () => {
      mode = btn.dataset.kmode as "cages" | "digits";
      selected = null;
      selectedCage = null;
      panel
        .querySelectorAll<HTMLElement>("[data-kmode]")
        .forEach((b) => b.classList.toggle("active", b === btn));
      panel.querySelector<HTMLElement>("#kDigitControls")!.hidden = mode !== "digits";
      setStatus(
        mode === "cages"
          ? "Drag across empty cells to make a cage; click a cage to edit it."
          : "Click a cell, then type 1–9. 0 or ⌫ clears."
      );
      render();
    })
  );

  panel.querySelectorAll<HTMLElement>("[data-kpen]").forEach((btn) =>
    btn.addEventListener("click", () => {
      pen = btn.dataset.kpen as "pen" | "pencil";
      panel
        .querySelectorAll<HTMLElement>("[data-kpen]")
        .forEach((b) => b.classList.toggle("active", b === btn));
    })
  );

  panel.querySelectorAll<HTMLElement>("#kNumpad [data-digit]").forEach((btn) =>
    btn.addEventListener("click", () => setDigit(Number(btn.dataset.digit)))
  );
  panel.querySelector("#kNumClear")!.addEventListener("click", clearCell);

  sumInput.addEventListener("change", () => {
    if (selectedCage == null) return;
    const cage = cages[selectedCage];
    const total = Number(sumInput.value);
    const problem = describeCageProblem(cage.cells, total);
    if (problem) {
      setStatus(problem, true);
      sumInput.value = String(cage.sum);
      return;
    }
    cage.sum = total;
    unsure.delete(key(...cageAnchor(cage)));
    setStatus(`Cage sum updated to ${total}.`);
    clearHint();
    render();
  });

  deleteBtn.addEventListener("click", () => {
    if (selectedCage == null) return;
    cages.splice(selectedCage, 1);
    selectedCage = null;
    setStatus("Cage deleted.");
    clearHint();
    render();
  });

  wireImport(panel);
  panel.querySelector("#kSolve")!.addEventListener("click", doSolve);
  panel.querySelector("#kGetHint")!.addEventListener("click", doHint);
  revealEl.querySelectorAll<HTMLElement>("button").forEach((btn) =>
    btn.addEventListener("click", () => {
      revealLevel = Number(btn.dataset.level);
      renderHint();
    })
  );
  panel.querySelector("#kClear")!.addEventListener("click", () => {
    reset();
    setStatus("Board cleared.");
    resultEl.textContent = "No solve yet.";
    resultEl.classList.add("empty");
    clearHint();
  });

  document.addEventListener("keydown", (ev) => {
    if (panel.hidden || mode !== "digits" || !selected) return;
    if (ev.key >= "1" && ev.key <= "9") setDigit(Number(ev.key));
    else if (ev.key === "0" || ev.key === "Backspace" || ev.key === "Delete")
      clearCell();
  });

  setStatus("Drag across empty cells to make a cage; click a cage to edit it.");
  render();
}

window.PuzzleShell.register({ id: "killer", label: "Killer", mount, acceptShared });
