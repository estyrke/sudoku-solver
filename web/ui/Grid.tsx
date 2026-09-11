import type { ComponentChildren } from "preact";

/**
 * A square board of cells, laid out row-major.
 *
 * The three tabs' boards differ in their CSS (`.board`/`.cell` for Sudoku and
 * Killer, `.qboard`/`.qcell` for Queens) and in what a cell contains, but not
 * in the loop that produces them — and `.cell[data-c="2"]`-style rules in
 * style.css mean the coordinate attributes have to be on every cell either
 * way. So the loop and the attributes live here and the rest is the caller's.
 *
 * `cell` returns the cell's contents; everything else about the cell element
 * (its classes, its handlers) comes from the `cellProps` callback, so a caller
 * never has to re-derive r/c from a data attribute.
 */
export function Grid<P extends Record<string, unknown>>({
  size,
  className,
  cellClass,
  style,
  cellProps,
  cell,
  elementRef,
  ...rest
}: {
  size: number;
  className: string;
  cellClass: (r: number, c: number) => string;
  style?: Record<string, string>;
  cellProps?: (r: number, c: number) => P;
  cell: (r: number, c: number) => ComponentChildren;
  /** The grid element itself, for callers that need to focus or measure it. */
  elementRef?: (el: HTMLElement | null) => void;
} & Record<string, any>) {
  const squares = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      squares.push(
        <div
          key={`${r},${c}`}
          class={cellClass(r, c)}
          data-r={r}
          data-c={c}
          data-i={r * size + c}
          {...(cellProps ? cellProps(r, c) : {})}
        >
          {cell(r, c)}
        </div>,
      );
    }
  }
  return (
    <div class={className} style={style} ref={elementRef} {...rest}>
      {squares}
    </div>
  );
}
