// How the deployed site is arranged, and what the manifest claims about it.
//
// Two things the Android share target needs, both of which fail silently and
// only in production. The service worker has to be served from the site root,
// because a worker's scope is the directory it comes from and one under a
// subdirectory cannot intercept the share POST. The manifest has to come from
// the root too, as `application/manifest+json`: served as a generic binary type
// it is ignored, and the share target goes with it. Nothing a developer does
// locally and no other suite here would notice either going wrong.
//
// What guarantees it is the *layout* rather than a host rule: both files are
// public assets, so `vite build` copies them to the root of dist/ with their
// own extensions. That is why these assertions are about where the files sit
// and what the build is pointed at, and only then about vercel.json — which is
// left with one rewrite, for the one URL that is not a file.
//
// The installability assertions at the bottom moved here from tests/test_app.py,
// which asked the server for the manifest. They are about the manifest's
// contents rather than about any server, and had to outlive it.
//
// Nothing here boots a page, which is why this sits beside the service worker
// rather than in tests/ui: the manifest, the worker and the arrangement that
// serves both from the root are the shell the page is installed *inside*. It
// reads sources rather than dist/, so it needs no build.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

const config = JSON.parse(read("vercel.json"));
const manifest = JSON.parse(read("public/manifest.webmanifest"));
const viteConfig = read("vite.config.ts");

describe("the deployed arrangement", () => {
  it("deploys what the build emits, and builds it there", () => {
    // dist/ is gitignored, so the deploy has to produce it. An empty build
    // command — which is how a Vercel deploy skips building — would deploy
    // nothing at all, and pointing the output directory anywhere else would
    // publish sources instead of a site.
    assert.equal(config.buildCommand, "npm run build");
    assert.equal(config.outputDirectory, "dist");
  });

  it("builds from web/, copying public/ through to the site root", () => {
    // This is the whole mechanism the two assertions below depend on. If the
    // root or the public directory moved, `/sw.js` and `/manifest.webmanifest`
    // would stop being root URLs and nothing else would say so.
    assert.match(viteConfig, /root:\s*"web"/);
    assert.match(viteConfig, /publicDir:\s*"\.\.\/public"/);
    assert.match(viteConfig, /outDir:\s*"\.\.\/dist"/);
    assert.ok(exists("web/index.html"), "the Vite root needs its entry");
  });

  it("puts the service worker at the site root, as JavaScript", () => {
    // Directly in public/, not a subdirectory of it: the copy preserves the
    // path, so public/sw.js is /sw.js and public/anything/sw.js would not be.
    assert.ok(exists("public/sw.js"));
    assert.equal(headersFor("/sw.js")["content-type"], "text/javascript");
  });

  it("puts the manifest at the site root, as a manifest", () => {
    assert.ok(exists("public/manifest.webmanifest"));
    assert.equal(headersFor("/manifest.webmanifest")["content-type"], "application/manifest+json");
  });

  it("still lands a share the worker missed on the app", () => {
    // The worker owns POST /share. This is the GET: a browser with no worker
    // registered — or one whose worker was evicted — should see the app rather
    // than a 404, even though the screenshot itself is lost. It is the only URL
    // on the site that is not a file, and so the only rewrite.
    assert.deepEqual(config.rewrites, [{ source: "/share", destination: "/index.html" }]);
  });

  it("uploads the build's own inputs and publishes none of them", () => {
    // `vite build` has to run where the sources are, so the .vercelignore
    // allowlist must admit them; dropping one would break the deploy and only
    // the deploy. They are never *served*, because the output directory is the
    // build's, which is what keeps the sources off the public site.
    const allowed = new Set(
      read(".vercelignore")
        .split("\n")
        .filter((line) => line.startsWith("!"))
        .map((line) => line.slice(1).replace(/^\//, "")),
    );

    for (const input of ["web", "public", "package.json", "package-lock.json", "vite.config.ts"]) {
      assert.ok(allowed.has(input), `${input} is needed to build and is not allowed in`);
    }
    assert.ok(!allowed.has("dist"), "dist/ is built on the deploy, never uploaded");
  });
});

/** The response headers vercel.json adds for `urlPath`, lowercased by name. */
function headersFor(urlPath) {
  const out = {};
  for (const rule of config.headers) {
    if (rule.source !== urlPath) continue;
    for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
  }
  return out;
}

describe("installability", () => {
  it("declares what Chrome needs to offer an install", () => {
    assert.equal(manifest.display, "standalone", "a 'browser' display is not installable");
    const sizes = new Set(manifest.icons.map((icon) => icon.sizes));
    assert.ok(sizes.has("192x192") && sizes.has("512x512"));
  });

  it("offers a maskable icon", () => {
    // Without one, Android puts the square icon in a white circle on many
    // launchers rather than cropping it.
    assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  });

  it("names only icons the build will have copied", () => {
    // The manifest's URLs are site paths, and public/ is what becomes the site
    // root, so a named icon has to exist under public/ at that same path.
    for (const icon of manifest.icons) {
      assert.ok(exists(path.join("public", icon.src)), `${icon.src} is missing from public/`);
    }
  });
});
