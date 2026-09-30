import { fireEvent, render, screen } from "@testing-library/react";
import { StackedBar } from "./StackedBar.jsx";

const SEGMENTS = [
  { key: "a", label: "markup", value: 60, slot: 1 },
  { key: "b", label: "javascript", value: 20, slot: 3 },
  { key: "c", label: "css", value: 20, level: "high" },
];
const mount = (props) => render(<StackedBar segments={SEGMENTS} format={(v) => `${v}`} {...props} />);
const marks = (container) => [...container.querySelectorAll(".mark")];
const num = (el, attr) => Number(el.getAttribute(`data-${attr}`));
const viewWidth = (container) => Number(container.querySelector("svg").getAttribute("viewBox").split(" ")[2]);

describe("StackedBar", () => {
  it("draws one segment per value, coloured by slot or level", () => {
    const { container } = mount();
    const classes = marks(container).map((m) => m.getAttribute("class"));
    expect(classes[0]).toContain("fill-s1");
    expect(classes[1]).toContain("fill-s3");
    expect(classes[2]).toContain("fill-t-high");
  });

  it("separates touching segments with a 2px gap and fills the width for a full total", () => {
    const { container } = mount();
    const m = marks(container);
    expect(num(m[1], "x") - (num(m[0], "x") + num(m[0], "w"))).toBeCloseTo(2);
    expect(num(m[2], "x") - (num(m[1], "x") + num(m[1], "w"))).toBeCloseTo(2);
    expect(num(m[2], "x") + num(m[2], "w")).toBeCloseTo(viewWidth(container));
  });

  it("sizes segments in proportion to their values", () => {
    const { container } = mount();
    const m = marks(container);
    const w = viewWidth(container);
    expect(num(m[0], "w") + 2).toBeCloseTo(w * 0.6);
    expect(num(m[2], "w")).toBeCloseTo(w * 0.2);
  });

  it("labels a segment under the bar, in muted text, only when the label fits", () => {
    const { container } = mount({ segments: [...SEGMENTS, { key: "t", label: "tiny", value: 0.5, slot: 5 }] });
    const labels = [...container.querySelectorAll(".seg-label")].map((t) => t.textContent);
    expect(labels).toEqual(["markup", "javascript", "css"]);
    expect(container.querySelector(".seg-label").getAttribute("class")).toContain("axis-text");
  });

  it("draws reference markers at their position on the domain, with labels", () => {
    const { container } = mount({ markers: [{ value: 25, label: "Blocked from 25" }] });
    const marker = container.querySelector(".marker");
    expect(num(marker, "x")).toBeCloseTo(viewWidth(container) * 0.25);
    expect(screen.getByText("Blocked from 25")).toBeTruthy();
  });

  it("widens the domain when the sum exceeds the total, so nothing overflows", () => {
    const { container } = mount({ segments: [{ key: "a", label: "a", value: 130, slot: 1 }], total: 100, markers: [{ value: 100, label: "Capped at 100" }] });
    expect(num(container.querySelector(".marker"), "x")).toBeCloseTo((100 / 130) * viewWidth(container));
    expect(marks(container).every((m) => num(m, "x") + num(m, "w") <= viewWidth(container) + 0.01)).toBe(true);
  });

  it("leaves room for the unfilled part when the total exceeds the sum", () => {
    const { container } = mount({ total: 200 });
    const last = marks(container)[2];
    expect(num(last, "x") + num(last, "w")).toBeCloseTo(viewWidth(container) * 0.5);
  });

  it("drops segments that are zero or not numbers", () => {
    const { container } = mount({ segments: [...SEGMENTS, { key: "z", label: "zero", value: 0, slot: 2 }, { key: "n", label: "nan", value: NaN, slot: 4 }] });
    expect(marks(container)).toHaveLength(3);
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("says so when everything is zero or empty", () => {
    mount({ segments: [{ key: "z", label: "zero", value: 0, slot: 1 }] });
    expect(screen.getByText("No data")).toBeTruthy();
  });

  it("gives each segment a focusable name and a tooltip on hover and focus", () => {
    const { container } = mount();
    const groups = [...container.querySelectorAll(".mark-group")];
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["markup: 60 (60%)", "javascript: 20 (20%)", "css: 20 (20%)"]);
    fireEvent.pointerEnter(groups[0]);
    expect(screen.getByRole("tooltip").querySelector(".tip-title").textContent).toBe("markup");
    fireEvent.pointerLeave(groups[0]);
    fireEvent.focus(groups[1]);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });
});
