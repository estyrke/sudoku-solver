// What the pad says about the cell you have selected.
//
// The state classes are the whole point of this component: they are how the
// pad answers "what's already in here?" before the next tap, and they were
// two hand-written sync functions — one per tab — before it existed.

import { describe, it, expect } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { Numpad } from "../../web/ui/Numpad.tsx";

const pad = (props: Partial<Parameters<typeof Numpad>[0]> = {}) => {
  cleanup();
  const { container } = render(
    <Numpad onDigit={() => {}} onClear={() => {}} {...props} />,
  );
  return (d: number) =>
    container.querySelector(`[data-digit="${d}"]`)!.className;
};

describe("Numpad", () => {
  it("fills in the digit the cell already holds", () => {
    const cls = pad({ value: 4 });
    expect(cls(4)).toContain("current");
    expect(cls(5)).not.toContain("current");
  });

  it("rings every digit pencilled into the cell", () => {
    const cls = pad({ marks: [2, 9] });
    expect(cls(2)).toContain("marked");
    expect(cls(9)).toContain("marked");
    expect(cls(3)).not.toContain("marked");
  });

  it("says nothing when no cell is selected", () => {
    const cls = pad();
    for (let d = 1; d <= 9; d++) expect(cls(d)).toBe("num");
  });

  it("reports taps by digit, and the clear key separately", () => {
    cleanup();
    const taps: (number | "clear")[] = [];
    const { container } = render(
      <Numpad onDigit={(d) => taps.push(d)} onClear={() => taps.push("clear")} />,
    );
    fireEvent.click(container.querySelector('[data-digit="7"]')!);
    fireEvent.click(container.querySelector('[aria-label="Clear cell"]')!);
    expect(taps).toEqual([7, "clear"]);
  });
});
