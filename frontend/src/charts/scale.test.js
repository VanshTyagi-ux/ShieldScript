import { bandScale, formatCount, formatPercent, linearScale, niceTicks } from "./scale.js";

describe("niceTicks", () => {
  it("rounds to clean numbers that cover the range", () => {
    expect(niceTicks(0, 97)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(0, 2700)).toEqual([0, 1000, 2000, 3000]);
  });

  it("handles a range that does not start at zero", () => {
    const ticks = niceTicks(0.9, 1);
    expect(ticks[0]).toBeLessThanOrEqual(0.9);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(1);
  });

  it("returns a single tick for an empty range instead of looping or returning NaN", () => {
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(0, 0)).toEqual([0]);
  });
});

describe("linearScale", () => {
  it("maps the domain onto the range", () => {
    const x = linearScale([0, 100], [0, 200]);
    expect([x(0), x(50), x(100)]).toEqual([0, 100, 200]);
  });

  it("supports an inverted range (SVG y grows downwards)", () => {
    const y = linearScale([0, 10], [100, 0]);
    expect([y(0), y(10), y(2.5)]).toEqual([100, 0, 75]);
  });

  it("returns the middle of the range for a degenerate domain, never NaN", () => {
    expect(linearScale([3, 3], [0, 200])(3)).toBe(100);
  });
});

describe("bandScale", () => {
  it("places bands with padding and reports their width", () => {
    const band = bandScale(["a", "b", "c"], [0, 300], { padding: 0.2 });
    expect(band.bandwidth).toBe(80);
    expect(["a", "b", "c"].map(band.start)).toEqual([10, 110, 210]);
  });

  it("returns undefined for an unknown key", () => {
    expect(bandScale(["a"], [0, 100]).start("z")).toBeUndefined();
  });

  it("copes with no keys", () => {
    expect(bandScale([], [0, 100]).bandwidth).toBe(0);
  });
});

describe("formatters", () => {
  it("formats percentages", () => {
    expect(formatPercent(0.942)).toBe("94.2%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(0.0007, 2)).toBe("0.07%");
    expect(formatPercent(1)).toBe("100.0%");
  });

  it("formats counts with thousands separators", () => {
    expect(formatCount(1284)).toBe("1,284");
    expect(formatCount(0)).toBe("0");
  });

  it("shows n/a for values that are not numbers instead of NaN", () => {
    expect(formatPercent(NaN)).toBe("n/a");
    expect(formatPercent(undefined)).toBe("n/a");
    expect(formatCount(null)).toBe("n/a");
  });
});
