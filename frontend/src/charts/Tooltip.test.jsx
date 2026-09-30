import { fireEvent, render, screen } from "@testing-library/react";
import { useChartTooltip } from "./Tooltip.jsx";

function Demo({ title = "Rules" }) {
  const { wrapRef, layer, bindMark } = useChartTooltip();
  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg>
        <rect data-testid="mark" width="10" height="10"
          {...bindMark({ label: "Rules: 94.2%", title, rows: [{ label: "Recall", value: "94.2%", slot: 2 }] })} />
      </svg>
      {layer}
    </div>
  );
}
const mark = () => screen.getByTestId("mark");

describe("useChartTooltip", () => {
  it("makes each mark focusable with a full accessible name", () => {
    render(<Demo />);
    expect(mark().getAttribute("tabindex")).toBe("0");
    expect(mark().getAttribute("aria-label")).toBe("Rules: 94.2%");
  });

  it("shows nothing until a mark is hovered", () => {
    render(<Demo />);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows a tooltip with the value first and the name second, keyed by the series colour", () => {
    render(<Demo />);
    fireEvent.pointerEnter(mark());
    const tip = screen.getByRole("tooltip");
    const row = tip.querySelector(".tip-row");
    expect([...row.children].map((el) => el.textContent)).toEqual(["", "94.2%", "Recall"]);
    expect(row.querySelector(".tip-key").className).toContain("bg-s2");
    expect(tip.querySelector(".tip-title").textContent).toBe("Rules");
  });

  it("shows on keyboard focus and hides on blur", () => {
    render(<Demo />);
    fireEvent.focus(mark());
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.blur(mark());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides when the pointer leaves", () => {
    render(<Demo />);
    fireEvent.pointerEnter(mark());
    fireEvent.pointerLeave(mark());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides on Escape", () => {
    render(<Demo />);
    fireEvent.focus(mark());
    fireEvent.keyDown(mark(), { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("renders labels as literal text, never as markup", () => {
    render(<Demo title="<b>x</b>" />);
    fireEvent.focus(mark());
    const tip = screen.getByRole("tooltip");
    expect(tip.querySelector("b")).toBeNull();
    expect(tip.querySelector(".tip-title").textContent).toBe("<b>x</b>");
  });
});
