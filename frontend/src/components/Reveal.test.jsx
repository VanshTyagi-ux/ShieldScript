import { act, render } from "@testing-library/react";
import { FeatureGrid } from "./FeatureGrid.jsx";
import { Reveal } from "./Reveal.jsx";

const originalObserver = window.IntersectionObserver;
afterEach(() => {
  if (originalObserver) window.IntersectionObserver = originalObserver;
  else delete window.IntersectionObserver;
});

describe("Reveal", () => {
  it("is visible at once when IntersectionObserver is unsupported, so nothing is ever hidden", () => {
    delete window.IntersectionObserver;
    const { container } = render(<Reveal><p>hello</p></Reveal>);
    expect(container.querySelector(".reveal").className).toContain("is-visible");
  });

  it("reveals when scrolled into view", () => {
    const observers = [];
    window.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this); }
    };
    const { container } = render(<Reveal><p>hello</p></Reveal>);
    expect(container.querySelector(".reveal").className).not.toContain("is-visible");
    act(() => observers[0].callback([{ isIntersecting: true }]));
    expect(container.querySelector(".reveal").className).toContain("is-visible");
  });
});

describe("FeatureGrid", () => {
  it("shows six features, each with a title and a description", () => {
    const { container } = render(<FeatureGrid />);
    expect(container.querySelectorAll("li.feature")).toHaveLength(6);
    expect(container.querySelectorAll("h3")).toHaveLength(6);
    expect([...container.querySelectorAll("li.feature")].every((li) => li.querySelector("p").textContent.length > 20)).toBe(true);
  });

  it("uses decorative icons", () => {
    const { container } = render(<FeatureGrid />);
    expect([...container.querySelectorAll(".feature-icon svg")].every((s) => s.getAttribute("aria-hidden") === "true")).toBe(true);
  });
});
