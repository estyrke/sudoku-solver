// Installability and the receiving half of the Android share target.
//
// sw.js takes the POSTed screenshot, stashes it and redirects here with
// ?shared=1. This file collects it, asks the server which puzzle it is, brings
// that tab to the front and hands the reading over. From the tab's point of
// view nothing unusual happened: it gets the same payload it would have got
// from a dropped file.
//
// sw.js itself stays plain JavaScript: it is served from the site root so its
// scope covers /share, and it is loaded by the browser as a worker rather than
// by this bundle.

import type { SharedReading } from "./shell";

const SHARE_CACHE = "shared-image";
const SHARE_KEY = "/shared-image";

if ("serviceWorker" in window.navigator) {
  // After load, so registering never competes with rendering the board.
  window.addEventListener("load", () => {
    window.navigator.serviceWorker.register("/sw.js").catch(() => {
      // Without a worker the app still works; it just cannot be shared to.
    });
  });
}

document.addEventListener("DOMContentLoaded", adoptSharedImage);

async function adoptSharedImage(): Promise<void> {
  const state = new URLSearchParams(window.location.search).get("shared");
  if (!state) return;

  // Drop the marker before doing anything else, so a reload does not try to
  // adopt a screenshot that has already been consumed (or already failed).
  window.history.replaceState(null, "", window.location.pathname);

  const say = (message: string, bad?: boolean) => {
    const el = document.getElementById("kDropStatus") || document.getElementById("dropStatus");
    if (el) {
      el.textContent = message;
      el.classList.toggle("error", !!bad);
    }
  };

  if (state === "error") {
    say("That share didn't contain an image the app could read.", true);
    return;
  }

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
    const file = new window.File([blob], "shared-screenshot.png", {
      type: blob.type || "image/png",
    });

    say("Reading the shared screenshot…");
    const body = new window.FormData();
    body.append("image", file);
    const res = await window.fetch("/share/parse", { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      say(data.detail || `Could not read that screenshot (${res.status}).`, true);
      return;
    }

    const puzzle = window.PuzzleShell.get(data.kind);
    if (!puzzle || !puzzle.acceptShared) {
      say(`Nothing here can open a ${data.kind} board.`, true);
      return;
    }
    window.PuzzleShell.activate(data.kind);
    puzzle.acceptShared(file, data as SharedReading);
  } catch (err) {
    say("Could not open the shared screenshot: " + (err as Error).message);
  }
}
