import { LEVEL_LABEL, announcementFor, verdictText } from "./format.js";

describe("format", () => {
  it("labels every level", () => {
    expect(LEVEL_LABEL).toEqual({
      safe: "Safe", low: "Low risk", medium: "Medium risk", high: "High risk", critical: "Critical risk",
    });
  });

  it("words the verdict from is_malicious", () => {
    expect(verdictText({ is_malicious: true })).toBe("Potential XSS - would be blocked");
    expect(verdictText({ is_malicious: false })).toBe("Looks acceptable");
  });

  it("builds the screen-reader announcement", () => {
    expect(announcementFor({ level: "critical", score: 95, is_malicious: true })).toBe(
      "Critical risk, score 95 of 100. Potential XSS - would be blocked.");
  });
});
