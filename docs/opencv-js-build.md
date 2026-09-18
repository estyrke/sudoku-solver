# The OpenCV.js artifact

`static/vendor/opencv/` holds a custom OpenCV build — `opencv.js` and
`opencv_js.wasm` — committed to the repository. This page says what is in it,
why it is committed rather than built, and how to regenerate it.

## Why it is committed

Two reasons, and the second is the real one.

Compiling OpenCV takes tens of minutes, which nobody wants in CI on every push.
More importantly, the bytes have to be the same for a developer and for CI. The
reader ships its digit exemplars as committed bitmaps rather than rendering them
at load, precisely because text rasterises differently across platforms and a CI
box would otherwise disagree with a laptop — see
[docs/reader-assets.md](./reader-assets.md). A toolchain-dependent artifact
rebuilt per machine would reintroduce exactly that class of failure, one layer
down.

So the artifact is an input, not an output: `tools/opencv/build.sh` is run by
hand when OpenCV is upgraded, and what it writes is committed.

## What is in the build

| Choice | Flag | Why |
| --- | --- | --- |
| WebAssembly | `--build_wasm` | Not the asm.js fallback. |
| SIMD | `--simd` (`-msimd128`) | Reading a screenshot is per-pixel work, and it vectorises. |
| Standalone `.wasm` | `--disable_single_file` | The default base64-inlines the WebAssembly into the JavaScript, which costs a third in size, forgoes streaming compilation, and ties the two together in the cache. Separate files are cached and revalidated on their own. |
| core + imgproc only | `--config tools/opencv/opencv_js.config.py` and `-DBUILD_opencv_*=OFF` | Upstream's `build_js.py` builds dnn, photo, calib3d, features2d, objdetect and video by default. The reader calls none of them. dnn and photo are most of the default build's size. |
| No threads | (default) | `SharedArrayBuffer` needs cross-origin isolation headers, which would constrain how the app is served for a gain nothing has asked for yet. |

The bindings whitelist in `tools/opencv/opencv_js.config.py` is upstream's
`platforms/js/opencv_js.config.py` with the module list at the bottom cut to
`core` and `imgproc`. The whitelist decides which functions get JavaScript
bindings generated; the CMake options decide which modules get compiled at all.
Both are needed — a whitelisted function from a module that was not built is a
link error.

## Size

| Build | `opencv.js` | `opencv_js.wasm` | Total | gzipped |
| --- | --- | --- | --- | --- |
| This build | 139 KB | 4.03 MB | 4.17 MB | 1.12 MB |
| Stock `build_js.py --build_wasm` | 10.4 MB | inlined | 10.4 MB | 3.57 MB |

About two and a half times smaller, and better than three times smaller over
the wire. Both were built here from the same OpenCV sources with the same
Emscripten, so the difference is the module list and the flags in the table
above and nothing else. The stock row has no separate `.wasm` because the
default inlines it as base64; most of the gap is the modules that are not
compiled in, and the inlining accounts for part of the rest.

The uncompressed figure is what a phone has to decode and compile, so it is the
one worth watching; the gzipped figure is what crosses the wire. Regenerate the
stock build for comparison with:

```sh
python3 <sources>/platforms/js/build_js.py build_default --build_wasm
```

## Regenerating

```sh
tools/opencv/build.sh
```

Needs `cmake`, `python3`, `node`, `make`, about 3 GB of disk and half an hour.
It downloads its own toolchain and sources, both pinned by version at the top
of the script:

- **OpenCV** comes from the `opencv-python` sdist on PyPI rather than a GitHub
  tarball. The sdist vendors the full upstream tree at a tagged release, and
  PyPI is reachable from environments where GitHub is not.
- **Emscripten** is a prebuilt toolchain from the emscripten-releases bucket,
  pinned by commit hash rather than by "latest". The toolchain version is an
  input to the bytes we commit, so it is pinned like any other.

To upgrade OpenCV: bump `OPENCV_VERSION`, `OPENCV_SDIST` and `OPENCV_SDIST_DIR`
together (the sdist URL carries a content hash, so it cannot be derived from
the version), re-run the script, re-run `npm test` in `tests/cv`, update the
size table above, and commit the result. If the upgrade crosses a major
Emscripten requirement, bump `EMSCRIPTEN_VERSION` and `EMSCRIPTEN_COMMIT` too —
the hashes are published in
[`emscripten-releases-tags.json`](https://raw.githubusercontent.com/emscripten-core/emsdk/main/emscripten-releases-tags.json).

## Loading it

`web/cv/runtime.ts` — `await loadOpenCV()` — in the browser and in Node alike.
The shape it hides is not the one the build flags suggest. Emscripten emits the
artifact with `MODULARIZE=1`, which would give you a factory to call, but
OpenCV then wraps that in a UMD header which calls the factory for you. So
loading `opencv.js` yields a *promise* — one that resolves, once the
WebAssembly is compiled and the runtime initialised, to the runtime itself —
and the wrapper takes its settings from a global `Module` object that has to
exist before the script runs, which is why the loader sets `locateFile` first
rather than passing it. On top of that it memoises the promise, so concurrent
callers share one runtime rather than racing to build two heaps.

`tests/cv/` is the smoke test: it loads the runtime and converts a small image
to grayscale, and it checks that dnn and photo really are absent, that the
WebAssembly really is a separate file, that the browser branch points
Emscripten at the right directory before the script loads, and that the
committed artifact was built from the versions the script pins. It runs in CI.

This artifact is what the screenshot reader runs on: `web/reader/` is the whole
pipeline, in the page, and there is no server-side reader any more (see
[ADR 0006](./adr/0006-the-screenshot-reader-runs-in-the-browser-on-opencv-js.md)).
The service worker deliberately does not precache it. It is fetched on the first
read instead, so installing the app stays fast and only a player who actually
reads a screenshot pays for several megabytes.
