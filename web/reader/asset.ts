// Reading a file that ships beside the app, in the browser or in Node.
//
// The reader's data — the digit exemplars today — lives under static/ and is
// fetched at run time rather than bundled: it is a few hundred kilobytes of
// bytes that change only when they are deliberately changed, so it caches on
// its own and costs nothing to the player who never reads a screenshot.
//
// Node has no fetch against a path, and the reader's tests run there against
// the same files the browser is served. One place knows that difference.

/** Where a served asset actually sits on disk, relative to this module. */
const REPO_ROOT = "../../";

/**
 * The bytes of an asset, named by the path the browser is served it from.
 *
 * @param path absolute URL path, e.g. `/static/reader/glyph-seeds.bin`
 */
export async function loadAsset(path: string): Promise<Uint8Array> {
  if (isNode()) return loadFromDisk(path);

  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Whether this is Node rather than a browser — see web/cv/runtime.ts, which
 *  asks the same question about the OpenCV artifact for the same reason. */
function isNode(): boolean {
  return typeof process !== "undefined" && process.versions?.node != null && typeof document === "undefined";
}

async function loadFromDisk(path: string): Promise<Uint8Array> {
  // Dynamic and behind isNode() so a browser bundle of this module never has
  // to resolve node:fs.
  const { readFile } = await import(/* @vite-ignore */ "node:fs/promises");
  return new Uint8Array(await readFile(new URL(REPO_ROOT + path.replace(/^\//, ""), import.meta.url)));
}
