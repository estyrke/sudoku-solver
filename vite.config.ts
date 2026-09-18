import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// The app is an ordinary Vite project, arranged so that what the build emits is
// the whole deployable site rather than one file inside a hand-maintained one:
//
//   web/          the Vite root. index.html is the entry; everything it pulls in
//                 is TypeScript — the UI as Preact components in .tsx, the
//                 engines and the reader as plain .ts.
//   public/       assets copied through verbatim, at the site root. The service
//                 worker, the manifest, the stylesheet, the icons, the OpenCV
//                 build and the digit exemplars.
//   dist/         the build output, and the thing that gets deployed. Gitignored.
//
// That arrangement is load-bearing in three places. `sw.js` has to be served
// from the site root or its scope cannot cover /share and the Android share
// target dies; the manifest has to be served from the root too, or it is
// ignored and takes the share target with it. Both are public assets, so both
// land at the root of the build with their own extensions and correct media
// types, rather than needing a host rule to put them there. And `vite preview`
// serves the build output, which means it serves the real site — so the
// deployed app can be tried locally without a bespoke server standing in for
// the host.
export default defineConfig({
  root: "web",
  // Resolved from `root`, so this is the repo's own public/ rather than a
  // web/public/: four megabytes of vendored OpenCV has no business sitting
  // inside a directory that otherwise holds nothing but TypeScript.
  publicDir: "../public",
  plugins: [preact()],
  build: {
    outDir: "../dist",
    // Vite refuses to empty an outDir outside its root unless told to, which is
    // the right default and not what we want here: dist/ is ours and stale
    // files in it would be deployed.
    emptyOutDir: true,
    minify: "esbuild",
    target: "es2022",
    // No modulepreload polyfill. Vite injects one for an HTML entry by default,
    // and it is the first thing the bundle runs — but it exists to preload
    // *sibling chunks*, and `inlineDynamicImports` below means there is exactly
    // one chunk and nothing to preload. Left on it costs a few hundred bytes
    // and, because it reaches for `MutationObserver` as a bare global at module
    // scope, it also breaks the jsdom page harness, which hands the modules a
    // window rather than installing browser globals (tests/ui/harness.js).
    modulePreload: false,
    rollupOptions: {
      output: {
        // A fixed name rather than a content hash. index.html is generated, so
        // hashing would cost nothing there — but static/sw.js precaches the
        // bundle *by name* on install, and a name only the build knows would
        // have to be threaded into the worker somehow. Cache-busting is already
        // handled: the worker serves cache-first and revalidates behind the
        // response, so a new build lands on the launch after the one that
        // fetched it.
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
        // One file: the share handoff and the puzzle tabs share module state
        // (web/ui/shared-reading.ts), so splitting them into separate chunks
        // would give each its own copy of it and quietly break the handoff.
        inlineDynamicImports: true,
      },
    },
  },
  // The one URL that is not a file: a share that the service worker did not
  // intercept arrives as GET /share and has to show the app. Vite's own SPA
  // fallback does this in dev and preview; vercel.json does it in production.
  appType: "spa",
});
