# The Android share target hands off through a service worker

Sharing a screenshot into the app from Android's share sheet requires the Web Share Target API, which posts the image as `multipart/form-data` to an action URL declared in the web app manifest. A POST cannot render the app, so something has to receive the file and get the user to a page.

Two mechanisms were available. The server could own `POST /share` directly — natural here, since a FastAPI server already exists and already reads screenshots. Instead a service worker intercepts the POST, stashes the file in the Cache API, and redirects to `/?shared=1`, where ordinary page code picks it up.

The deciding argument is that the screenshot then travels the *same* path a dropped or pasted one travels. `static/killer.js` already knew how to take a parsed reading and render it, warnings and all — uncaged cells, doubtful sums, the 405 checksum mismatch. The server-side alternative would have had to render a page with the board already loaded, and with it a second copy of that reporting, which would drift. What the two paths now share is a single `applyParsed`.

This also keeps the share path honest about failure: a screenshot that reads badly says so in the same words it would have said them in anyway.

## Consequences

- A service worker exists in an app that is not offline-capable and caches nothing. Its sole job is the share handoff; `static/sw.js` says so, because the obvious reading of "there's a service worker" is otherwise wrong.
- `sw.js` must be served from the root (`app.py` routes it explicitly) — a worker's scope is the directory it is served from, and one under `/static` could not intercept `/share`.
- The form field name `image` is now load-bearing across four places: the manifest declares it, Chrome posts under it, the worker reads it back, and `/share/parse` expects it. `tests/test_app.py` asserts they agree.
- Changing the share `action` after users have installed the app does not reach existing installs; the share target is registered with the OS at install time and re-registered on reinstall.
- Android only. iOS Safari does not implement share targets, and neither does Firefox for Android.
- One share target must serve two readers, so `/share/parse` decides which by counting cages. That is a reversible choice — a chooser in the UI would do as well — and it is the piece most likely to want revisiting if a third puzzle type ever accepts screenshots.
