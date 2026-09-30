import { fireEvent, render, screen } from "@testing-library/react";
import { GroupedBars } from "./GroupedBars.jsx";

const SERIES = [{ key: "rules", label: "Rules recall", slot: 2 }, { key: "ml", label: "ML recall", slot: 3 }];
const GROUPS = [
  { key: "g1", label: "List one", values: { rules: 0.5, ml: 1 } },
  { key: "g2", label: "List two", values: { rules: 1, ml: 0.25 } },
  { key: "g3", label: "List three", values: { rules: 0.75, ml: 0.5 } },
];
const pct = (v) => `${Math.round(v * 100)}%`;
const mount = (props) => render(<GroupedBars groups={GROUPS} series={SERIES} domain={[0, 1]} format={pct} {...props} />);
const bars = (container) => [...container.querySelectorAll(".mark")];
const num = (el, attr) => Number(el.getAttribute(`data-${attr}`));

describe("GroupedBars", () => {
  it("draws one bar per series per group", () => {
    const { container } = mount();
    expect(bars(container)).toHaveLength(6);
  });

  it("gives each series the same colour in every group", () => {
    const { container } = mount();
    const classes = bars(container).map((b) => b.getAttribute("class"));
    [0, 2, 4].forEach((i) => expect(classes[i]).toContain("fill-s2"));
    [1, 3, 5].forEach((i) => expect(classes[i]).toContain("fill-s3"));
  });

  it("scales widths to the domain and keeps a 2px gap between a group's bars", () => {
    const { container } = mount();
    const b = bars(container);
    expect(num(b[1], "w")).toBeCloseTo(num(b[0], "w") * 2); // 1.0 vs 0.5
    expect(num(b[1], "y") - (num(b[0], "y") + num(b[0], "h"))).toBeCloseTo(2);
    expect(b.every((bar) => num(bar, "h") <= 24)).toBe(true);
  });

  it("labels each bar tip and each group", () => {
    const { container } = mount();
    expect([...container.querySelectorAll(".value-text")].map((t) => t.textContent)).toEqual(["50%", "100%", "100%", "25%", "75%", "50%"]);
    expect(screen.getByText("List two")).toBeTruthy();
  });

  it("gives every bar a focusable name, and a tooltip listing all the group's series", () => {
    const { container } = mount();
    const focusable = [...container.querySelectorAll(".mark-group")];
    expect(focusable).toHaveLength(6);
    expect(focusable[0].getAttribute("aria-label")).toBe("List one, Rules recall: 50%");
    fireEvent.pointerEnter(focusable[0]);
    const rows = [...screen.getByRole("tooltip").querySelectorAll(".tip-row")];
    expect(rows.map((r) => [...r.children].slice(1).map((el) => el.textContent))).toEqual([["50%", "Rules recall"], ["100%", "ML recall"]]);
  });

  it("shows n/a, without a bar, for a missing series value", () => {
    const { container } = mount({ groups: [{ key: "g", label: "Partial", values: { rules: 0.5 } }] });
    expect(bars(container)).toHaveLength(1);
    expect([...container.querySelectorAll(".value-text")].map((t) => t.textContent)).toEqual(["50%", "n/a"]);
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("says so when there are no groups", () => {
    mount({ groups: [] });
    expect(screen.getByText("No data")).toBeTruthy();
  });
});
