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
// Both screenshot readers (web/reader/) run on this, and so does the dispatch
// that picks between them for a shared screenshot.

/** The pieces of the runtime this project relies on.
 *
 * OpenCV.js ships no type declarations, and hand-writing the whole surface
 * would be a large lie maintained by hand. This declares the members we
 * actually name and leaves the rest reachable but untyped — honest about what
 * has been checked and what has not. */
export interface OpenCVRuntime {
  /** An image or matrix. Owns WebAssembly heap memory: every Mat has to be
   *  `delete()`d, since the JavaScript GC cannot see what it holds. */
  Mat: {
    new (): OpenCVMat;
    new (rows: number, cols: number, type: number): OpenCVMat;
    ones(rows: number, cols: number, type: number): OpenCVMat;
    zeros(rows: number, cols: number, type: number): OpenCVMat;
  };
  /** A growable list of Mats, which is how the bindings return contours. Owns
   *  heap memory like a Mat, and freeing it does not free what it holds. */
  MatVector: { new (): OpenCVMatVector };
  Size: { new (width: number, height: number): OpenCVSize };
  Point: { new (x: number, y: number): OpenCVPoint };
  Scalar: { new (v0?: number, v1?: number, v2?: number, v3?: number): number[] };

  CV_8UC1: number;
  CV_8UC3: number;
  CV_8UC4: number;
  CV_32FC1: number;
  CV_32FC2: number;
  COLOR_RGBA2GRAY: number;
  COLOR_RGB2GRAY: number;
  COLOR_RGBA2RGB: number;
  COLOR_RGB2HSV: number;
  ADAPTIVE_THRESH_MEAN_C: number;
  THRESH_BINARY_INV: number;
  THRESH_OTSU: number;
  RETR_EXTERNAL: number;
  CHAIN_APPROX_SIMPLE: number;
  INTER_LINEAR: number;
  INTER_AREA: number;
  BORDER_CONSTANT: number;

  /** Colour conversion — the first imgproc call the reader makes on a
   *  screenshot, and the one the Node smoke test exercises. */
  cvtColor(src: OpenCVMat, dst: OpenCVMat, code: number, dstChannels?: number): void;
  matFromArray(rows: number, cols: number, type: number, values: ArrayLike<number>): OpenCVMat;
  GaussianBlur(src: OpenCVMat, dst: OpenCVMat, ksize: OpenCVSize, sigmaX: number, sigmaY?: number, borderType?: number): void;
  adaptiveThreshold(
    src: OpenCVMat,
    dst: OpenCVMat,
    maxValue: number,
    adaptiveMethod: number,
    thresholdType: number,
    blockSize: number,
    c: number,
  ): void;
  dilate(
    src: OpenCVMat,
    dst: OpenCVMat,
    kernel: OpenCVMat,
    anchor?: OpenCVPoint,
    iterations?: number,
    borderType?: number,
    borderValue?: number[],
  ): void;
  findContours(image: OpenCVMat, contours: OpenCVMatVector, hierarchy: OpenCVMat, mode: number, method: number): void;
  contourArea(contour: OpenCVMat, oriented?: boolean): number;
  arcLength(curve: OpenCVMat, closed: boolean): number;
  approxPolyDP(curve: OpenCVMat, approxCurve: OpenCVMat, epsilon: number, closed: boolean): void;
  getPerspectiveTransform(src: OpenCVMat, dst: OpenCVMat): OpenCVMat;
  warpPerspective(
    src: OpenCVMat,
    dst: OpenCVMat,
    m: OpenCVMat,
    dsize: OpenCVSize,
    flags?: number,
    borderMode?: number,
    borderValue?: number[],
  ): void;
  resize(src: OpenCVMat, dst: OpenCVMat, dsize: OpenCVSize, fx?: number, fy?: number, interpolation?: number): void;
  threshold(src: OpenCVMat, dst: OpenCVMat, thresh: number, maxval: number, type: number): number;
  connectedComponentsWithStats(
    image: OpenCVMat,
    labels: OpenCVMat,
    stats: OpenCVMat,
    centroids: OpenCVMat,
    connectivity?: number,
  ): number;

  [member: string]: unknown;
}

export interface OpenCVMat {
  rows: number;
  cols: number;
  data: Uint8Array;
  /** The same heap bytes seen as 32-bit floats. Only meaningful on a CV_32F
   *  Mat; reading it on any other depth reinterprets the bytes silently. */
  data32F: Float32Array;
  /** Likewise for CV_32S — the depth `connectedComponentsWithStats` labels in. */
  data32S: Int32Array;
  channels(): number;
  type(): number;
  delete(): void;
  [member: string]: unknown;
}

export interface OpenCVMatVector {
  size(): number;
  get(index: number): OpenCVMat;
  delete(): void;
}

export interface OpenCVSize {
  width: number;
  height: number;
}

export interface OpenCVPoint {
  x: number;
  y: number;
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
