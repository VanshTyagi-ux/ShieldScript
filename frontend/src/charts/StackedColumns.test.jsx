import { fireEvent, render, screen } from "@testing-library/react";
import { StackedColumns } from "./StackedColumns.jsx";

const SERIES = [
  { key: "allowed", label: "Allowed", level: "safe" },
  { key: "blocked", label: "Blocked", level: "critical" },
];
const COLUMNS = [
  { key: "a", label: "10:00", values: { allowed: 3, blocked: 2 } },
  { key: "b", label: "11:00", values: { allowed: 4, blocked: 0 } },
  { key: "c", label: "12:00", values: { allowed: 0, blocked: 0 } },
];
const mount = (props) => render(<StackedColumns columns={COLUMNS} series={SERIES} ariaLabel="Scans over time" {...props} />);
const marks = (container) => [...container.querySelectorAll(".mark")];
const num = (el, attr) => Number(el.getAttribute(`data-${attr}`));

describe("StackedColumns", () => {
  it("draws one group per column and a segment for each non-zero series", () => {
    const { container } = mount();
    expect(container.querySelectorAll(".mark-group")).toHaveLength(3);
    expect(marks(container)).toHaveLength(3); // a: 2 segments, b: 1, c: none
  });

  it("makes segment heights proportional to the values on one shared scale", () => {
    const { container } = mount({ columns: [{ key: "a", label: "x", values: { allowed: 30, blocked: 10 } }] });
    const [allowed, blocked] = marks(container);
    expect(num(allowed, "h")).toBeCloseTo(num(blocked, "h") * 3);
    const [first, second] = [{ allowed: 20, blocked: 0 }, { allowed: 40, blocked: 0 }];
    const both = mount({ columns: [{ key: "a", label: "a", values: first }, { key: "b", label: "b", values: second }] }).container;
    const [short, tall] = marks(both).slice(-2);
    expect(num(tall, "h")).toBeCloseTo(num(short, "h") * 2); // two columns share one scale
  });

  it("keeps a tiny non-zero segment visible next to a huge one", () => {
    const { container } = mount({ columns: [
      { key: "a", label: "a", values: { allowed: 1, blocked: 0 } },
      { key: "b", label: "b", values: { allowed: 500, blocked: 0 } },
    ] });
    const [tiny, huge] = marks(container);
    expect(num(tiny, "h")).toBeGreaterThanOrEqual(4);
    expect(num(huge, "h")).toBeGreaterThan(num(tiny, "h") * 10);
    expect(num(tiny, "y") + num(tiny, "h")).toBeCloseTo(num(huge, "y") + num(huge, "h")); // both sit on the baseline
  });

  it("stacks the first series at the bottom", () => {
    const { container } = mount({ columns: [COLUMNS[0]] });
    const [allowed, blocked] = marks(container);
    expect(num(allowed, "y")).toBeGreaterThan(num(blocked, "y"));
    expect(num(blocked, "y") + num(blocked, "h")).toBeCloseTo(num(allowed, "y")); // they touch (the gap is a surface-coloured stroke)
  });

  it("colours segments by risk level or categorical slot", () => {
    const { container } = mount({ series: [{ key: "allowed", label: "Allowed", slot: 1 }, SERIES[1]] });
    const classes = marks(container).map((m) => m.getAttribute("class"));
    expect(classes[0]).toContain("fill-s1");
    expect(classes[1]).toContain("fill-t-critical");
    expect(classes[0]).toContain("segment");
  });

  it("labels the value axis at clean ticks that reach the tallest column", () => {
    const { container } = mount({ tickFormat: (v) => `${v}` });
    const ticks = [...container.querySelectorAll(".tick-text")].map((t) => Number(t.textContent));
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(5); // the tallest column totals 5
  });

  it("labels the x axis sparsely so labels never overlap", () => {
    const many = Array.from({ length: 24 }, (_, i) => ({ key: `k${i}`, label: String(i).padStart(2, "0"), values: { allowed: 1, blocked: 1 } }));
    const { container } = mount({ columns: many });
    const labels = [...container.querySelectorAll(".x-label")];
    expect(labels.length).toBeGreaterThan(1);
    expect(labels.length).toBeLessThan(24);
    expect(new Set(labels.map((l) => l.getAttribute("x"))).size).toBe(labels.length);
  });

  it("shows the whole column in its tooltip on focus", () => {
    const { container } = mount();
    fireEvent.focus(container.querySelectorAll(".mark-group")[0]);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("10:00");
    expect(tip.textContent).toContain("Allowed");
    expect(tip.textContent).toContain("3");
    expect(tip.textContent).toContain("Blocked");
    expect(tip.textContent).toContain("2");
  });

  it("has an accessible name and a No data state", () => {
    const { container } = mount();
    expect(container.querySelector("svg").getAttribute("aria-label")).toBe("Scans over time");
    expect(container.querySelector(".mark-group").getAttribute("aria-label")).toMatch(/10:00/);
    const empty = render(<StackedColumns columns={[]} series={SERIES} ariaLabel="x" />);
    expect(empty.getByText("No data")).toBeTruthy();
  });

  it("handles a chart where every value is zero without NaN", () => {
    const { container } = mount({ columns: [COLUMNS[2]] });
    expect(container.innerHTML).not.toContain("NaN");
  });
});
