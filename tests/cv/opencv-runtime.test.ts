// Does the committed OpenCV artifact actually come up, and can it compute?
//
// The build is ours (tools/opencv/build.sh) and heavily cut down, so the ways
// it can be wrong are not the ways a dependency is usually wrong: it can be
// linked without the modules we need, or emitted as a factory shape the loader
// does not expect, or built against a .wasm that never got committed. A
// trivial image operation catches all three, which is the whole ambition here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { loadOpenCV, resetOpenCVForTests } from "../../web/cv/runtime.ts";

test("the runtime loads and runs an image operation", async () => {
  const cv = await loadOpenCV();

  // A 4x4 RGBA image, every pixel opaque white, converted to grayscale. White
  // stays white whatever the channel weights, so the expected output needs no
  // arithmetic to state — if a single byte comes back as something other than
  // 255 the colour conversion did not run the way it claims to.
  const src = new cv.Mat(4, 4, cv.CV_8UC4);
  src.data.fill(255);
  const gray = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    assert.equal(gray.rows, 4);
    assert.equal(gray.cols, 4);
    assert.equal(gray.channels(), 1);
    assert.deepEqual([...gray.data], new Array(16).fill(255));
  } finally {
    // Mats hold WebAssembly heap memory the JavaScript GC cannot see.
    src.delete();
    gray.delete();
  }
});

test("the same runtime is handed to every caller", async () => {
  const [first, second] = await Promise.all([loadOpenCV(), loadOpenCV()]);

  // Not cosmetic: a second runtime would have its own WebAssembly heap, and a
  // Mat made in one is meaningless to the other.
  assert.equal(first, second);
});

test("the build leaves out the modules this project never calls", async () => {
  const cv = await loadOpenCV();

  // The point of building OpenCV ourselves. dnn and photo dominate the default
  // build's size; if an upgrade quietly turns them back on, the artifact grows
  // by megabytes and nothing else in the suite would notice.
  assert.equal(cv.dnn, undefined, "dnn should not be linked in");
  assert.equal(cv.readNetFromONNX, undefined, "dnn entry points should not be bound");
  assert.equal(cv.fastNlMeansDenoising, undefined, "photo entry points should not be bound");

  // ...while the two modules the reader does use are present.
  assert.equal(typeof cv.cvtColor, "function");
  assert.equal(typeof cv.findContours, "function");
  assert.equal(typeof cv.warpPerspective, "function");
});

test("the WebAssembly is a file of its own, not inlined into the JavaScript", () => {
  // --disable_single_file, asserted on the bytes rather than trusted from the
  // build script: a standalone .wasm is cached and streaming-compiled on its
  // own, and an inlined one would be base64 in the middle of opencv.js.
  const js = readFileSync(new URL("../../static/vendor/opencv/opencv.js", import.meta.url), "utf8");
  const wasm = readFileSync(new URL("../../static/vendor/opencv/opencv_js.wasm", import.meta.url));

  assert.equal(wasm.subarray(0, 4).toString("binary"), "\0asm", "opencv_js.wasm should be a WebAssembly module");
  assert.match(js, /opencv_js\.wasm/, "opencv.js should fetch the .wasm by name");

  // Not a search for the data: URI prefix — Emscripten's loader carries that
  // string either way, to recognise one. What distinguishes an inlined build
  // is a base64 *payload*, which for a megabytes-long module is a run of
  // base64 characters nothing else in minified JavaScript comes close to.
  const longestBase64Run = Math.max(0, ...(js.match(/[A-Za-z0-9+/]{64,}/g) ?? []).map((run) => run.length));
  assert.ok(
    longestBase64Run < 4096,
    `opencv.js looks like it has the .wasm inlined (${longestBase64Run}-character base64 run)`,
  );
});

// --- the browser path ------------------------------------------------------
//
// The Node smoke tests above prove the artifact computes; they say nothing
// about how it is reached in a browser, which is a different branch with two
// things that are easy to get wrong and impossible to notice locally: the
// script URL, and setting `Module.locateFile` *before* opencv.js runs — the
// UMD wrapper reads that global as it loads, so setting it afterwards silently
// leaves the runtime fetching opencv_js.wasm from the page's own directory.
//
// Running the real artifact under jsdom would mean compiling four megabytes of
// WebAssembly to check a string, so this stubs the two globals the loader
// touches and inspects what it did with them.
test("in a browser it points Emscripten at the artifact's own directory", async () => {
  resetOpenCVForTests();

  const appended: { src: string; onload?: () => void }[] = [];
  const fakeRuntime = { marker: "runtime" };
  const globals = globalThis as Record<string, unknown>;
  const saved = { document: globals.document, cv: globals.cv, Module: globals.Module };

  globals.document = {
    querySelector: () => null,
    createElement: () => {
      const script: Record<string, unknown> = { dataset: {} };
      return script;
    },
    head: {
      appendChild: (script: Record<string, unknown>) => {
        appended.push(script as { src: string; onload?: () => void });
        // The real browser resolves the runtime only once the script has run,
        // which is also when the global appears.
        globals.cv = Promise.resolve(fakeRuntime);
        (script.onload as () => void)();
      },
    },
  };
  delete globals.cv;
  delete globals.Module;

  try {
    const runtime = await loadOpenCV();

    assert.equal(runtime as unknown, fakeRuntime);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].src, "/static/vendor/opencv/opencv.js");

    const locateFile = (globals.Module as { locateFile: (f: string) => string }).locateFile;
    assert.equal(locateFile("opencv_js.wasm"), "/static/vendor/opencv/opencv_js.wasm");
  } finally {
    resetOpenCVForTests();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
  }
});


test("the committed artifact came from the version the build script pins", () => {
  // BUILD.txt is written by tools/opencv/build.sh from the versions pinned at
  // its top, so the two agree at the moment of a build and can drift silently
  // afterwards — someone bumps OPENCV_VERSION, and until the artifact is
  // actually regenerated the repository claims a build it does not contain.
  // Nothing else would notice: a stale artifact still loads and still works.
  const script = readFileSync(new URL("../../tools/opencv/build.sh", import.meta.url), "utf8");
  const stamp = readFileSync(new URL("../../static/vendor/opencv/BUILD.txt", import.meta.url), "utf8");

  const pinned = (name: string) => script.match(new RegExp(`^${name}="([^"]+)"`, "m"))?.[1];

  assert.match(stamp, new RegExp(`OpenCV ${pinned("OPENCV_VERSION")}\\b`));
  assert.match(stamp, new RegExp(`Emscripten ${pinned("EMSCRIPTEN_VERSION")} \\(${pinned("EMSCRIPTEN_COMMIT")}\\)`));
});

test.after(() => resetOpenCVForTests());
