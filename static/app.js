// Sudoku Helper front-end: editable board, manual entry, image parse, hint reveal.

const N = 9;
const boardEl = document.getElementById("board");
const hintEl = document.getElementById("hint");
const revealEl = document.getElementById("reveal");
const applyBtn = document.getElementById("apply");
const dropStatus = document.getElementById("dropStatus");

// --- state ----------------------------------------------------------------
// 81 cells, row-major. pencil_marks is a Set for editing convenience.
let cells = makeEmpty();
let selected = 0;
let mode = "pen"; // "pen" | "pencil"
let currentHint = null; // {hint, nudge, technique}
let revealLevel = 0;

function makeEmpty() {
  return Array.from({ length: N * N }, () => ({
    value: null,
    is_given: false,
    pencil_marks: new Set(),
    low_confidence: false,
  }));
}

const idx = (r, c) => r * N + c;
const rc = (i) => [Math.floor(i / N), i % N];

// --- rendering ------------------------------------------------------------
function buildGrid() {
  boardEl.innerHTML = "";
  for (let i = 0; i < N * N; i++) {
    const [r, c] = rc(i);
    const el = document.createElement("div");
    el.className = "cell";
    el.dataset.r = r;
    el.dataset.c = c;
    el.dataset.i = i;
    el.addEventListener("click", () => select(i));
    boardEl.appendChild(el);
  }
}

function render() {
  for (let i = 0; i < N * N; i++) {
    const el = boardEl.children[i];
    const cell = cells[i];
    el.classList.remove("sel", "peer", "target", "low");
    el.innerHTML = "";
    if (cell.value) {
      const v = document.createElement("div");
      v.className = "val " + (cell.is_given ? "given" : "pen");
      v.textContent = cell.value;
      el.appendChild(v);
    } else if (cell.pencil_marks.size) {
      const m = document.createElement("div");
      m.className = "marks";
      for (let d = 1; d <= 9; d++) {
        const s = document.createElement("span");
        s.textContent = cell.pencil_marks.has(d) ? d : "";
        s.dataset.d = d;
        m.appendChild(s);
      }
      el.appendChild(m);
    }
    if (cell.low_confidence) el.classList.add("low");
  }
  applyHighlights();
}

function applyHighlights() {
  const [sr, sc] = rc(selected);
  for (let i = 0; i < N * N; i++) {
    const [r, c] = rc(i);
    const el = boardEl.children[i];
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
      const el = boardEl.children[idx(r, c)];
      el.classList.add("target");
      // highlight the relevant candidate digits for eliminations
      if (h.action === "eliminate") {
        el.querySelectorAll(".marks span").forEach((s) => {
          if (h.digits.includes(Number(s.dataset.d))) s.classList.add("hot");
        });
      }
    }
  }
}

function select(i) {
  selected = i;
  render();
  boardEl.focus();
}

// --- editing --------------------------------------------------------------
function setMode(m) {
  mode = m;
  document.querySelectorAll(".mode").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === m)
  );
}

function inputDigit(d) {
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

function clearCell() {
  const cell = cells[selected];
  if (cell.is_given) return;
  cell.value = null;
  cell.pencil_marks.clear();
  clearHint();
  render();
}

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input")) return;
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
});

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

function loadBoard(data) {
  cells = data.cells.map((c) => ({
    value: c.value ?? null,
    is_given: !!c.is_given,
    pencil_marks: new Set(c.pencil_marks || []),
    low_confidence: !!c.low_confidence,
  }));
  clearHint();
  render();
}

// --- hints ----------------------------------------------------------------
function clearHint() {
  currentHint = null;
  revealLevel = 0;
  applyBtn.disabled = true;
  revealEl.hidden = true;
  hintEl.className = "hint empty";
  hintEl.textContent = "No hint yet.";
}

async function getHint() {
  const res = await fetch("/hint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toPayload()),
  });
  const data = await res.json();
  if (!data.ok) {
    currentHint = null;
    revealEl.hidden = true;
    applyBtn.disabled = true;
    hintEl.className = "hint";
    hintEl.innerHTML = `<span class="warn">${data.reason}</span>`;
    return;
  }
  currentHint = data;
  revealLevel = 1;
  applyBtn.disabled = false;
  revealEl.hidden = false;
  showReveal();
}

function showReveal() {
  const { nudge, technique, hint } = currentHint;
  let html = "";
  if (revealLevel >= 1) html += `<div>${nudge}</div>`;
  if (revealLevel >= 2) html += `<div class="tech">${technique}</div>`;
  if (revealLevel >= 3) html += `<div>${hint.explanation}</div>`;
  hintEl.className = "hint";
  hintEl.innerHTML = html;
  revealEl.querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.level) === revealLevel)
  );
  render(); // refresh highlights for level 3
}

function applyStep() {
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
let lastImageFile = null;

async function sendImage(file) {
  lastImageFile = file;
  document.getElementById("confirmRead").disabled = true;
  dropStatus.textContent = "Reading board…";
  const fd = new FormData();
  fd.append("image", file);
  try {
    const res = await fetch("/parse", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      dropStatus.textContent = data.detail || data.reason || "Could not read the image.";
      return;
    }
    loadBoard(data.board);
    document.getElementById("confirmRead").disabled = false;
    const low = data.board.cells.filter((c) => c.low_confidence).length;
    dropStatus.textContent = low
      ? `Read board — ${low} cell(s) flagged low-confidence (outlined red). Please check them.`
      : "Read board — please verify before requesting a hint.";
  } catch (err) {
    dropStatus.textContent = "Upload failed: " + err.message;
  }
}

async function confirmReading() {
  if (!lastImageFile) return;
  const fd = new FormData();
  fd.append("image", lastImageFile);
  fd.append("board", JSON.stringify(toPayload()));
  dropStatus.textContent = "Learning from your corrections…";
  try {
    const res = await fetch("/confirm", { method: "POST", body: fd });
    const data = await res.json();
    dropStatus.textContent = data.ok
      ? `Thanks — learned ${data.learned} digit example(s). Future reads will improve.`
      : data.detail || "Could not learn from this board.";
  } catch (err) {
    dropStatus.textContent = "Confirm failed: " + err.message;
  }
}

// --- wiring ---------------------------------------------------------------
const drop = document.getElementById("drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = e.dataTransfer.files[0];
  if (f) sendImage(f);
});
document.getElementById("file").addEventListener("change", (e) => {
  if (e.target.files[0]) sendImage(e.target.files[0]);
});
window.addEventListener("paste", (e) => {
  const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
  if (item) sendImage(item.getAsFile());
});

document.querySelectorAll(".mode").forEach((b) =>
  b.addEventListener("click", () => setMode(b.dataset.mode))
);
document.getElementById("getHint").addEventListener("click", getHint);
document.getElementById("confirmRead").addEventListener("click", confirmReading);
applyBtn.addEventListener("click", applyStep);
document.getElementById("clear").addEventListener("click", () => {
  cells = makeEmpty();
  clearHint();
  render();
});
revealEl.querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => {
    revealLevel = Number(b.dataset.level);
    showReveal();
  })
);

buildGrid();
render();
