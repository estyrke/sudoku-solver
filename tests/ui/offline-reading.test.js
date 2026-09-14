// Reading a screenshot with no network.
//
// Both tabs read in the page now (web/reader/), so there is no network to
// lose for either: these tests pin that, by booting with a `fetch` that
// records every call and asserting the reading path never reaches it.
//
// The share dispatcher is still server-side, and that is what keeps the last
// test in this file: offline that request cannot run, and `fetch` rejects
// with a bare "Failed to fetch" that reads like a crash. The honest version
// says the connection is the problem, and says that the rest of the app still
// works.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { boot } = require("./harness");

/** Boot a tab with the network gone, and paste a screenshot into its drop zone. */
async function pasteOffline(tab, { onLine = false, fetch } = {}) {
  const calls = [];
  const ui = await boot({
    activate: tab,
    fetch: async (url, options) => {
      calls.push(url);
      if (fetch) return fetch(url, options);
      // What a browser does offline: a TypeError, with no response at all.
      throw new TypeError("Failed to fetch");
    },
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
  ui.calls = calls;
  return ui;
}

const statusOf = (ui, id) => ui.document.getElementById(id);

describe("reading a screenshot offline", () => {
  it("never uploads a classic screenshot", async () => {
    // The whole point of the port: the screenshot stays on the device. The
    // upload was the first thing the old path did — before decoding, before
    // anything — so its absence here is the assertion, and it is the one this
    // test can actually make: jsdom has no image decoder, so the read stops at
    // `decodeImageFile` and never reaches the reader's own assets (the OpenCV
    // runtime and the digit exemplars, fetched once on a first real read and
    // deliberately not precached — see static/sw.js). Those are not on trial
    // here; uploading the player's screenshot is.
    const ui = await pasteOffline("sudoku");

    assert.deepEqual(ui.calls, [], "reading a screenshot must not upload it");
  });

  it("does not blame the connection when the Sudoku reader fails", async () => {
    // Being offline has nothing to do with it any more, so a message saying so
    // would send the player looking in the wrong place. The reader's own words
    // instead, whatever they are.
    const ui = await pasteOffline("sudoku");
    const status = statusOf(ui, "dropStatus");

    assert.match(status.textContent, /could not read/i);
    assert.doesNotMatch(status.textContent, /offline/i);
    assert.doesNotMatch(status.textContent, /Failed to fetch/);
  });

  it("never uploads a killer screenshot", async () => {
    // Same port, same point, for the Killer reader (web/reader/killer-board.ts):
    // the screenshot stays on the device. jsdom has no image decoder, so the
    // read stops at `decodeImageFile` and never reaches the reader's own
    // assets; uploading the player's screenshot is what is on trial here.
    const ui = await pasteOffline("killer");

    assert.deepEqual(ui.calls, [], "reading a screenshot must not upload it");
  });

  it("does not blame the connection when the Killer reader fails", async () => {
    // Being offline has nothing to do with it any more, so a message saying so
    // would send the player looking in the wrong place. The reader's own words
    // instead, whatever they are.
    const ui = await pasteOffline("killer");
    const status = statusOf(ui, "kDropStatus");

    assert.match(status.textContent, /could not read/i);
    assert.doesNotMatch(status.textContent, /offline/i);
    assert.doesNotMatch(status.textContent, /Failed to fetch/);
  });

  it("says it about a shared screenshot too", async () => {
    // A share arrives while the app is open; the phone can be offline by then.
    // The share dispatcher is still server-side, so this one is still a lost
    // connection rather than a reader failure.
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
