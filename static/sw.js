// Service worker, here for two jobs: receiving screenshots from the Android
// share sheet, and keeping the app usable with no network at all.
//
// **The share handoff.** The manifest declares a share target at POST /share.
// When the user shares a screenshot into the installed app, Chrome posts it
// here as multipart form data — but a POST cannot render the app, so the file
// is stashed and the browser redirected to the ordinary page, which picks it up
// (see web/pwa.ts).
//
// Doing the handoff in a worker rather than server-side is what lets the
// screenshot travel the exact code path a dropped or pasted one already
// travels, error messages and all.
//
// **Offline hinting.** Every puzzle is reasoned about in the browser now: the
// board models, the technique catalogues, hinting, solving and the mistake
// audit all live inside static/dist/app.js. Nothing about answering a board
// needs the server, so the only thing standing between the player and an
// offline hint is loading the page. Precaching the shell on install removes it,
// and from the first launch rather than only after a lucky online visit. What
// "the shell" means is SHELL_ASSETS below, and nowhere else.
//
// Classic and Killer screenshots are both read in the page now (web/reader/),
// and so is the choice between the two readers for a shared screenshot
// (web/reader/share-dispatch.ts), so no screenshot path needs a network
// request at all. Nothing here has to keep a route off the cache for the sake
// of one.
//
// The reader's own assets — the OpenCV runtime under /static/vendor/opencv/ and
// the digit exemplars under /static/reader/ — are not precached: they are
// several megabytes that only a player who reads a screenshot ever needs, so
// they are left to the ordinary HTTP cache for now.

const SHARE_CACHE = "shared-image";
const SHARE_KEY = "/shared-image";

// What actually refreshes a deployed asset is the background revalidation in
// serveFromCache: the names here are fixed paths with no content hash, so every
// launch re-fetches them and the next one gets the new build.
//
// The version in the cache name is the coarser lever, and nothing bumps it
// automatically — bump it by hand when a release has to land at once rather
// than one launch late, or when the precache list itself changes. A new worker
// precaches into a cache of its own and deletes every older one as it
// activates, so the previous deploy does not linger in the player's storage.
const SHELL_CACHE = "app-shell-v1";

// The app shell and the engine. `/` rather than `/static/index.html` because
// that is what a navigation asks for and what the cache is then keyed by.
const SHELL_ASSETS = [
  "/",
  "/static/dist/app.js",
  "/static/style.css",
  "/manifest.webmanifest",
];

// Take over as soon as possible: a share can arrive on the very next launch,
// and a worker still waiting behind an old one would miss the POST.
self.addEventListener("install", (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([dropOldCaches(), self.clients.claim()]));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/share") {
    event.respondWith(receiveShare(request));
    return;
  }
  const key = shellKey(request, url);
  if (key) event.respondWith(serveFromCache(event, key));
  // Everything else — the reader endpoints above all — falls through to the
  // network untouched.
});

// --- offline shell ---------------------------------------------------------

async function precache() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(SHELL_ASSETS);
}

async function dropOldCaches() {
  const names = await caches.keys();
  // The share stash is not versioned: a screenshot can arrive moments before a
  // new worker activates, and dropping it would drop the share with it.
  const stale = names.filter((name) => name !== SHELL_CACHE && name !== SHARE_CACHE);
  await Promise.all(stale.map((name) => caches.delete(name)));
}

/**
 * The cache key `request` should be served from, or null to leave it alone.
 *
 * A navigation is answered with the cached page whatever its URL: the share
 * redirect lands on /?shared=1, and an offline launch from the home screen can
 * start anywhere in scope. index.html carries no per-URL markup, so one copy
 * serves them all.
 */
function shellKey(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin) return null;
  if (request.mode === "navigate") return new URL("/", self.location.origin).href;
  return SHELL_ASSETS.includes(url.pathname) ? url.href : null;
}

/**
 * Answer from the cache, refreshing it from the network behind the response.
 *
 * Cache-first is what makes an offline launch instant and certain; the
 * revalidation behind it is what keeps a deploy from being pinned in the
 * player's storage until the version above changes. The cost is that a new
 * build is picked up on the launch *after* the one that fetched it, which for
 * a puzzle helper is a fair trade for never showing a spinner over the board.
 */
async function serveFromCache(event, key) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(key);

  const fresh = fetch(event.request)
    .then(async (response) => {
      // A 404 or a captive portal's login page must not replace a good copy.
      if (response && response.ok) await cache.put(key, response.clone());
      return response;
    })
    .catch(() => undefined);

  // The refresh outlives the response it hides behind, so the browser has to be
  // told to keep the worker alive for it. Without this, a worker shut down the
  // moment respondWith settles never reaches the cache.put, and the app stays
  // pinned to the build it first installed.
  event.waitUntil(fresh);

  if (cached) return cached;
  const response = await fresh;
  return response || offlineResponse();
}

// Reached only when the network is gone *and* the asset was never cached —
// a worker that took over before its precache finished, say. A plain body says
// more than a dead tab.
const offlineResponse = () =>
  new Response("This app is offline and hasn't finished installing yet.", {
    status: 503,
    headers: { "content-type": "text/plain" },
  });

// --- share handoff ---------------------------------------------------------

async function receiveShare(request) {
  try {
    const shared = await request.formData();
    const file = shared.get("image");
    if (file && file.size) {
      const cache = await caches.open(SHARE_CACHE);
      // A Response is the only thing the Cache API stores, and it happens to
      // carry the blob and its type together, which is all the page needs.
      await cache.put(SHARE_KEY, new Response(file, {
        headers: { "content-type": file.type || "image/png" },
      }));
      return redirectToApp("1");
    }
  } catch (err) {
    // Fall through: the page says something useful, which beats a dead tab.
  }
  return redirectToApp("error");
}

// 303 so the browser turns the POST into a GET; any other redirect code would
// re-post the image to the app's own start URL.
//
// The target is spelled out against the worker's own origin rather than left
// relative. A browser would resolve a relative one against the worker's URL,
// but only a browser would — being explicit is what lets this run under test.
const redirectToApp = (state) =>
  Response.redirect(new URL(`/?shared=${state}`, self.location.origin), 303);
