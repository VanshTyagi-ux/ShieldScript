import { fireEvent, render, screen } from "@testing-library/react";
import { Sparkline } from "./Sparkline.jsx";

const POINTS = [
  { value: 0, label: "scan 1" },
  { value: 25, label: "scan 2" },
  { value: 100, label: "scan 3" },
];
const mount = (props) => render(<Sparkline points={POINTS} domain={[0, 100]} reference={{ value: 25, label: "Blocked from 25" }} {...props} />);
const svg = (container) => container.querySelector("svg");
const tipValue = () => screen.getByRole("tooltip").querySelector(".tip-row strong").textContent;
const num = (el, attr) => Number(el.getAttribute(`data-${attr}`));

describe("Sparkline", () => {
  it("draws one line through every point", () => {
    const { container } = mount();
    const d = container.querySelector(".spark-line").getAttribute("d");
    expect((d.match(/[ML]/g) || []).length).toBe(3);
    expect(d).not.toContain("NaN");
  });

  it("places points by value on the domain, higher values higher up", () => {
    const { container } = mount();
    const ys = [...container.querySelectorAll(".spark-point")].map((p) => num(p, "y"));
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1]).toBeGreaterThan(ys[2]);
  });

  it("draws the reference line at its value, labelled", () => {
    const { container } = mount();
    const points = [...container.querySelectorAll(".spark-point")];
    expect(num(container.querySelector(".ref-line"), "y")).toBeCloseTo(num(points[1], "y"));
    expect(screen.getByText("Blocked from 25")).toBeTruthy();
  });

  it("marks the latest point with an end dot that has a surface ring", () => {
    const { container } = mount();
    const dot = container.querySelector(".spark-end");
    expect(Number(dot.getAttribute("r"))).toBeGreaterThanOrEqual(4);
    expect(dot.getAttribute("class")).toContain("ring");
  });

  it("shows a tooltip when a point is hovered", () => {
    const { container } = mount();
    fireEvent.pointerEnter(container.querySelectorAll(".spark-point")[1]);
    expect(tipValue()).toBe("25");
    expect(screen.getByRole("tooltip").querySelector(".tip-title").textContent).toBe("scan 2");
  });

  it("is one tab stop that steps through the points with the arrow keys", () => {
    const { container } = mount();
    expect(svg(container).getAttribute("tabindex")).toBe("0");
    expect(container.querySelectorAll(".spark-point[tabindex='0']")).toHaveLength(0);
    fireEvent.focus(svg(container));
    expect(tipValue()).toBe("100"); // starts on the latest point
    fireEvent.keyDown(svg(container), { key: "ArrowLeft" });
    expect(tipValue()).toBe("25");
    fireEvent.keyDown(svg(container), { key: "Home" });
    expect(tipValue()).toBe("0");
    fireEvent.keyDown(svg(container), { key: "ArrowLeft" });
    expect(tipValue()).toBe("0"); // clamped at the start
    fireEvent.keyDown(svg(container), { key: "End" });
    expect(tipValue()).toBe("100");
    fireEvent.keyDown(svg(container), { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides the tooltip when focus leaves", () => {
    const { container } = mount();
    fireEvent.focus(svg(container));
    fireEvent.blur(svg(container));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("draws only the marker for a single point", () => {
    const { container } = mount({ points: [POINTS[1]] });
    expect(container.querySelector(".spark-line")).toBeNull();
    expect(container.querySelector(".spark-end")).not.toBeNull();
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("clamps values outside the domain and ignores values that are not numbers", () => {
    const { container } = mount({ points: [{ value: 500, label: "high" }, { value: NaN, label: "bad" }, { value: -20, label: "low" }] });
    expect(container.querySelectorAll(".spark-point")).toHaveLength(2);
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("says so when there is no data", () => {
    mount({ points: [] });
    expect(screen.getByText("No data")).toBeTruthy();
  });

  it("names the chart and how to use it", () => {
    const { container } = mount({ ariaLabel: "Score history" });
    expect(svg(container).getAttribute("aria-label")).toContain("Score history");
    expect(svg(container).getAttribute("aria-label")).toContain("arrow keys");
  });

  it("draws no area fill by default", () => {
    const { container } = mount();
    expect(container.querySelector(".spark-area")).toBeNull();
  });

  it("draws a closed area fill under the line when area is set", () => {
    const { container } = mount({ area: true });
    const d = container.querySelector(".spark-area").getAttribute("d");
    expect(d).not.toContain("NaN");
    expect(d.trim().endsWith("Z")).toBe(true);
  });

  it("colours the line, end marker and area by tone slot instead of the default accent", () => {
    const { container } = mount({ tone: { slot: 2 }, area: true });
    expect(container.querySelector(".spark-line").getAttribute("class")).toContain("stroke-s2");
    expect(container.querySelector(".spark-end").getAttribute("class")).toContain("fill-s2");
    expect(container.querySelector(".spark-area").getAttribute("class")).toContain("fill-s2");
  });
});
