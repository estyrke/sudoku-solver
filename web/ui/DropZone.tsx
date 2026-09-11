import { useEffect, useState } from "preact/hooks";

/**
 * Drop / paste / choose a screenshot, with the reader's own status line
 * underneath.
 *
 * Paste is a window-level event with nowhere better to live: a paste is not
 * aimed at an element. It is only listened for while this tab is the active
 * one, so two mounted tabs never both grab the same screenshot.
 */
export function DropZone({
  id,
  inputId,
  statusId,
  prompt,
  status,
  error,
  active,
  onFile,
}: {
  /** DOM ids, kept because style.css and the page tests name them. */
  id: string;
  inputId: string;
  statusId: string;
  prompt: string;
  status: string;
  error?: boolean;
  /** Whether this tab is in front; paste is ignored when it is not. */
  active: boolean;
  onFile: (file: File) => void;
}) {
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!active) return;
    const onPaste = (event: ClipboardEvent) => {
      const item = [...(event.clipboardData?.items || [])].find((i) =>
        i.type.startsWith("image/"),
      );
      const file = item?.getAsFile();
      if (file) onFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [active, onFile]);

  return (
    <div
      id={id}
      class={"drop" + (over ? " over" : "")}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const file = (event as DragEvent).dataTransfer?.files[0];
        if (file) onFile(file);
      }}
    >
      <strong>{prompt}</strong>, or{" "}
      <label class="link">
        choose a file
        <input
          id={inputId}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (file) onFile(file);
          }}
        />
      </label>
      .
      <div id={statusId} class={"status" + (error ? " error" : "")}>
        {status}
      </div>
    </div>
  );
}
