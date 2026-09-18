# The screenshot reader runs in the browser, on a custom OpenCV.js build

Reading a board from a screenshot was the last thing the app did on a server. Every engine
had already moved into the browser (ADR 0004, and the ports before it), so what remained
was a FastAPI app whose only real job was to accept an uploaded PNG, run OpenCV over it and
send a board back. That one job was the reason the project still needed a Python runtime, a
serverless function and — at the exact moment a player most wants the app — a network
connection: they have just screenshotted a puzzle and want to get on with it.

It was also the slowest path in the app, and the least defensible one. The screenshot was
uploaded, decoded server-side, processed, and a board came back — a round trip carrying an
image, for work that is a few dozen milliseconds of arithmetic on pixels the device already
had.

We **ported the reader to TypeScript and run it in the page on a custom OpenCV.js build**,
committed as a versioned artifact under `public/vendor/opencv/`. Grid detection, cell
parsing, digit classification and the Killer cage reader all run on the device; the Python
reader, the server and the runtime are deleted. The reader takes decoded pixels — width,
height, RGBA — and returns a board, leaving decoding to its caller, which in the browser
means the platform's own image codecs and in tests a small PNG decoder.

The bar for the port was strict parity, not improvement. Every threshold carried over at
its current value, and six reference screenshots are pinned cage-for-cage, sum-for-sum and
digit-for-digit to the boards the Python reader produced from them (`tests/reader/`). That
pinning is what made the port a claim a test could fail rather than a judgement call.

## Consequences

- **Several megabytes, paid once and only by readers.** The custom build is core and
  imgproc only — the default build's size is dominated by the deep-neural-network and photo
  modules, which the reader does not use — with SIMD on and the WASM emitted as a standalone
  file rather than inlined, so it caches independently of the app bundle. It and the digit
  exemplars are fetched on the *first* read rather than precached with the shell, so
  installing stays fast and a player who never reads a screenshot never pays for it. See
  `docs/opencv-js-build.md` for the build and `docs/reader-assets.md` for the exemplars.
- **The page shows that first load happening.** A several-megabyte download with no
  feedback is indistinguishable from a frozen tab.
- **A first read with no connection fails**, and says so in the reader's words rather than
  the network's. That is the deliberate price of not precaching the runtime; every read
  after the first works offline, as does everything else in the app.
- **The build is committed, not compiled by CI.** Compiling OpenCV takes tens of minutes,
  and the output has to be byte-identical for developers and CI or the two stop classifying
  the same screenshot the same way. `tests/cv/` loads the committed artifact and converts a
  small image, which is the cheapest way to catch a regeneration that was linked without a
  module the reader needs or committed without its `.wasm`.
- **Whatever the browser can decode, the reader can read.** Decoding is the caller's
  problem, so format support is the platform's — including formats OpenCV itself would not
  decode. This is strictly wider than what the upload path managed.
- **No Python runtime, and the app deploys as static files.** What is left of Python is a
  tooling island for work that genuinely happens offline: drawing the icons, and the model
  training pipeline that replaces template matching next. The four routes the server
  declared are host configuration now — see ADR 0003.
- **Recognition got no smarter.** Normalized cross-correlation against the seeded exemplars
  is carried over as-is, including the slanted copies that resolve the app's italic 1 and
  the real glyphs lifted from screenshots for its open-topped 4 and its cage-sum 6. Every
  threshold that was app-specific is still app-specific. Improving any of that belongs to
  the classifier that replaces this one.
- **The self-calibration loop is gone with the server.** `/confirm`, the exemplar learning
  module, the per-device store and the **Confirm reading** control are deleted; only the
  *seeded* exemplars remain, and they are what recognition runs on. It existed to
  compensate for template matching being font-brittle, and a per-device store that never
  synced is a worse version of a feature the trained classifier makes unnecessary. This is
  the one thing a player lost in the port, and the mitigation is sequencing: if the
  classifier slips, the app will have spent a release with neither adaptation nor a better
  reader. See `web/queens/docs/adr/0002-no-reader-calibration-loop.md`, which reached the
  same conclusion for the Queens reader from the other direction.
- **The likeliest divergence was always pixel arithmetic** — rounding in the perspective
  warp, interpolation on resize, integer-versus-float division in the sub-grid geometry —
  and the port matches the Python's choices rather than picking reasonable equivalents.
  `web/reader/pixels.ts` exists for exactly that: Python's round-half-to-even and the
  copies numpy makes implicitly, written out.
