// Pencil marks sit in a 3x3 grid, and the digit has to land in its own square.

import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import { PencilMarks } from "../../web/ui/PencilMarks.tsx";

const spans = (marks: number[], hot: number[] = []) => {
  cleanup();
  const { container } = render(<PencilMarks marks={marks} hot={hot} />);
  return [...container.querySelectorAll("span")];
};

describe("PencilMarks", () => {
  it("always lays out all nine positions, so a digit keeps its square", () => {
    const cells = spans([2, 9]);
    expect(cells.length).toBe(9);
    expect(cells.map((s) => s.textContent)).toEqual(["", "2", "", "", "", "", "", "", "9"]);
  });

  it("reddens only the digits a full reveal is about", () => {
    const cells = spans([1, 3, 5], [3]);
    const hot = cells.filter((s) => s.className === "hot");
    expect(hot.map((s) => s.textContent)).toEqual(["3"]);
  });

  it("never reddens a digit that isn't pencilled in", () => {
    const cells = spans([1], [4]);
    expect(cells.find((s) => s.className === "hot")!.textContent).toBe("");
  });
});
