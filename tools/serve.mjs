// Serve the built site exactly as the host serves it.
//
//     npm run build && npm run serve
//
// `npm run dev` is the Vite dev server, which is the right thing for working on
// `web/`. It is the wrong thing for checking what actually ships: it transforms
// every file it serves, so `/static/dist/app.js` comes back rewritten and
// several times its built size, and `/sw.js` is not the bytes the browser would
// register as a worker. Anything about the bundle, the service worker, the
// precache or an install has to be tried against the real files.
//
// So this is a plain static file server over `static/`, with two things taken
// from `vercel.json` rather than restated: the rewrites that put four URLs at
// the root, and the response headers that give the manifest and the worker
// their media types. Restating either would let this drift from the deploy,
// which would defeat the point of having it.
//
// Localhost only, and `static/` only. Neither is a guess about who is on the
// network; they are the defaults that make it not matter.
//
// Not `vite preview`: that serves `build.outDir`, which here is the directory
// holding the one bundle rather than the site around it.

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
// Only static/ is ever served. Every URL the app reaches for is either under
// /static/ or one of the four vercel.json maps into it, so this costs nothing
// and it is what keeps a local server off the rest of the working tree — which
// holds .env.local, an editor's scratch files and whatever else is lying about.
// The deploy is looser than this (its output directory is the repo root, so the
// build's inputs are reachable there); being looser in production is a trade
// made deliberately, being looser here would just be careless.
const SERVE_ROOT = join(ROOT, "static");
const HOST = "127.0.0.1";
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8124);

const { rewrites, headers } = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));

/** Media types for what this site actually serves. */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".bin": "application/octet-stream",
};

const rewritten = new Map(rewrites.map((rule) => [rule.source, rule.destination]));

/** The headers vercel.json adds for `urlPath`, if any. */
function configuredHeaders(urlPath) {
  const out = {};
  for (const rule of headers) {
    if (rule.source !== urlPath) continue;
    for (const { key, value } of rule.headers) out[key] = value;
  }
  return out;
}

createServer((request, response) => {
  const [urlPath] = (request.url ?? "/").split("?");
  const target = rewritten.get(urlPath) ?? urlPath;

  // `normalize` collapses any `..`, and the prefix check is what makes that
  // enough: a path that climbs out lands somewhere that is not SERVE_ROOT and
  // is refused rather than resolved.
  const file = resolve(SERVE_ROOT, normalize(target).replace(/^\/?static\//, "").replace(/^\//, ""));
  if (!file.startsWith(SERVE_ROOT + "/") || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end(`404 ${urlPath}\n`);
    return;
  }

  response.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    // Never let a stale worker or bundle survive a rebuild during a session.
    "cache-control": "no-store",
    ...configuredHeaders(urlPath),
  });
  createReadStream(file).pipe(response);
}).listen(PORT, HOST, () => {
  console.log(`  ➜  Built site: http://localhost:${PORT}/`);
});
