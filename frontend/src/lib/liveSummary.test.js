import { summarize } from "./liveSummary.js";

const ev = (blocked, rules = []) => ({ blocked, rules });

describe("summarize", () => {
  it("counts scanned, blocked and allowed", () => {
    expect(summarize([ev(true, ["XSS002"]), ev(false), ev(true, ["XSS001"])])).toMatchObject({ scanned: 3, blocked: 2, allowed: 1 });
  });

  it("is all zeros with no events", () => {
    expect(summarize([])).toEqual({ scanned: 0, blocked: 0, allowed: 0, topRules: [] });
  });

  it("lists the most triggered rules, highest count first, ties by rule id", () => {
    const events = [ev(true, ["XSS033", "XSS002"]), ev(true, ["XSS002"]), ev(true, ["XSS001", "XSS033"])];
    expect(summarize(events).topRules).toEqual([
      { rule: "XSS002", count: 2 }, { rule: "XSS033", count: 2 }, { rule: "XSS001", count: 1 },
    ]);
  });

  it("keeps only the top five rules", () => {
    const events = ["XSS001", "XSS002", "XSS003", "XSS004", "XSS005", "XSS006", "XSS007"].map((r) => ev(true, [r]));
    expect(summarize(events).topRules.map((t) => t.rule)).toEqual(["XSS001", "XSS002", "XSS003", "XSS004", "XSS005"]);
  });
});
