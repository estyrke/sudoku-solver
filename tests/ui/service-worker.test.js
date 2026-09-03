// sw.js, run outside a browser.
//
// This is the only part of the share path that never executes in the other
// tests: jsdom has no service worker, so share-target.test.js necessarily
// starts from *after* the redirect and stubs the cache the worker filled. The
// worker is what fills it, and a mistake in here — the wrong cache key, a 302
// instead of a 303 — would leave those tests passing and sharing broken on the
// phone.
//
// Node has fetch's Request, Response, FormData and Blob built in, so the worker
// only needs `self` and `caches` supplied to run for real in a vm sandbox.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { ROOT } = require("./harness");

const SOURCE = fs.readFileSync(path.join(ROOT, "static/sw.js"), "utf8");
const ORIGIN = "https://puzzles.example";

/** Load sw.js into a sandbox, returning its handlers and the cache it writes. */
function loadWorker() {
  const stored = new Map();
  const cache = {
    put: async (key, response) => stored.set(key, response),
    match: async (key) => stored.get(key),
    delete: async (key) => stored.delete(key),
  };

  const handlers = {};
  const sandbox = {
    self: {
      addEventListener: (type, fn) => (handlers[type] = fn),
      location: { origin: ORIGIN },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
    caches: { open: async () => cache },
    Response,
    Request,
    URL,
    FormData,
    Blob,
    Headers,
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);
  return { handlers, stored };
}

/** Post `file` to /share the way Chrome's share sheet does, and await the reply. */
async function postShare(handlers, file, { field = "image", method = "POST" } = {}) {
  const form = new FormData();
  if (file) form.append(field, file);

  let responded;
  handlers.fetch({
    request: new Request(`${ORIGIN}/share`, method === "POST" ? { method, body: form } : { method }),
    respondWith: (value) => (responded = value),
  });
  return responded === undefined ? undefined : await responded;
}

const screenshot = () =>
  new File([new Uint8Array([137, 80, 78, 71])], "Screenshot.png", { type: "image/png" });

describe("share target service worker", () => {
  it("registers a fetch handler", () => {
    // Chrome has historically required one before it will offer to install,
    // and without an install there is no share target at all.
    assert.equal(typeof loadWorker().handlers.fetch, "function");
  });

  it("stashes the shared screenshot where the page looks for it", async () => {
    const { handlers, stored } = loadWorker();
    await postShare(handlers, screenshot());

    assert.deepEqual([...stored.keys()], ["/shared-image"]);
    const kept = stored.get("/shared-image");
    assert.equal(kept.headers.get("content-type"), "image/png");
    assert.equal((await kept.arrayBuffer()).byteLength, 4, "the bytes survive the round trip");
  });

  it("redirects with a 303, turning the POST into a GET", async () => {
    // On a 302 the browser may re-post the image to the app's start URL, which
    // lands on a route that does not accept it.
    const { handlers } = loadWorker();
    const res = await postShare(handlers, screenshot());

    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `${ORIGIN}/?shared=1`);
  });

  it("still reaches the app when the share carried no file", async () => {
    const { handlers, stored } = loadWorker();
    const res = await postShare(handlers, null);

    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `${ORIGIN}/?shared=error`);
    assert.equal(stored.size, 0);
  });

  it("reports an empty file as an error rather than stashing it", async () => {
    const { handlers, stored } = loadWorker();
    const res = await postShare(handlers, new File([], "empty.png", { type: "image/png" }));

    assert.match(res.headers.get("location"), /shared=error/);
    assert.equal(stored.size, 0);
  });

  it("ignores a POST to any other path", async () => {
    const { handlers } = loadWorker();
    let responded;
    handlers.fetch({
      request: new Request(`${ORIGIN}/killer/parse`, { method: "POST", body: new FormData() }),
      respondWith: (value) => (responded = value),
    });
    assert.equal(responded, undefined, "the app's own uploads must go to the network");
  });

  it("ignores a GET of /share", async () => {
    // That one belongs to the server, which serves the app so a share without a
    // registered worker is not a 404.
    const { handlers } = loadWorker();
    assert.equal(await postShare(handlers, null, { method: "GET" }), undefined);
  });
});
