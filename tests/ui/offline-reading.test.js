// Reading a screenshot with no network.
//
// Hinting and solving are local now, so the app is expected to work offline —
// which is exactly what makes the one remaining server-side path a trap. The
// reader lives on the server, so offline it cannot run, and `fetch` rejects
// with a bare "Failed to fetch" that reads like a crash. These tests pin the
// honest version: say the connection is the problem, and say that the rest of
// the app still works.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { boot } = require("./harness");

/** Boot a tab with the network gone, and paste a screenshot into its drop zone. */
async function pasteOffline(tab, { onLine = false, fetch } = {}) {
  const ui = await boot({
    activate: tab,
    fetch:
      fetch ||
      (async () => {
        // What a browser does offline: a TypeError, with no response at all.
        throw new TypeError("Failed to fetch");
      }),
    setUp(window) {
      Object.defineProperty(window.navigator, "onLine", { value: onLine, configurable: true });
    },
  });

  const { window } = ui;
  const file = new window.File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
    type: "image/png",
  });
  const event = new window.Event("paste");
  event.clipboardData = { items: [{ type: "image/png", getAsFile: () => file }] };
  window.dispatchEvent(event);
  await ui.flush();
  await ui.flush();
  return ui;
}

const statusOf = (ui, id) => ui.document.getElementById(id);

describe("reading a screenshot offline", () => {
  it("tells the Sudoku player the network is what is missing", async () => {
    const ui = await pasteOffline("sudoku");
    const status = statusOf(ui, "dropStatus");

    assert.match(status.textContent, /offline|connection/i);
    // The point of the message: the app is not broken, only this one path is.
    assert.match(status.textContent, /hint|solve/i);
    assert.doesNotMatch(status.textContent, /Failed to fetch/);
  });

  it("tells the Killer player the same thing", async () => {
    const ui = await pasteOffline("killer");
    const status = statusOf(ui, "kDropStatus");

    assert.match(status.textContent, /offline|connection/i);
    assert.match(status.textContent, /hint|solve/i);
    assert.ok(status.classList.contains("error"), "and shows it as a failure");
  });

  it("still reports an ordinary reader failure in the reader's own words", async () => {
    // Only a network failure gets the offline wording. A screenshot the reader
    // could not make sense of is a different problem and keeps its message.
    const ui = await pasteOffline("sudoku", {
      onLine: true,
      fetch: async () => ({
        ok: false,
        status: 422,
        json: async () => ({ detail: "Could not read a board from that image: no grid" }),
      }),
    });

    assert.match(statusOf(ui, "dropStatus").textContent, /no grid/);
  });

  it("says it about a shared screenshot too", async () => {
    // A share arrives while the app is open; the phone can be offline by then.
    const ui = await boot({
      activate: null,
      url: "http://localhost/?shared=1",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      setUp(window) {
        Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
        const blob = new window.Blob([new Uint8Array([137])], { type: "image/png" });
        window.caches = {
          open: async () => ({ match: async () => ({ blob: async () => blob }), delete: async () => {} }),
        };
      },
    });
    await ui.flush();
    await ui.flush();

    assert.match(statusOf(ui, "kDropStatus").textContent, /offline|connection/i);
  });
});
