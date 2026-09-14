// What to say when a request to the reader fails.
//
// Hinting, solving, the mistake audit and classic screenshot reading all run
// in the browser, and the service worker precaches the shell, so the app is
// largely usable with no network (see static/sw.js). What is left server-side
// is the Killer reader, the share dispatcher and the classifier's learning
// step — /killer/parse, /share/parse and /confirm — and they are the only
// things a lost connection can now take away.
//
// Offline, `fetch` rejects with a bare TypeError — "Failed to fetch" — which
// reads like the app broke. It did not: one path is unavailable and the rest
// still works. Saying exactly that is the difference between a player putting
// the phone away and a player typing the board in by hand.
//
// `window.navigator` rather than the bare global, like the rest of web/: the
// jsdom page harness substitutes browser APIs per boot (tests/ui/harness.js).

const OFFLINE =
  "You're offline — reading a screenshot, and teaching the reader from your " +
  "corrections, both need a connection. Entering a board by hand, hints and " +
  "solving all still work.";

/**
 * True when `err` is a connection failure rather than an answer from the server.
 *
 * Both halves earn their place: the browser reports being offline, but a
 * request can also die on a network that is nominally up (a dropped mobile
 * connection, a captive portal), and then only the rejection says so. A
 * rejected `fetch` never carries a response, so there is no server message to
 * lose by treating it this way.
 */
function isNetworkFailure(err: unknown): boolean {
  if (!window.navigator.onLine) return true;
  return /failed to fetch|networkerror|network request failed|load failed/i.test(messageOf(err));
}

/** What a thrown thing has to say for itself. Exported because a reader that
 *  runs in the page fails without a connection ever being involved, and still
 *  has to put something on the status line. */
export const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The status line for a reader request that threw.
 *
 * @param err     whatever `fetch` (or the code unpacking its response) rejected with
 * @param prefix  how this tab labels an ordinary failure, e.g. "Upload failed"
 */
export function readingFailureMessage(err: unknown, prefix?: string): string {
  if (isNetworkFailure(err)) return OFFLINE;
  return prefix ? `${prefix}: ${messageOf(err)}` : messageOf(err);
}
