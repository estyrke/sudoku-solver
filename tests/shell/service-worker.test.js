// sw.js, run outside a browser.
//
// Two jobs are under test here: the share handoff, and the offline precache.
//
// The share half is the only part of that path that never executes in the other
// tests: jsdom has no service worker, so share-target.test.js necessarily
// starts from *after* the redirect and stubs the cache the worker filled. The
// worker is what fills it, and a mistake in here — the wrong cache key, a 302
// instead of a 303 — would leave those tests passing and sharing broken on the
// phone.
//
// The precache half has no other home either: jsdom has no worker, and the
// behaviour that matters — a shell served from cache with the network gone — is
// invisible to every test that boots the page, because the page under jsdom
// never loads through a worker at all.
//
// Node has fetch's Request, Response, FormData and Blob built in, so the worker
// only needs `self`, `caches` and `fetch` supplied to run for real in a vm
// sandbox.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");

const SOURCE = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");
const ORIGIN = "https://puzzles.example";

/**
 * Load sw.js into a sandbox, returning its handlers and the caches it writes.
 *
 * @param {object}   [opts]
 * @param {Function} [opts.fetch]  stands in for the network; default serves
 *                                 every request a body naming its URL
 * @param {object}   [opts.seed]   cache name -> Map of key -> Response, for
 *                                 standing in as a previous version's caches
 */
function loadWorker({ fetch: net, seed = {} } = {}) {
  // The share stash is created up front so tests can hold onto the same Map the
  // worker writes into, rather than a fresh one made on first open.
  const caches = new Map([["shared-image", new Map()]]);
  for (const [name, entries] of Object.entries(seed)) caches.set(name, new Map(entries));

  const openCache = (name) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const stored = caches.get(name);
    return {
      put: async (key, response) => stored.set(keyOf(key), response),
      match: async (key) => stored.get(keyOf(key)),
      delete: async (key) => stored.delete(keyOf(key)),
      addAll: async (keys) => {
        for (const key of keys) stored.set(keyOf(key), await net(new Request(absolute(key))));
      },
      keys: async () => [...stored.keys()].map((key) => new Request(absolute(key))),
    };
  };

  const requested = [];
  const inFlight = [];
  net = net || (async (request) => new Response(`fresh ${urlOf(request)}`, { status: 200 }));
  const network = (request) => {
    requested.push(urlOf(request));
    // A revalidation is deliberately not awaited by the worker — it updates the
    // cache behind the response it already gave. Hold onto it so a test can.
    const pending = net(request);
    inFlight.push(pending.catch(() => {}));
    return pending;
  };

  const handlers = {};
  const sandbox = {
    self: {
      addEventListener: (type, fn) => (handlers[type] = fn),
      location: { origin: ORIGIN },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open: async (name) => openCache(name),
      keys: async () => [...caches.keys()],
      delete: async (name) => caches.delete(name),
    },
    fetch: network,
    Response,
    Request,
    URL,
    FormData,
    Blob,
    Headers,
  };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);

  const named = (name) => caches.get(name) || new Map();
  return {
    handlers,
    caches,
    requested,
    /** Wait for the revalidations the worker fired off but did not await. */
    settled: async () => {
      await Promise.all(inFlight);
      await new Promise((resolve) => setImmediate(resolve));
    },
    /** The share stash, which is what the share tests below assert on. */
    get stored() {
      return named("shared-image");
    },
    /** The one cache holding the precached shell, whatever it is versioned as. */
    shell: () => {
      const names = [...caches.keys()].filter((name) => name !== "shared-image");
      assert.equal(names.length, 1, `exactly one shell cache, got ${names}`);
      const entries = named(names[0]);
      return {
        name: names[0],
        entries,
        // Keys are absolute URLs; tests say what they mean in paths.
        has: (path) => entries.has(absolute(path)),
        get: (path) => entries.get(absolute(path)),
      };
    },
  };
}

const urlOf = (request) => (typeof request === "string" ? request : request.url);
/**
 * Cache keys, compared by absolute URL including the query — what the real
 * Cache API does unless asked otherwise. Keying by path instead would quietly
 * excuse a worker that stored `/?shared=1` and expected `/` to find it.
 */
const keyOf = (key) => new URL(urlOf(key), ORIGIN).href;
const absolute = keyOf;

/** Run the install (and then activate) handler to completion. */
async function lifecycle(handlers, { activate = true } = {}) {
  const run = async (fn) => {
    if (!fn) return;
    const waits = [];
    await fn({ waitUntil: (value) => waits.push(value) });
    await Promise.all(waits);
  };
  await run(handlers.install);
  if (activate) await run(handlers.activate);
}

/**
 * Ask the worker for `path` the way a browser would, and await what it answers.
 *
 * A plain object rather than a `Request`: Node refuses to construct one with
 * mode "navigate", which is exactly the mode that distinguishes a page load
 * from a fetch for an asset. The worker reads `url`, `method` and `mode`.
 */
async function get(handlers, path, { method = "GET", mode = "no-cors" } = {}) {
  let responded;
  handlers.fetch({
    request: { url: new URL(path, ORIGIN).href, method, mode },
    respondWith: (value) => (responded = value),
    waitUntil: () => {},
  });
  return responded === undefined ? undefined : await responded;
}

/** Post `file` to /share the way Chrome's share sheet does, and await the reply. */
async function postShare(handlers, file, { field = "image", method = "POST" } = {}) {
  const form = new FormData();
  if (file) form.append(field, file);

  let responded;
  handlers.fetch({
    request: new Request(`${ORIGIN}/share`, method === "POST" ? { method, body: form } : { method }),
    respondWith: (value) => (responded = value),
    waitUntil: () => {},
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

    assert.deepEqual([...stored.keys()], [`${ORIGIN}/shared-image`]);
    const kept = stored.get(`${ORIGIN}/shared-image`);
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
    const location = new URL(res.headers.get("location"));
    assert.equal(location.origin + location.pathname, `${ORIGIN}/`);
    assert.equal(location.searchParams.get("shared"), "error");
    // No file field at all is a different cause than a field with an empty
    // file, and `why` is what keeps the two from looking identical on a
    // real device's failure.
    assert.equal(location.searchParams.get("why"), "no-image-field:none");
    assert.equal(stored.size, 0);
  });

  it("reports an empty file as an error rather than stashing it", async () => {
    const { handlers, stored } = loadWorker();
    const res = await postShare(handlers, new File([], "empty.png", { type: "image/png" }));

    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("shared"), "error");
    assert.equal(location.searchParams.get("why"), "empty:empty.png");
    assert.equal(stored.size, 0);
  });

  it("names the fields it actually received when none of them is the image", async () => {
    const { handlers, stored } = loadWorker();
    const res = await postShare(handlers, screenshot(), { field: "photo" });

    const location = new URL(res.headers.get("location"));
    assert.equal(location.searchParams.get("why"), "no-image-field:photo");
    assert.equal(stored.size, 0);
  });

  it("ignores a POST to any other path", async () => {
    // The worker owns exactly one POST, the share. Nothing else in the app
    // posts anywhere — there is no server to post to — so anything that turns
    // up here is something the worker has no business answering for.
    const { handlers } = loadWorker();
    let responded;
    handlers.fetch({
      request: new Request(`${ORIGIN}/anything-else`, { method: "POST", body: new FormData() }),
      respondWith: (value) => (responded = value),
      waitUntil: () => {},
    });
    assert.equal(responded, undefined, "the worker answers for POST /share and nothing else");
  });

  it("ignores a GET of /share", async () => {
    // That one belongs to the host, which rewrites it to the app so a share
    // arriving without a registered worker is not a 404 — see the same
    // rationale from the configuration's side in hosting.test.js.
    const { handlers } = loadWorker();
    assert.equal(await postShare(handlers, null, { method: "GET" }), undefined);
  });
});

describe("offline precache", () => {
  const offline = async () => {
    throw new TypeError("Failed to fetch");
  };

  it("precaches the app shell and the engine bundle on install", async () => {
    const worker = loadWorker();
    await lifecycle(worker.handlers);

    const shell = worker.shell();
    // The bundle is the engine: hinting and solving are inside app.js, so a
    // shell cached without it loads a page that cannot answer anything.
    assert.ok(shell.has("/assets/app.js"), "the engine bundle is precached");
    assert.ok(shell.has("/"), "so is the page itself");
    assert.ok(shell.has("/style.css"), "and its stylesheet");
    assert.ok(shell.has("/manifest.webmanifest"), "and the manifest, so an offline launch is still installable");
  });

  it("serves the shell from cache when the network is gone", async () => {
    const worker = loadWorker();
    await lifecycle(worker.handlers);

    const dead = loadWorker({ fetch: offline, seed: Object.fromEntries(worker.caches) });
    const page = await get(dead.handlers, "/", { mode: "navigate" });
    const bundle = await get(dead.handlers, "/assets/app.js");

    assert.equal(page.status, 200);
    assert.equal(await page.text(), `fresh ${ORIGIN}/`);
    assert.equal(await bundle.text(), `fresh ${ORIGIN}/assets/app.js`);
  });

  it("serves a navigation to any in-scope URL from the cached page", async () => {
    // The share redirect lands on /?shared=1, and an offline install opened
    // from the home screen may start anywhere under the manifest's scope.
    const worker = loadWorker();
    await lifecycle(worker.handlers);

    const dead = loadWorker({ fetch: offline, seed: Object.fromEntries(worker.caches) });
    const landed = await get(dead.handlers, "/?shared=1", { mode: "navigate" });

    assert.equal(await landed.text(), `fresh ${ORIGIN}/`);
  });

  it("refreshes a cached asset from the network when there is one", async () => {
    const worker = loadWorker();
    await lifecycle(worker.handlers);
    const before = await worker.shell().get("/assets/app.js").clone().text();

    const next = loadWorker({
      fetch: async () => new Response("a newer build", { status: 200 }),
      seed: Object.fromEntries(worker.caches),
    });
    const served = await get(next.handlers, "/assets/app.js");
    await next.settled();

    assert.equal(await served.text(), before, "the cached copy answers now");
    assert.equal(
      await next.shell().get("/assets/app.js").clone().text(),
      "a newer build",
      "and the new one is in the cache for next launch",
    );
  });

  it("keeps itself alive for the refresh it fired off", async () => {
    // respondWith settles on the cached copy immediately; the browser is free
    // to shut the worker down the moment it does. Only waitUntil stops it, and
    // without that the cache.put behind the response may never run — leaving
    // the player pinned to the build they first installed.
    const worker = loadWorker();
    await lifecycle(worker.handlers);

    const next = loadWorker({
      fetch: async () => new Response("a newer build", { status: 200 }),
      seed: Object.fromEntries(worker.caches),
    });
    const kept = [];
    next.handlers.fetch({
      request: { url: `${ORIGIN}/assets/app.js`, method: "GET", mode: "no-cors" },
      respondWith: () => {},
      waitUntil: (value) => kept.push(value),
    });
    await next.settled();

    assert.equal(kept.length, 1, "the revalidation was handed to waitUntil");
  });

  it("does not leave a failed revalidation in the cache", async () => {
    const worker = loadWorker();
    await lifecycle(worker.handlers);

    const dead = loadWorker({ fetch: offline, seed: Object.fromEntries(worker.caches) });
    await get(dead.handlers, "/assets/app.js");
    await dead.settled();

    assert.equal(
      await dead.shell().get("/assets/app.js").clone().text(),
      `fresh ${ORIGIN}/assets/app.js`,
      "the good copy survives an offline launch",
    );
  });

  it("drops a previous version's shell cache on activate", async () => {
    // Otherwise every deploy leaves its bundle behind in the user's storage.
    const worker = loadWorker({
      seed: { "app-shell-stale": [[`${ORIGIN}/assets/app.js`, null]] },
    });
    await lifecycle(worker.handlers);

    assert.ok(!worker.caches.has("app-shell-stale"), "the old cache is gone");
    assert.ok(worker.shell().has("/assets/app.js"), "replaced, not just deleted");
  });

  it("keeps the share stash across an upgrade", async () => {
    // It is not versioned: a share can arrive moments before a new worker
    // activates, and losing it would lose the screenshot.
    const worker = loadWorker({ seed: { "shared-image": [[`${ORIGIN}/shared-image`, "kept"]] } });
    await lifecycle(worker.handlers);

    assert.equal(worker.stored.get(`${ORIGIN}/shared-image`), "kept");
  });

});
