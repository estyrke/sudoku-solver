/**
 * The side panel every tab shows: a hint, the ladder that reveals it in three
 * steps, and the last solve's result.
 *
 * The ladder exists because a hint that opens with its full reasoning has
 * already spoiled the puzzle. Level 1 nudges, level 2 names the technique,
 * level 3 gives the argument — nobody is forced past the step they wanted.
 */

/** What the hint box is currently showing. */
export type HintView =
  | { kind: "none" }
  /** A refusal or an error — "the board is invalid", "already solved". */
  | { kind: "message"; text: string; warn?: boolean }
  | {
      kind: "reveal";
      level: number;
      nudge: string;
      technique: string;
      explanation: string;
    };

export const NO_HINT: HintView = { kind: "none" };

export function HintPanel({
  hintId,
  revealId,
  resultId,
  hint,
  onReveal,
  result,
  resultWarn,
}: {
  /** DOM ids, kept because style.css, pwa.ts and the page tests name them. */
  hintId: string;
  revealId: string;
  resultId: string;
  hint: HintView;
  onReveal: (level: number) => void;
  /** The last solve's outcome; null before there has been one. */
  result: string | null;
  /** Whether that outcome is a refusal rather than a solve. */
  resultWarn?: boolean;
}) {
  return (
    <aside class="panel">
      <h2>Hint</h2>
      <div id={hintId} class={hint.kind === "none" ? "hint empty" : "hint"}>
        {hint.kind === "none" && "No hint yet."}
        {hint.kind === "message" &&
          (hint.warn ? <span class="warn">{hint.text}</span> : hint.text)}
        {hint.kind === "reveal" && (
          <>
            {hint.level >= 1 && <div>{hint.nudge}</div>}
            {hint.level >= 2 && <div class="tech">{hint.technique}</div>}
            {hint.level >= 3 && <div>{hint.explanation}</div>}
          </>
        )}
      </div>
      <div id={revealId} class="reveal" hidden={hint.kind !== "reveal"}>
        {[
          [1, "Nudge"],
          [2, "Technique"],
          [3, "Full"],
        ].map(([level, label]) => (
          <button
            key={level}
            type="button"
            class={hint.kind === "reveal" && hint.level === level ? "active" : undefined}
            data-level={level}
            onClick={() => onReveal(level as number)}
          >
            {label}
          </button>
        ))}
      </div>
      <h2 class="result-heading">Result</h2>
      <div id={resultId} class={result === null ? "hint empty" : "hint"}>
        {result === null ? (
          "No solve yet."
        ) : resultWarn ? (
          <span class="warn">{result}</span>
        ) : (
          result
        )}
      </div>
    </aside>
  );
}
