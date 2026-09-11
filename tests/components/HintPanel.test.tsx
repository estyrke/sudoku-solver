// The reveal ladder: nobody is forced past the step they asked for.
//
// A hint that opens with its full reasoning has already spoiled the puzzle, so
// what each level does and does not show is a rule worth pinning down.

import { describe, it, expect } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { HintPanel, NO_HINT, type HintView } from "../../web/ui/HintPanel.tsx";

const REVEAL = {
  kind: "reveal" as const,
  nudge: "Look at row 4.",
  technique: "Naked single",
  explanation: "r4c5 can only be 7.",
};

function panel(hint: HintView, result: string | null = null) {
  cleanup();
  const { container } = render(
    <HintPanel
      hintId="hint"
      revealId="reveal"
      resultId="result"
      hint={hint}
      onReveal={() => {}}
      result={result}
    />,
  );
  return container;
}

describe("HintPanel", () => {
  it("offers no ladder until there is a hint to climb", () => {
    const el = panel(NO_HINT);
    expect(el.querySelector("#hint")!.className).toBe("hint empty");
    expect(el.querySelector<HTMLElement>("#reveal")!.hidden).toBe(true);
  });

  it("nudges at level 1, and gives away neither the technique nor the why", () => {
    const text = panel({ ...REVEAL, level: 1 }).querySelector("#hint")!.textContent;
    expect(text).toContain("Look at row 4.");
    expect(text).not.toContain("Naked single");
    expect(text).not.toContain("r4c5");
  });

  it("names the technique at level 2, still without the argument", () => {
    const text = panel({ ...REVEAL, level: 2 }).querySelector("#hint")!.textContent;
    expect(text).toContain("Naked single");
    expect(text).not.toContain("r4c5");
  });

  it("gives the whole argument at level 3", () => {
    const text = panel({ ...REVEAL, level: 3 }).querySelector("#hint")!.textContent;
    expect(text).toContain("r4c5 can only be 7.");
  });

  it("marks the rung you are standing on", () => {
    const el = panel({ ...REVEAL, level: 2 });
    const active = [...el.querySelectorAll("#reveal button")].filter((b) =>
      b.className.includes("active"),
    );
    expect(active.map((b) => b.getAttribute("data-level"))).toEqual(["2"]);
  });

  it("asks for the level that was clicked", () => {
    cleanup();
    const asked: number[] = [];
    const { container } = render(
      <HintPanel
        hintId="hint"
        revealId="reveal"
        resultId="result"
        hint={{ ...REVEAL, level: 1 }}
        onReveal={(level) => asked.push(level)}
        result={null}
      />,
    );
    fireEvent.click(container.querySelector('#reveal [data-level="3"]')!);
    expect(asked).toEqual([3]);
  });

  it("shows a refusal as a warning, with no ladder behind it", () => {
    const el = panel({ kind: "message", text: "Already solved.", warn: true });
    expect(el.querySelector("#hint .warn")!.textContent).toBe("Already solved.");
    expect(el.querySelector<HTMLElement>("#reveal")!.hidden).toBe(true);
  });

  it("keeps the result box empty until something has been solved", () => {
    expect(panel(NO_HINT).querySelector("#result")!.className).toBe("hint empty");
    expect(panel(NO_HINT, "Solved.").querySelector("#result")!.className).toBe("hint");
  });
});
