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
// is enforced by the model server-side; the checks here exist only to give
// immediate feedback rather than to be the source of truth.

(function () {
  const N = 9;
  const idx = (r, c) => r * N + c;

  // ---- state -------------------------------------------------------------
  // Module-level, so it survives tab switches (the shell only hides panels).
  let cells = [];
  let cages = [];
  let mode = "cages"; // "cages" | "digits"
  let pen = "pen"; // "pen" | "pencil"
  let selected = null; // {r, c} in digits mode
  let selectedCage = null; // index into `cages` in cages mode
  let dragging = null; // Set of "r,c" keys while dragging
  let unsure = new Set(); // anchors whose sum the reader flagged as doubtful

  function blankCells() {
    return Array.from({ length: N * N }, () => ({ value: null, marks: [] }));
  }

  function reset() {
    cells = blankCells();
    cages = [];
    selected = null;
    selectedCage = null;
    unsure = new Set();
  }

  // ---- cage helpers ------------------------------------------------------

  const key = (r, c) => `${r},${c}`;
  const parseKey = (k) => k.split(",").map(Number);

  function cageIndexAt(r, c) {
    return cages.findIndex((cage) =>
      cage.cells.some(([cr, cc]) => cr === r && cc === c)
    );
  }

  function isContiguous(coords) {
    if (coords.length === 0) return false;
    const want = new Set(coords.map(([r, c]) => key(r, c)));
    const seen = new Set([[...want][0]]);
    const stack = [parseKey([...want][0])];
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [nr, nc] of [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ]) {
        const k = key(nr, nc);
        if (want.has(k) && !seen.has(k)) {
          seen.add(k);
          stack.push([nr, nc]);
        }
      }
    }
    return seen.size === want.size;
  }

  // Smallest/largest total reachable by `size` distinct digits 1-9.
  function sumBounds(size) {
    let lo = 0;
    let hi = 0;
    for (let i = 1; i <= size; i++) lo += i;
    for (let i = 9; i > 9 - size; i--) hi += i;
    return [lo, hi];
  }

  function describeCageProblem(coords, total) {
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
  function cageAnchor(cage) {
    return cage.cells.reduce((best, cur) =>
      cur[0] < best[0] || (cur[0] === best[0] && cur[1] < best[1]) ? cur : best
    );
  }

  // ---- rendering ---------------------------------------------------------

  let boardEl, statusEl, resultEl, sumRow, sumInput, sumLabel, deleteBtn;

  function render() {
    boardEl.innerHTML = "";
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        boardEl.appendChild(renderCell(r, c));
      }
    }
    renderCageEditor();
  }

  function renderCell(r, c) {
    const el = document.createElement("div");
    el.className = "cell kcell";
    el.dataset.r = r;
    el.dataset.c = c;

    const ci = cageIndexAt(r, c);
    if (ci >= 0) {
      const cage = cages[ci];
      const inCage = (rr, cc) =>
        cage.cells.some(([a, b]) => a === rr && b === cc);
      // Dash only the edges that leave the cage, so a cage reads as one outline.
      // All four live on one overlay element: separate ::before/::after
      // pseudo-elements would collide on cells needing two adjacent edges.
      const edge = document.createElement("div");
      edge.className = "cage-edge";
      if (!inCage(r - 1, c)) edge.classList.add("t");
      if (!inCage(r + 1, c)) edge.classList.add("b");
      if (!inCage(r, c - 1)) edge.classList.add("l");
      if (!inCage(r, c + 1)) edge.classList.add("r");
      el.appendChild(edge);
      if (ci === selectedCage) el.classList.add("cage-selected");

      const [ar, ac] = cageAnchor(cage);
      if (unsure.has(key(ar, ac))) el.classList.add("cage-unsure");
      if (ar === r && ac === c) {
        const tag = document.createElement("span");
        tag.className = "cage-sum";
        tag.textContent = cage.sum;
        el.appendChild(tag);
      }
    } else {
      el.classList.add("uncaged");
    }

    if (dragging && dragging.has(key(r, c))) el.classList.add("dragging");
    if (mode === "digits" && selected && selected.r === r && selected.c === c)
      el.classList.add("sel");

    const cell = cells[idx(r, c)];
    if (cell.value != null) {
      const v = document.createElement("span");
      v.className = "val";
      v.textContent = cell.value;
      el.appendChild(v);
    } else if (cell.marks.length) {
      const m = document.createElement("span");
      m.className = "marks";
      m.textContent = cell.marks.slice().sort().join("");
      el.appendChild(m);
    }
    return el;
  }

  function renderCageEditor() {
    const active = selectedCage != null && cages[selectedCage];
    sumRow.hidden = !active;
    if (!active) return;
    const cage = cages[selectedCage];
    sumLabel.textContent = `Cage of ${cage.cells.length} cells`;
    sumInput.value = cage.sum;
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("error", !!isError);
  }

  // ---- cage painting -----------------------------------------------------

  function cellFromEvent(ev) {
    const el = ev.target.closest(".kcell");
    if (!el || !boardEl.contains(el)) return null;
    return { r: Number(el.dataset.r), c: Number(el.dataset.c) };
  }

  function beginDrag(ev) {
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

  function extendDrag(ev) {
    if (!dragging) return;
    const at = cellFromEvent(ev);
    if (!at) return;
    if (cageIndexAt(at.r, at.c) >= 0) return; // don't paint over another cage
    dragging.add(key(at.r, at.c));
    render();
  }

  function endDrag() {
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

  function setDigit(d) {
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
    render();
  }

  function clearCell() {
    if (mode !== "digits" || !selected) return;
    const cell = cells[idx(selected.r, selected.c)];
    cell.value = null;
    cell.marks = [];
    render();
  }

  // ---- server ------------------------------------------------------------

  function toPayload() {
    return {
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
    };
  }

  async function post(url) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload()),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || `Request failed (${res.status})`);
    }
    return data;
  }

  async function doSolve() {
    resultEl.textContent = "Solving…";
    resultEl.classList.remove("empty");
    try {
      const data = await post("/killer/solve");
      if (!data.ok) {
        resultEl.textContent = data.reason;
        return;
      }
      data.board.cells.forEach((cell, i) => {
        cells[i].value = cell.value;
        cells[i].marks = [];
      });
      resultEl.textContent = "Solved.";
      render();
    } catch (err) {
      resultEl.textContent = err.message;
    }
  }

  async function doHint() {
    const hintEl = document.getElementById("kHint");
    hintEl.textContent = "Thinking…";
    hintEl.classList.remove("empty");
    try {
      const data = await post("/killer/hint");
      hintEl.textContent = data.ok
        ? `${data.nudge} (${data.technique})`
        : data.reason;
    } catch (err) {
      hintEl.textContent = err.message;
    }
  }

  // ---- screenshot import -------------------------------------------------

  async function importImage(file, statusEl) {
    if (!file) return;
    statusEl.textContent = "Reading…";
    const body = new FormData();
    body.append("image", file);
    try {
      const res = await fetch("/killer/parse", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        statusEl.textContent = data.detail || `Could not read that image (${res.status}).`;
        return;
      }
      cages = (data.board.cages || []).map((cage) => ({
        cells: cage.cells.map((cell) => [cell.r, cell.c]),
        sum: cage.sum,
      }));
      cells = data.board.cells.map((cell) => ({
        value: cell.value,
        marks: cell.pencil_marks || [],
      }));
      unsure = new Set((data.unsure || []).map((u) => key(u.r, u.c)));
      selected = null;
      selectedCage = null;

      const notes = [`Read ${cages.length} cages.`];
      if (!data.fully_caged)
        notes.push("Some cells aren't in a cage — check the outlines.");
      if (unsure.size)
        notes.push(`${unsure.size} cage sum(s) look doubtful (highlighted).`);
      statusEl.textContent = notes.join(" ");
      setStatus(
        unsure.size
          ? "Click a highlighted cage to correct its sum."
          : "Board read. Check it over, then solve."
      );
      render();
    } catch (err) {
      statusEl.textContent = err.message;
    }
  }

  function wireImport(panel) {
    const drop = panel.querySelector("#kDrop");
    const status = panel.querySelector("#kDropStatus");
    const file = panel.querySelector("#kFile");

    file.addEventListener("change", () => importImage(file.files[0], status));
    drop.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (ev) => {
      ev.preventDefault();
      drop.classList.remove("over");
      importImage(ev.dataTransfer.files[0], status);
    });
    document.addEventListener("paste", (ev) => {
      if (panel.hidden) return;
      const item = [...(ev.clipboardData?.items || [])].find((i) =>
        i.type.startsWith("image/")
      );
      if (item) importImage(item.getAsFile(), status);
    });
  }

  // ---- wiring ------------------------------------------------------------

  function mount(panel) {
    boardEl = panel.querySelector("#kBoard");
    statusEl = panel.querySelector("#kStatus");
    resultEl = panel.querySelector("#kResult");
    sumRow = panel.querySelector("#kSumRow");
    sumInput = panel.querySelector("#kSumInput");
    sumLabel = panel.querySelector("#kSumLabel");
    deleteBtn = panel.querySelector("#kDeleteCage");

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

    panel.querySelectorAll("[data-kmode]").forEach((btn) =>
      btn.addEventListener("click", () => {
        mode = btn.dataset.kmode;
        selected = null;
        selectedCage = null;
        panel
          .querySelectorAll("[data-kmode]")
          .forEach((b) => b.classList.toggle("active", b === btn));
        panel.querySelector("#kDigitControls").hidden = mode !== "digits";
        setStatus(
          mode === "cages"
            ? "Drag across empty cells to make a cage; click a cage to edit it."
            : "Click a cell, then type 1–9. 0 or ⌫ clears."
        );
        render();
      })
    );

    panel.querySelectorAll("[data-kpen]").forEach((btn) =>
      btn.addEventListener("click", () => {
        pen = btn.dataset.kpen;
        panel
          .querySelectorAll("[data-kpen]")
          .forEach((b) => b.classList.toggle("active", b === btn));
      })
    );

    panel.querySelectorAll("#kNumpad [data-digit]").forEach((btn) =>
      btn.addEventListener("click", () => setDigit(Number(btn.dataset.digit)))
    );
    panel.querySelector("#kNumClear").addEventListener("click", clearCell);

    sumInput.addEventListener("change", () => {
      if (selectedCage == null) return;
      const cage = cages[selectedCage];
      const total = Number(sumInput.value);
      const problem = describeCageProblem(cage.cells, total);
      if (problem) {
        setStatus(problem, true);
        sumInput.value = cage.sum;
        return;
      }
      cage.sum = total;
      unsure.delete(key(...cageAnchor(cage)));
      setStatus(`Cage sum updated to ${total}.`);
      render();
    });

    deleteBtn.addEventListener("click", () => {
      if (selectedCage == null) return;
      cages.splice(selectedCage, 1);
      selectedCage = null;
      setStatus("Cage deleted.");
      render();
    });

    wireImport(panel);
    panel.querySelector("#kSolve").addEventListener("click", doSolve);
    panel.querySelector("#kGetHint").addEventListener("click", doHint);
    panel.querySelector("#kClear").addEventListener("click", () => {
      reset();
      setStatus("Board cleared.");
      resultEl.textContent = "No solve yet.";
      resultEl.classList.add("empty");
      render();
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

  window.PuzzleShell.register({ id: "killer", label: "Killer", mount });
})();
