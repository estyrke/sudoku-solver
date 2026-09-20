// Installability and the receiving half of the Android share target.
//
// sw.js takes the POSTed screenshot, stashes it and redirects here with
// ?shared=1. This file collects it, reads it here in the page, brings the tab
// it belongs to to the front and hands the reading over. From the tab's point
// of view nothing unusual happened: it gets the same payload it would have got
// from a dropped file.
//
// Reading and the choice of reader both happen on the device — the screenshot
// is never uploaded, and nothing about the share path needs a connection.
// Which puzzle a picture is lives in web/reader/share-dispatch.ts.
//
// Both entry points below are called by app.tsx once the tabs are mounted,
// rather than run on import: a share that arrives before the tab it belongs to
// exists has nowhere to land.
//
// sw.js itself stays plain JavaScript: it is served from the site root so its
// scope covers /share, and it is loaded by the browser as a worker rather than
// by this bundle.
//
// Browser APIs are reached through `window` (`window.caches`, `window.File`, …)
// rather than as bare globals, so the jsdom page harness can substitute them
// per boot — see tests/ui/harness.js.

import { setShareStatus, type SharedReading } from "./ui/shared-reading.ts";
import { messageOf, unreadableScreenshotMessage } from "./ui/read-failure.ts";
import { decodeImageFile } from "./reader/decode.ts";
import { readSharedScreenshot, type DispatchedReading } from "./reader/share-dispatch.ts";

const SHARE_CACHE = "shared-image";
const SHARE_KEY = "/shared-image";

export function registerServiceWorker(): void {
  if (!("serviceWorker" in window.navigator)) return;
  // After load, so registering never competes with rendering the board.
  window.addEventListener("load", () => {
    window.navigator.serviceWorker.register("/sw.js").catch(() => {
      // Without a worker the app still works; it just cannot be shared to.
    });
  });
}

export async function adoptSharedImage(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("shared");
  if (!state) return;
  // sw.js's own diagnosis of an "error" state — which field was missing, or
  // what threw — so a real device's failure says more than a dropped file's
  // ever could, without needing to plug it into a debugger to find out.
  const why = params.get("why");

  // Drop the marker before doing anything else, so a reload does not try to
  // adopt a screenshot that has already been consumed (or already failed).
  window.history.replaceState(null, "", window.location.pathname);

  // Progress and failures go to the tab that shows the share's status line —
  // see web/ui/shared-reading.ts. Which tab that is was never this file's
  // decision to make, and it cannot reach into a rendered panel anyway.
  const say = (message: string, bad?: boolean) => setShareStatus(message, !!bad);

  if (state === "error") {
    say(
      `That share didn't contain an image the app could read.${why ? ` (${why})` : ""}`,
      true,
    );
    return;
  }

  let file: File;
  try {
    const cache = await window.caches.open(SHARE_CACHE);
    const stashed = await cache.match(SHARE_KEY);
    if (!stashed) {
      say("The shared screenshot went missing before it could be read.", true);
      return;
    }
    // Consume it either way: a stale image adopted on some later launch would
    // be far more confusing than none at all.
    await cache.delete(SHARE_KEY);

    const blob = await stashed.blob();
    file = new window.File([blob], "shared-screenshot.png", {
      type: blob.type || "image/png",
    });
  } catch (err) {
    say(`Could not open the shared screenshot: ${messageOf(err)}`, true);
    return;
  }

  // From here on this is an ordinary read of an ordinary file, and it fails in
  // the ordinary words — a screenshot the reader cannot make a board of says
  // the same thing whether it was shared, dropped or pasted.
  try {
    say("Reading the shared screenshot…");
    handToTab(await readSharedScreenshot(await decodeImageFile(file)));
  } catch (err) {
    say(unreadableScreenshotMessage(err), true);
  }
}

/**
 * Bring the tab a reading belongs to to the front, and hand it over.
 *
 * Its own function because this is the only place the reader's answer becomes a
 * tab, and it is the one step of the share path that cannot run under jsdom as
 * part of a whole share — the read before it needs an image decoder and the
 * OpenCV runtime, and jsdom has neither. Exported so the link between the two
 * halves is tested for what it is (tests/share/), rather than left as the seam
 * every suite happens to step over.
 *
 * The screenshot itself stops here: it used to be handed over alongside the
 * reading so "Confirm reading" could re-extract glyphs from it, and with that
 * loop deleted nothing past this point has a use for the pixels.
 */
export function handToTab(reading: DispatchedReading): void {
  const puzzle = window.PuzzleShell.get(reading.kind);
  if (!puzzle || !puzzle.acceptShared) {
    setShareStatus(`Nothing here can open a ${reading.kind} board.`, true);
    return;
  }
  window.PuzzleShell.activate(reading.kind);
  puzzle.acceptShared(reading as SharedReading);
}
