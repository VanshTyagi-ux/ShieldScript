import { render, screen } from "@testing-library/react";
import { Gauge } from "./Gauge.jsx";

const mount = (props) => render(<Gauge score={95} level="critical" {...props} />);
const fill = (container) => container.querySelector(".gauge-fill");

describe("Gauge", () => {
  it("shows the score as a large hero number", () => {
    const { container } = mount();
    expect(container.querySelector(".gauge-score").textContent).toBe("95");
    expect(screen.getByText("of 100")).toBeTruthy();
  });

  it("names itself for assistive tech with the score and level", () => {
    const { container } = mount();
    expect(container.querySelector("svg").getAttribute("aria-label")).toBe("Risk score 95 of 100, critical");
  });

  it("fills the arc up to the score, in the level colour", () => {
    const { container } = mount({ score: 50, level: "high" });
    expect(fill(container).getAttribute("d").endsWith("120 30")).toBe(true); // straight up at 50
    expect(fill(container).getAttribute("class")).toContain("stroke-t-high");
  });

  it("fills the whole semicircle at 100", () => {
    const { container } = mount({ score: 100 });
    expect(fill(container).getAttribute("d")).toBe("M 30 120 A 90 90 0 0 1 210 120");
  });

  it("draws no fill at 0", () => {
    const { container } = mount({ score: 0, level: "safe" });
    expect(fill(container)).toBeNull();
    expect(container.querySelector(".gauge-score").textContent).toBe("0");
  });

  it("clamps scores outside 0..100", () => {
    expect(fill(mount({ score: 150 }).container).getAttribute("d")).toBe("M 30 120 A 90 90 0 0 1 210 120");
    const low = mount({ score: -5, level: "safe" });
    expect(fill(low.container)).toBeNull();
    expect(mount({ score: 150 }).container.querySelector(".gauge-score").textContent).toBe("100");
  });

  it("does not emit NaN for a score that is not a number", () => {
    const { container } = mount({ score: undefined, level: "safe" });
    expect(container.innerHTML).not.toContain("NaN");
    expect(container.querySelector(".gauge-score").textContent).toBe("n/a");
  });

  it("draws the four level bands and labels the thresholds", () => {
    const { container } = mount();
    expect(container.querySelectorAll(".gauge-band")).toHaveLength(4);
    expect([...container.querySelectorAll(".gauge-tick")].map((t) => t.textContent)).toEqual(["25", "50", "75"]);
  });

  it("marks the score with a dot that has a surface ring", () => {
    const { container } = mount();
    const dot = container.querySelector(".gauge-dot");
    expect(Number(dot.getAttribute("r"))).toBeGreaterThanOrEqual(4);
    expect(dot.getAttribute("class")).toContain("ring");
  });
});
