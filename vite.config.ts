import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";

// One ES module out, under static/dist/, which is what index.html loads and
// what the jsdom page tests import. A fixed file name, no content hash:
// index.html is a static file rather than something Vite generates, so the name
// in its <script> tag has to stay stable.
//
// The output is minified for asset size and cacheability only. It is not an
// obfuscation or security measure — minified JavaScript is trivially readable,
// and this bundle is a small fraction of the WASM payload the reader ships.

/**
 * Serve the site locally the way the host serves it in production.
 *
 * Four URLs are not where their files are: `/`, `/share`, `/manifest.webmanifest`
 * and `/sw.js` all live under `static/` and are mapped onto root paths by the
 * host (vercel.json). A dev server without those mappings is a different site
 * from the deployed one in exactly the ways that matter — the manifest 404s, so
 * the app will not install, and a worker served from `/static` has a scope that
 * cannot cover `/share`, so the share target cannot be tried at all.
 *
 * The rewrite table is read from `vercel.json` rather than restated here: a
 * second copy of it would drift, and a dev server that routed differently from
 * the deploy is worse than no dev server. Only the rewrites are read. The
 * `headers` beside them — the explicit media types — are not applied, because
 * Vite serves these files from their own extensions and arrives at the same
 * answer; that is a coincidence the deploy cannot rely on, which is why the
 * headers are pinned in production by `tests/ui/hosting.test.js` instead.
 */
function hostRewrites(): Plugin {
  return {
    name: "host-rewrites",
    configureServer(server) {
      const { rewrites } = JSON.parse(readFileSync("vercel.json", "utf8"));
      const destinations = new Map<string, string>(
        rewrites.map((rule: { source: string; destination: string }) => [
          rule.source,
          rule.destination,
        ]),
      );
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url ?? "/").split("?");
        const destination = destinations.get(path);
        // The query survives the rewrite: the share handoff redirects to
        // `/?shared=1`, and a rewrite that dropped it would land on the app
        // with the screenshot still sitting unclaimed in the cache.
        if (destination) req.url = query ? `${destination}?${query}` : destination;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [preact(), hostRewrites()],
  build: {
    outDir: "static/dist",
    emptyOutDir: true,
    minify: "esbuild",
    target: "es2022",
    rollupOptions: {
      input: { app: "web/app.tsx" },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        // One file: the share handoff and the puzzle tabs share module state
        // (web/ui/shared-reading.ts), so splitting them into separate entries
        // would give each its own copy of it and quietly break the handoff.
        inlineDynamicImports: true,
      },
    },
  },
});
