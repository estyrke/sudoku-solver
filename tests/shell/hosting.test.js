// How the deployed site serves the shell, and what the manifest claims about it.
//
// There is no server any more: the app is static files, and the four explicit
// routes app.py used to declare are host configuration in vercel.json instead.
// That configuration fails *silently*, and only in production — a manifest
// served as a generic binary type is ignored by Chrome, and with it the share
// target; a worker served from a subdirectory cannot intercept the share POST,
// so sharing dies with nothing logged anywhere. Neither a developer opening the
// page nor any other suite in this repo would notice. So the config is read
// here and checked against the files it points at, which is the closest a test
// can get to the thing that breaks.
//
// The installability assertions below moved here from tests/test_app.py, which
// asked the server for the manifest. They are about the manifest's contents
// rather than about any server, and had to outlive it.
//
// Nothing here boots a page, which is why this sits beside the service worker
// rather than in tests/ui: the manifest, the worker and the configuration that
// serves both from the root are the shell the page is installed *inside*, and
// they fail in their own way.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const config = JSON.parse(read("vercel.json"));
const manifest = JSON.parse(read("static/manifest.webmanifest"));

/**
 * The repo file the host serves for `url`, relative to the root.
 *
 * Rewrite sources are kept literal in vercel.json — there is no pattern in it
 * to interpret — so matching one is a string comparison, and a URL that
 * matches none is served as the file of the same name.
 */
function servedFile(url) {
  const rewrite = (config.rewrites || []).find((rule) => rule.source === url);
  return (rewrite ? rewrite.destination : url).replace(/^\//, "");
}

/** The response headers the host adds for `url`, lowercased by name. */
function headersFor(url) {
  const out = {};
  for (const rule of config.headers || []) {
    if (rule.source !== url) continue;
    for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
  }
  return out;
}

const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

describe("static hosting", () => {
  it("serves the repo as it stands, with no build step", () => {
    // static/dist/app.js is committed precisely because the deploy has no Node
    // step — CI rebuilds and fails if the committed bundle has drifted. A build
    // command here would make that check meaningless and the deploy's contents
    // something other than what was reviewed.
    assert.equal(config.buildCommand, "", "an empty build command is what skips the build");
    assert.equal(config.outputDirectory, ".");
  });

  it("serves the app at the root", () => {
    assert.equal(servedFile("/"), "static/index.html");
  });

  it("still lands a share the worker missed on the app", () => {
    // The worker owns POST /share. This is the GET: a browser with no worker
    // registered — or one whose worker was evicted — should see the app rather
    // than a 404, even though the screenshot itself is lost.
    assert.equal(servedFile("/share"), "static/index.html");
  });

  it("serves the manifest from the root, as a manifest", () => {
    // Served as anything else it is ignored, and with it the share target — so
    // the app would install but never appear in the share sheet.
    assert.equal(servedFile("/manifest.webmanifest"), "static/manifest.webmanifest");
    assert.equal(headersFor("/manifest.webmanifest")["content-type"], "application/manifest+json");
  });

  it("serves the service worker from the root, as JavaScript", () => {
    // A worker's scope is the directory it is served from. One under /static
    // could not intercept the share POST to /share, which is the whole reason
    // this path is configured rather than left to the file's own location.
    assert.equal(servedFile("/sw.js"), "static/sw.js");
    assert.match(headersFor("/sw.js")["content-type"], /javascript/);
  });

  it("points every rewrite at a file that exists", () => {
    // The failure this catches is a moved or renamed asset: the rewrite still
    // parses, the deploy still succeeds, and the path 404s in production.
    for (const rule of config.rewrites) {
      assert.ok(exists(servedFile(rule.source)), `${rule.source} -> ${rule.destination} is missing`);
    }
  });
});

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

  it("names only icons that exist", () => {
    for (const icon of manifest.icons) {
      assert.ok(exists(icon.src.replace(/^\//, "")), `${icon.src} is missing`);
    }
  });
});
