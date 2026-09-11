// The board loop every tab shares.
//
// The coordinate attributes are not decoration: style.css draws the 3x3 box
// borders with `.cell[data-c="2"]`-style rules, and the page tests find a cell
// by them. Losing them is a silent, board-wide visual break.

import { describe, it, expect } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { Grid } from "../../web/ui/Grid.tsx";

describe("Grid", () => {
  it("lays cells out row-major and labels each with its coordinates", () => {
    cleanup();
    const { container } = render(
      <Grid size={9} className="board" cellClass={() => "cell"} cell={() => null} />,
    );
    const cells = [...container.querySelectorAll(".cell")];
    expect(cells.length).toBe(81);
    expect(cells[10].getAttribute("data-r")).toBe("1");
    expect(cells[10].getAttribute("data-c")).toBe("1");
    expect(cells[10].getAttribute("data-i")).toBe("10");
  });

  it("hands each cell the classes and handlers its caller decided on", () => {
    cleanup();
    const clicked: string[] = [];
    const { container } = render(
      <Grid
        size={3}
        className="qboard"
        cellClass={(r, c) => (r === c ? "qcell sel" : "qcell")}
        cellProps={(r, c) => ({ onClick: () => clicked.push(`${r},${c}`) })}
        cell={(r, c) => <span>{r * 3 + c}</span>}
      />,
    );
    const cells = [...container.querySelectorAll(".qcell")];
    expect(cells.filter((el) => el.className.includes("sel")).length).toBe(3);
    expect(cells[5].textContent).toBe("5");
    fireEvent.click(cells[5]);
    expect(clicked).toEqual(["1,2"]);
  });
});
