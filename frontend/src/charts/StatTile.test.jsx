import { act, render, screen } from "@testing-library/react";
import { formatPercent } from "./scale.js";
import { StatTile } from "./StatTile.jsx";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.useRealTimers();
});
const reduceMotion = () => { window.matchMedia = (media) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} }); };

describe("StatTile", () => {
  it("shows a label, a static value and a note", () => {
    const { container } = render(<StatTile label="Rules" value="23" note="weighted regex rules" />);
    expect(container.querySelector(".stat-label").textContent).toBe("Rules");
    expect(container.querySelector(".stat-value").textContent).toBe("23");
    expect(screen.getByText("weighted regex rules")).toBeTruthy();
  });

  it("omits the note when there is none", () => {
    const { container } = render(<StatTile label="Rules" value="23" />);
    expect(container.querySelector(".stat-note")).toBeNull();
  });

  it("shows the final value at once under reduced motion", () => {
    reduceMotion();
    const { container } = render(<StatTile label="Recall" countUp={0.952} format={formatPercent} />);
    expect(container.querySelector(".stat-value").textContent).toBe("95.2%");
  });

  it("counts up to the final value otherwise", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });
    const { container } = render(<StatTile label="Recall" countUp={0.952} format={formatPercent} />);
    expect(container.querySelector(".stat-value").textContent).toBe("0.0%");
    act(() => { vi.advanceTimersByTime(2000); });
    expect(container.querySelector(".stat-value").textContent).toBe("95.2%");
  });

  it("draws no accent bar by default", () => {
    const { container } = render(<StatTile label="Rules" value="23" />);
    expect(container.querySelector(".stat-accent")).toBeNull();
  });

  it("draws a coloured accent bar by tone slot, leaving the value text in the normal ink", () => {
    const { container } = render(<StatTile label="Recall" value="95.2%" tone={{ slot: 1 }} />);
    expect(container.querySelector(".stat-accent").className).toContain("bg-s1");
    expect(container.querySelector(".stat-value").className).not.toMatch(/-s\d/);
  });
});
