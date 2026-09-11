/**
 * The 1-9 pad plus a clear key, for tabs where digits go into cells.
 *
 * It does double duty (write a value in Pen, toggle a mark in Pencil), so it
 * answers "what's already in this cell?" before the next tap: a pencilled
 * digit's button gets a ring, the cell's actual value's button gets filled
 * solid. Both are cleared when nothing is selected.
 */
export function Numpad({
  id,
  clearId,
  value = null,
  marks = [],
  onDigit,
  onClear,
}: {
  /** DOM id for the pad, kept because style.css and the page tests name it. */
  id?: string;
  clearId?: string;
  value?: number | null;
  marks?: Iterable<number>;
  onDigit: (digit: number) => void;
  onClear: () => void;
}) {
  const marked = new Set(marks);
  return (
    <div id={id} class="numpad">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
        <button
          key={d}
          type="button"
          class={
            "num" + (marked.has(d) ? " marked" : "") + (value === d ? " current" : "")
          }
          data-digit={d}
          onClick={() => onDigit(d)}
        >
          {d}
        </button>
      ))}
      <button
        id={clearId}
        type="button"
        class="num"
        aria-label="Clear cell"
        onClick={onClear}
      >
        ⌫
      </button>
    </div>
  );
}
