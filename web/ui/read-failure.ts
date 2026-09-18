// What to say to the player when reading a screenshot fails.
//
// One sentence and the helper that builds it, shared by every way a screenshot
// arrives — dropped, pasted or shared. A share that worded its failure
// differently would have the player hunting for a difference between the paths
// that is not there, so the wording is kept in one place rather than kept in
// step by hand.
//
// This was `offline.ts`, and it was about the network: reading was the one
// thing a lost connection took away, because the CV reader was server-side, and
// `fetch` rejecting offline with a bare TypeError — "Failed to fetch" — reads
// like the whole app broke rather than like one path being unavailable. That
// distinction is gone along with the network: both readers run in the page, the
// share target picks between them for itself, and the self-calibration loop
// that was the last caller of a server is deleted. Nothing here may blame a
// connection, because nothing here has one.

/** What a thrown thing has to say for itself. Exported because the readers run
 *  in the page and fail without a connection ever being involved, and because
 *  the share handoff has its own non-reader failures to word (a stash the cache
 *  lost, say). */
export const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** The status line for a screenshot the reader could not make a board of. */
export const unreadableScreenshotMessage = (err: unknown): string =>
  `Could not read that screenshot: ${messageOf(err)}`;
