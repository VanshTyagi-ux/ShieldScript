import { render, screen } from "@testing-library/react";
import { ScoreBreakdown } from "./ScoreBreakdown.jsx";

const finding = (rule_id, name, category, weight) => ({ rule_id, name, category, weight });
const FINDINGS = [
  finding("XSS002", "Inline event handler (known)", "markup", 60),
  finding("XSS007", "Handler-carrying tag", "markup", 15),
  finding("XSS033", "Popup probe", "javascript", 20),
];
const marks = (c) => [...c.querySelectorAll(".mark")];
const num = (el, attr) => Number(el.getAttribute(`data-${attr}`));
const viewWidth = (c) => Number(c.querySelector("svg").getAttribute("viewBox").split(" ")[2]);

describe("ScoreBreakdown", () => {
  it("titles itself and draws one segment per rule that fired", () => {
    const { container } = render(<ScoreBreakdown findings={FINDINGS} score={95} />);
    expect(screen.getByRole("heading", { name: "Where the score comes from" })).toBeTruthy();
    expect(marks(container)).toHaveLength(3);
  });

  it("sizes segments by weight and colours them by the rule's category", () => {
    const { container } = render(<ScoreBreakdown findings={FINDINGS} score={95} />);
    const m = marks(container);
    expect((num(m[0], "w") + 2) / (num(m[1], "w") + 2)).toBeCloseTo(60 / 15);
    expect(m[0].getAttribute("class")).toContain("fill-s1");
    expect(m[1].getAttribute("class")).toContain("fill-s1");
    expect(m[2].getAttribute("class")).toContain("fill-s3");
  });

  it("marks only the blocking threshold when the weights fit under the cap", () => {
    const { container } = render(<ScoreBreakdown findings={FINDINGS} score={95} />);
    expect(container.querySelectorAll(".marker")).toHaveLength(1);
    expect(screen.getByText("Blocked from 25")).toBeTruthy();
    expect(num(container.querySelector(".marker"), "x")).toBeCloseTo(viewWidth(container) * 0.25);
  });

  it("also marks the cap when the weights add up to more than 100", () => {
    const over = [finding("XSS001", "Script tag", "markup", 70), finding("XSS002", "Inline event handler (known)", "markup", 60)];
    const { container } = render(<ScoreBreakdown findings={over} score={100} />);
    expect(container.querySelectorAll(".marker")).toHaveLength(2);
    const cap = [...container.querySelectorAll(".marker")].find((m) => num(m, "x") > viewWidth(container) * 0.5);
    expect(num(cap, "x")).toBeCloseTo((100 / 130) * viewWidth(container));
    expect(screen.getByText("Capped at 100")).toBeTruthy();
    expect(marks(container).every((m) => num(m, "x") + num(m, "w") <= viewWidth(container) + 0.01)).toBe(true);
  });

  it("names each rule in a legend", () => {
    render(<ScoreBreakdown findings={FINDINGS} score={95} />);
    expect(screen.getByText("XSS033 Popup probe")).toBeTruthy();
  });

  it("says so, without a chart, when no rule fired", () => {
    const { container } = render(<ScoreBreakdown findings={[]} score={0} />);
    expect(screen.getByText("No rules fired.")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("copes with a rule of unknown category or weight 0", () => {
    const odd = [finding("X1", "Odd", "mystery", 40), finding("X2", "Zero", "markup", 0)];
    const { container } = render(<ScoreBreakdown findings={odd} score={40} />);
    expect(container.innerHTML).not.toContain("NaN");
    expect(marks(container)).toHaveLength(1);
  });
});
