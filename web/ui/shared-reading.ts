// The two sideways channels between the Android share handoff (pwa.ts) and the
// puzzle tabs.
//
// A share arrives before anyone has clicked anything: pwa.ts reads the
// screenshot, works out which puzzle it is, brings that tab to the front and
// hands the reading over. The tab that receives it is an ordinary mounted
// component, so it cannot be called as an object — it subscribes here instead,
// from an effect, and pwa.ts publishes.
//
// Keeping this out of app.tsx is deliberate: the shell knows the list of
// puzzle types, not the fact that screenshots exist.

/**
 * A reading the share target has already parsed, handed to a tab as-is.
 *
 * Deliberately shapeless: only the tab that asked for it knows its shape, so a
 * tab narrows it to its own reading type on arrival.
 */
export type SharedReading = Record<string, any>;

type ReadingHandler = (data: SharedReading) => void;

const handlers = new Map<string, ReadingHandler>();

/** Subscribe a tab to screenshots shared to it. Returns an unsubscribe. */
export function onSharedReading(id: string, handler: ReadingHandler): () => void {
  handlers.set(id, handler);
  return () => {
    if (handlers.get(id) === handler) handlers.delete(id);
  };
}

/**
 * Hand a parsed reading to the tab it belongs to.
 *
 * The reading travels alone. The screenshot used to travel with it, because
 * "Confirm reading" re-extracted glyphs from the original image to teach the
 * classifier; with that loop deleted nothing downstream of the reader has any
 * use for the pixels, and a tab that was handed them would only be holding a
 * screenshot's worth of memory for nothing.
 */
export function deliverSharedReading(id: string, data: SharedReading): void {
  handlers.get(id)?.(data);
}

// ---- the share's own progress line ---------------------------------------
//
// pwa.ts has things to say ("Reading the shared screenshot…", "that share
// didn't contain an image") before any tab is involved, and historically wrote
// them straight into the Killer tab's drop status. That element is rendered by
// a component now, so the message is published instead and the tab renders it
// like any other status.

type StatusHandler = (message: string, isError: boolean) => void;

let statusHandler: StatusHandler | null = null;

export function onShareStatus(handler: StatusHandler): () => void {
  statusHandler = handler;
  return () => {
    if (statusHandler === handler) statusHandler = null;
  };
}

export function setShareStatus(message: string, isError = false): void {
  statusHandler?.(message, isError);
}
