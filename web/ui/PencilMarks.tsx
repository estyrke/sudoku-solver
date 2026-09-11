/**
 * A cell's pencil marks, as the 3x3 span grid `.marks` lays out.
 *
 * One span per digit position, always all nine of them: a single span of
 * joined text collapses into the grid's first cell, and a variable number of
 * spans puts the digits in the wrong squares.
 *
 * `hot` digits are the ones a fully-revealed elimination hint is about; they
 * are reddened by `.marks span.hot`.
 */
export function PencilMarks({
  marks,
  hot = [],
}: {
  marks: Iterable<number>;
  hot?: number[];
}) {
  const present = new Set(marks);
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <div class="marks">
      {digits.map((d) => (
        <span key={d} data-d={d} class={hot.includes(d) ? "hot" : undefined}>
          {present.has(d) ? String(d) : ""}
        </span>
      ))}
    </div>
  );
}
