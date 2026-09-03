// Service worker, here for one job: receive screenshots from the Android share
// sheet.
//
// The manifest declares a share target at POST /share. When the user shares a
// screenshot into the installed app, Chrome posts it here as multipart form
// data — but a POST cannot render the app, so the file is stashed and the
// browser redirected to the ordinary page, which picks it up (see pwa.js).
//
// Doing the handoff in a worker rather than server-side is what lets the
// screenshot travel the exact code path a dropped or pasted one already
// travels, error messages and all.
//
// Nothing here caches the app itself: this worker makes the app shareable, not
// offline-capable. The board is reasoned about on the server, so an offline
// mode would be a much bigger change than it looks.

const SHARE_CACHE = "shared-image";
const SHARE_KEY = "/shared-image";

// Take over as soon as possible: a share can arrive on the very next launch,
// and a worker still waiting behind an old one would miss the POST.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === "POST" && url.pathname === "/share") {
    event.respondWith(receiveShare(event.request));
  }
  // Everything else falls through to the network untouched.
});

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
