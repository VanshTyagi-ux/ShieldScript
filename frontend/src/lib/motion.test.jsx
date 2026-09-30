import { act, render, renderHook, screen } from "@testing-library/react";
import { useCountUp } from "./useCountUp.js";
import { useReducedMotion } from "./useReducedMotion.js";
import { useReveal } from "./useReveal.js";

const originalMatchMedia = window.matchMedia;
const originalObserver = window.IntersectionObserver;

// Returns the change listeners so a test can fire them.
function stubMatchMedia(matches) {
  const listeners = new Set();
  window.matchMedia = (media) => ({
    matches, media,
    addEventListener: (_, cb) => listeners.add(cb),
    removeEventListener: (_, cb) => listeners.delete(cb),
  });
  return listeners;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  if (originalObserver) window.IntersectionObserver = originalObserver;
  else delete window.IntersectionObserver;
  vi.useRealTimers();
});

describe("useReducedMotion", () => {
  it("is false by default", () => {
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
  });

  it("is true when the user prefers reduced motion", () => {
    stubMatchMedia(true);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true);
  });

  it("is false, without throwing, when matchMedia is unavailable", () => {
    delete window.matchMedia;
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
  });

  it("follows changes to the preference", () => {
    const listeners = stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    act(() => listeners.forEach((cb) => cb({ matches: true })));
    expect(result.current).toBe(true);
  });
});

function Probe() {
  const [ref, visible] = useReveal();
  return <div ref={ref} data-testid="probe" data-visible={String(visible)} />;
}

describe("useReveal", () => {
  it("is visible at once when IntersectionObserver is unsupported", () => {
    delete window.IntersectionObserver;
    render(<Probe />);
    expect(screen.getByTestId("probe").dataset.visible).toBe("true");
  });

  it("becomes visible when the element intersects, then stops observing", () => {
    const observers = [];
    window.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; this.disconnect = vi.fn(); this.observe = vi.fn(); observers.push(this); }
    };
    render(<Probe />);
    expect(screen.getByTestId("probe").dataset.visible).toBe("false");
    act(() => observers[0].callback([{ isIntersecting: false }]));
    expect(screen.getByTestId("probe").dataset.visible).toBe("false");
    act(() => observers[0].callback([{ isIntersecting: true }]));
    expect(screen.getByTestId("probe").dataset.visible).toBe("true");
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it("is visible at once under reduced motion, without creating an observer", () => {
    stubMatchMedia(true);
    const created = vi.fn();
    window.IntersectionObserver = class { constructor() { created(); this.observe = vi.fn(); this.disconnect = vi.fn(); } };
    render(<Probe />);
    expect(screen.getByTestId("probe").dataset.visible).toBe("true");
    expect(created).not.toHaveBeenCalled();
  });
});

describe("useCountUp", () => {
  const fake = () => vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout"] });

  it("counts up monotonically and lands exactly on the target", () => {
    fake();
    const { result } = renderHook(() => useCountUp(100, { duration: 1000 }));
    expect(result.current).toBe(0);
    const samples = [];
    for (let i = 0; i < 4; i++) {
      act(() => { vi.advanceTimersByTime(250); });
      samples.push(result.current);
    }
    expect(samples[0]).toBeGreaterThan(0);
    expect(samples[0]).toBeLessThan(100);
    expect([...samples].sort((a, b) => a - b)).toEqual(samples);
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toBe(100);
  });

  it("returns the target immediately when inactive", () => {
    expect(renderHook(() => useCountUp(42, { active: false })).result.current).toBe(42);
  });

  it("returns the target immediately under reduced motion", () => {
    stubMatchMedia(true);
    expect(renderHook(() => useCountUp(42)).result.current).toBe(42);
  });

  it("restarts toward a new target", () => {
    fake();
    const { result, rerender } = renderHook(({ target }) => useCountUp(target, { duration: 100 }), { initialProps: { target: 10 } });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe(10);
    rerender({ target: 50 });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe(50);
  });
});
