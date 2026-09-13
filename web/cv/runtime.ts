// Bringing the OpenCV runtime up, in the browser and in Node.
//
// The artifact under static/vendor/opencv/ is a custom build (see
// docs/opencv-js-build.md). It is not an ES module and it is deliberately not
// bundled. Its shape is worth stating, because it is not the one the flags
// suggest: Emscripten emits it with MODULARIZE=1, but OpenCV then wraps that
// in a UMD header which *calls* the factory for you and hands back the promise
// it returns. So loading opencv.js does not give you a factory to call — it
// gives you a promise that resolves, once the WebAssembly is compiled and the
// runtime initialised, to the runtime itself.
//
// That wrapper takes its settings from a global `Module` object, which has to
// exist before the script runs. Everything here exists to hide those two
// facts behind one `await`.
//
// Nothing calls this yet. The reader still runs on the server; this slice
// ships the artifact and the way in, and a later one moves the reader onto it.

/** The pieces of the runtime this project relies on.
 *
 * OpenCV.js ships no type declarations, and hand-writing the whole surface
 * would be a large lie maintained by hand. This declares the handful of
 * members we actually name and leaves the rest reachable but untyped — honest
 * about what has been checked and what has not. */
export interface OpenCVRuntime {
  /** An image or matrix. Owns WebAssembly heap memory: every Mat has to be
   *  `delete()`d, since the JavaScript GC cannot see what it holds. */
  Mat: {
    new (): OpenCVMat;
    new (rows: number, cols: number, type: number): OpenCVMat;
    ones(rows: number, cols: number, type: number): OpenCVMat;
    zeros(rows: number, cols: number, type: number): OpenCVMat;
  };
  CV_8UC1: number;
  CV_8UC3: number;
  CV_8UC4: number;
  COLOR_RGBA2GRAY: number;
  COLOR_RGB2GRAY: number;
  /** Colour conversion — the first imgproc call the reader makes on a
   *  screenshot, and the one the Node smoke test exercises. */
  cvtColor(src: OpenCVMat, dst: OpenCVMat, code: number, dstChannels?: number): void;
  [member: string]: unknown;
}

export interface OpenCVMat {
  rows: number;
  cols: number;
  data: Uint8Array;
  channels(): number;
  type(): number;
  delete(): void;
  [member: string]: unknown;
}

/** Where the artifact is served from in the browser. app.py mounts static/ at
 *  this prefix; the path is not configurable by accident. */
const BROWSER_BASE_PATH = "/static/vendor/opencv";

/** One runtime per process, whoever asks.
 *
 * Compiling the WebAssembly costs far more than the call that triggers it, and
 * two Mats from two runtimes cannot be used together — they sit in different
 * heaps. So the *promise* is memoised, not the result: concurrent callers
 * during start-up all wait on the same load rather than starting a second. */
let pending: Promise<OpenCVRuntime> | null = null;

export function loadOpenCV(): Promise<OpenCVRuntime> {
  if (!pending) {
    pending = (isNode() ? loadInNode() : loadInBrowser()).catch((err: unknown) => {
      // A failed load must not poison every later attempt: drop the memo so a
      // caller can retry (a dropped connection on the .wasm, most likely).
      pending = null;
      throw err;
    });
  }
  return pending;
}

/** Forget the loaded runtime. Tests only — a process that does this while Mats
 *  are still alive has leaked them, since their heap goes away with it. */
export function resetOpenCVForTests(): void {
  pending = null;
}

function isNode(): boolean {
  return typeof process !== "undefined" && process.versions?.node != null && typeof document === "undefined";
}

async function loadInBrowser(): Promise<OpenCVRuntime> {
  const global = globalThis as Record<string, unknown>;

  // Emscripten resolves opencv_js.wasm against the *page*, not against the
  // script, so without this a page at /share would ask for /opencv_js.wasm.
  // It has to be set before opencv.js runs, because the UMD wrapper reads this
  // global as it loads rather than taking an argument.
  const settings = (global.Module ?? {}) as Record<string, unknown>;
  settings.locateFile = (file: string) => `${BROWSER_BASE_PATH}/${file}`;
  global.Module = settings;

  await loadScriptOnce(`${BROWSER_BASE_PATH}/opencv.js`);

  const runtime = global.cv;
  if (runtime == null) throw new Error("opencv.js loaded but defined no runtime");
  // The wrapper leaves a promise in the global on the way up and the runtime
  // itself once it has resolved; awaiting covers both, since awaiting a
  // non-promise is the value.
  return (await runtime) as OpenCVRuntime;
}

function loadScriptOnce(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[data-opencv="${src}"]`);
  if (existing) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.opencv = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

async function loadInNode(): Promise<OpenCVRuntime> {
  // opencv.js is CommonJS, and it is a build artifact rather than a dependency
  // — no package.json entry points at it — so it is required by path. The
  // import is dynamic and behind isNode() so that a browser bundle of this
  // module never has to resolve node:module.
  const { createRequire } = await import(/* @vite-ignore */ "node:module");
  const require = createRequire(import.meta.url);
  // Already a promise: the UMD wrapper called the factory on require. Node
  // needs no locateFile — Emscripten looks beside opencv.js there.
  return (await require("../../static/vendor/opencv/opencv.js")) as OpenCVRuntime;
}
