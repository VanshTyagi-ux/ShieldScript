import { fireEvent, render, screen } from "@testing-library/react";
import { BarChart } from "./BarChart.jsx";

const DATA = [
  { key: "a", label: "Rules", value: 50, slot: 2 },
  { key: "b", label: "ML alone", value: 100, slot: 3 },
  { key: "c", label: "Naive", value: 25, level: "critical" },
];
const mount = (props) => render(<BarChart data={DATA} domain={[0, 100]} format={(v) => `${v}`} valueLabel="Recall" {...props} />);
const bars = (container) => [...container.querySelectorAll(".mark")];
const groups = (container) => [...container.querySelectorAll(".mark-group")];
const num = (el, attr) => Number(el.getAttribute(`data-${attr}`));

describe("BarChart", () => {
  it("draws one bar per item, in order, with widths proportional to the values", () => {
    const { container } = mount();
    const widths = bars(container).map((b) => num(b, "w"));
    expect(widths).toHaveLength(3);
    expect(widths[1]).toBeCloseTo(widths[0] * 2);
    expect(widths[2]).toBeCloseTo(widths[0] / 2);
    const viewWidth = Number(container.querySelector("svg").getAttribute("viewBox").split(" ")[2]);
    expect(widths[1]).toBeLessThan(viewWidth);
  });

  it("keeps bars at most 24px thick", () => {
    const { container } = mount();
    expect(bars(container).every((b) => num(b, "h") <= 24)).toBe(true);
  });

  it("colours by categorical slot or by risk level", () => {
    const { container } = mount();
    const classes = bars(container).map((b) => b.getAttribute("class"));
    expect(classes[0]).toContain("fill-s2");
    expect(classes[1]).toContain("fill-s3");
    expect(classes[2]).toContain("fill-t-critical");
  });

  it("labels the axis at clean ticks and each bar at its tip", () => {
    const { container } = mount();
    expect([...container.querySelectorAll(".tick-text")].map((t) => t.textContent)).toEqual(["0", "20", "40", "60", "80", "100"]);
    expect([...container.querySelectorAll(".value-text")].map((t) => t.textContent)).toEqual(["50", "100", "25"]);
    expect(screen.getByText("ML alone")).toBeTruthy();
  });

  it("makes every bar a focusable group with a full accessible name", () => {
    const { container } = mount();
    const names = groups(container).map((g) => g.getAttribute("aria-label"));
    expect(names).toEqual(["Rules: 50", "ML alone: 100", "Naive: 25"]);
    expect(groups(container).every((g) => g.getAttribute("tabindex") === "0")).toBe(true);
  });

  it("shows a tooltip on hover and on focus, value first, and hides it on Escape", () => {
    const { container } = mount();
    fireEvent.pointerEnter(groups(container)[0]);
    const row = screen.getByRole("tooltip").querySelector(".tip-row");
    expect([...row.children].slice(1).map((el) => el.textContent)).toEqual(["50", "Recall"]);
    fireEvent.pointerLeave(groups(container)[0]);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(groups(container)[1]);
    expect(screen.getByRole("tooltip").querySelector(".tip-title").textContent).toBe("ML alone");
    fireEvent.keyDown(groups(container)[1], { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("draws no bar for a zero value, and never emits NaN", () => {
    const { container } = mount({ data: [{ key: "z", label: "Zero", value: 0, slot: 1 }, DATA[1]] });
    expect(bars(container)).toHaveLength(1);
    expect(groups(container)).toHaveLength(2);
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("shows n/a, without a bar, for a value that is not a number", () => {
    const { container } = mount({ data: [{ key: "n", label: "Broken", value: undefined, slot: 1 }, DATA[1]] });
    expect(bars(container)).toHaveLength(1);
    expect([...container.querySelectorAll(".value-text")].map((t) => t.textContent)).toEqual(["n/a", "100"]);
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("says so when there is no data", () => {
    const { container } = mount({ data: [] });
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("No data")).toBeTruthy();
  });

  it("truncates a long label on the axis but keeps the full name for assistive tech and the tooltip", () => {
    const long = "A".repeat(60);
    const { container } = mount({ data: [{ key: "l", label: long, value: 10, slot: 1 }] });
    const shown = [...container.querySelectorAll(".axis-text:not(.tick-text)")][0].textContent;
    expect(shown.length).toBeLessThanOrEqual(34);
    expect(shown.endsWith("…")).toBe(true);
    expect(groups(container)[0].getAttribute("aria-label")).toBe(`${long}: 10`);
  });

  it("renders hostile labels as literal text", () => {
    const { container } = mount({ data: [{ key: "x", label: "<script>alert(1)</script>", value: 5, slot: 1 }] });
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});
