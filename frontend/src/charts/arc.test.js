import { arcPath, gaugeAngle, polar } from "./arc.js";
import { roundedEndBar, toneClass } from "./shapes.js";

describe("polar", () => {
  it("puts 0 degrees at 3 o'clock and 90 at 12 o'clock", () => {
    expect(polar(50, 50, 40, 0)).toEqual({ x: 90, y: 50 });
    const top = polar(50, 50, 40, 90);
    expect(top.x).toBeCloseTo(50);
    expect(top.y).toBeCloseTo(10);
  });
});

describe("arcPath", () => {
  it("draws the top semicircle from left to right", () => {
    expect(arcPath(50, 50, 40, 180, 0)).toBe("M 10 50 A 40 40 0 0 1 90 50");
  });

  it("sets the large-arc flag past 180 degrees", () => {
    expect(arcPath(50, 50, 40, 270, 0)).toContain("A 40 40 0 1 1");
  });

  it("never emits NaN", () => {
    expect(arcPath(50, 50, 40, 90, 90)).not.toContain("NaN");
  });
});

describe("gaugeAngle", () => {
  it("maps 0..100 onto 180..0 degrees and clamps", () => {
    expect([gaugeAngle(0), gaugeAngle(50), gaugeAngle(100)]).toEqual([180, 90, 0]);
    expect(gaugeAngle(150)).toBe(0);
    expect(gaugeAngle(-5)).toBe(180);
  });
});

describe("roundedEndBar", () => {
  it("rounds only the data end (right), square at the baseline (left)", () => {
    expect(roundedEndBar(10, 20, 100, 20)).toBe("M 10 20 H 106 A 4 4 0 0 1 110 24 V 36 A 4 4 0 0 1 106 40 H 10 Z");
  });

  it("shrinks the radius for a very short bar", () => {
    expect(roundedEndBar(0, 0, 2, 20)).toBe("M 0 0 H 0 A 2 2 0 0 1 2 2 V 18 A 2 2 0 0 1 0 20 H 0 Z");
  });

  it("draws nothing for a zero or negative width", () => {
    expect(roundedEndBar(0, 0, 0, 20)).toBe("");
    expect(roundedEndBar(0, 0, -5, 20)).toBe("");
  });
});

describe("toneClass", () => {
  it("maps a categorical slot or a risk level to a class for the kind of mark", () => {
    expect(toneClass({ slot: 2 }, "fill")).toBe("fill-s2");
    expect(toneClass({ slot: 3 }, "stroke")).toBe("stroke-s3");
    expect(toneClass({ level: "critical" }, "fill")).toBe("fill-t-critical");
    expect(toneClass({ level: "low" }, "bg")).toBe("bg-t-low");
    expect(toneClass({}, "fill")).toBe("");
  });
});
