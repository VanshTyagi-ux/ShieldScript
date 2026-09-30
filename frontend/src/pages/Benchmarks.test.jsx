import { fireEvent, render, screen, within } from "@testing-library/react";
import { useApi } from "../lib/useApi.js";
import { BENCHMARK_FIXTURE } from "../test/fixtures.js";
import { BenchmarksPage } from "./Benchmarks.jsx";

vi.mock("../lib/useApi.js", () => ({ useApi: vi.fn() }));

const reload = vi.fn();
const respond = (over = {}) => useApi.mockReturnValue({ status: "ok", data: BENCHMARK_FIXTURE, error: null, reload, ...over });
const withData = (patch) => ({ ...BENCHMARK_FIXTURE, ...patch });
const mount = () => render(<BenchmarksPage />);
const card = (container, title) => [...container.querySelectorAll(".chart-card")].find((c) => within(c).queryByRole("heading", { name: title }));
const groups = (el) => [...el.querySelectorAll(".mark-group")];
const markClass = (el, label) => el.querySelector(`[aria-label="${label}"] .mark`)?.getAttribute("class");

beforeEach(() => { useApi.mockReset(); reload.mockReset(); respond(); });

describe("BenchmarksPage: data states", () => {
  it("reads GET /benchmark and has a single h1", () => {
    mount();
    expect(useApi).toHaveBeenCalledWith("/benchmark");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows a skeleton while loading", () => {
    respond({ status: "loading", data: null });
    mount();
    expect(screen.getByRole("status", { name: "Loading benchmark" })).toBeTruthy();
  });

  it("explains how to generate the benchmark when it is missing, and offers Retry", () => {
    respond({ status: "error", data: null, error: "Benchmark not generated; run python -m xss_detector evaluate" });
    mount();
    expect(screen.getByRole("alert").textContent).toContain("Could not load the benchmark: Benchmark not generated");
    expect(screen.getByText(/python -m xss_detector evaluate/, { selector: "code" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("says so, without charts, when the benchmark has no detectors", () => {
    respond({ data: withData({ detectors: [], unseen_sources: [], unseen_weighted: null }) });
    const { container } = mount();
    expect(screen.getByText("The benchmark contains no detectors.")).toBeTruthy();
    expect(container.querySelector(".chart-card")).toBeNull();
  });
});

describe("BenchmarksPage: headline", () => {
  it("describes the dataset", () => {
    mount();
    expect(screen.getByText(/2,640 malicious payloads, 2,716 benign inputs and 49 hard negatives/)).toBeTruthy();
    expect(screen.getByText(/Generated 2026-09-28/)).toBeTruthy();
  });

  it("shows the shipped detector's headline numbers", () => {
    const { container } = mount();
    const tiles = [...container.querySelectorAll(".stat-tile")].map((t) => [t.querySelector(".stat-label").textContent, t.querySelector(".stat-value").textContent]);
    expect(tiles).toEqual([
      ["Recall", "95.2%"], ["Precision", "100.0%"], ["False-positive rate", "0.00%"], ["F1", "97.5%"], ["Hard-negative false positives", "1/49"],
    ]);
  });
});

describe("BenchmarksPage: detector comparison", () => {
  it("draws three small multiples with one shared legend, in the detectors' fixed order", () => {
    const { container } = mount();
    const recall = card(container, "Recall");
    expect(groups(recall).map((g) => g.getAttribute("aria-label"))).toEqual([
      "Hybrid (rules; ML escalates): 95.2%", "Rules: 94.2%", "ML alone: 99.7%", "Naive hybrid (rules OR ML): 99.8%",
    ]);
    expect(groups(card(container, "Precision"))).toHaveLength(4);
    expect(groups(card(container, "False-positive rate"))).toHaveLength(4);
    const legend = screen.getAllByRole("list", { name: "Legend" })[0];
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Hybrid (rules; ML escalates)", "Rules", "ML alone", "Naive hybrid (rules OR ML)",
    ]);
  });

  it("gives each detector the same colour in every chart", () => {
    const { container } = mount();
    const recall = card(container, "Recall");
    const precision = card(container, "Precision");
    const fpr = card(container, "False-positive rate");
    expect(markClass(recall, "Hybrid (rules; ML escalates): 95.2%")).toContain("fill-s1");
    expect(markClass(precision, "Hybrid (rules; ML escalates): 100.0%")).toContain("fill-s1");
    expect(markClass(recall, "Rules: 94.2%")).toContain("fill-s2");
    expect(markClass(recall, "ML alone: 99.7%")).toContain("fill-s3");
    expect(markClass(fpr, "ML alone: 0.07%")).toContain("fill-s3");
    expect(markClass(recall, "Naive hybrid (rules OR ML): 99.8%")).toContain("fill-s4");
  });

  it("reads the false-positive rate to two digits and says lower is better", () => {
    const { container } = mount();
    const fpr = card(container, "False-positive rate");
    expect(fpr.textContent).toContain("Lower is better");
    expect([...fpr.querySelectorAll(".value-text")].map((t) => t.textContent)).toEqual(["0.00%", "0.00%", "0.07%", "0.07%"]);
  });

  it("offers a table view of every chart", () => {
    const { container } = mount();
    fireEvent.click(within(card(container, "Recall")).getByRole("button", { name: "View as table" }));
    expect(within(card(container, "Recall")).getAllByRole("row")).toHaveLength(5);
  });
});

describe("BenchmarksPage: unseen sources", () => {
  it("compares rules and ML recall per held-out list, weighted average first, best ML recall first", () => {
    const { container } = mount();
    const unseen = card(container, "Recall on payload lists the model never saw");
    const labels = groups(unseen).filter((_, i) => i % 2 === 0).map((g) => g.getAttribute("aria-label").split(", Rules recall")[0]);
    expect(labels).toEqual([
      "All lists, weighted (n=8,425)",
      "XSS-BruteLogic (n=113)", "XSS-Cheat-Sheet-PortSwigger (n=6,042)", "XSS-innerht-ml (n=48)", "XSS-Jhaddix (n=107)", "XSS-Vectors-Mario (n=134)",
      "XSS-OFJAAAH (n=1,616)", "XSS-EnDe-h4k (n=204)", "XSS-EnDe-evation (n=161)",
    ]);
    expect(unseen.querySelectorAll(".mark")).toHaveLength(18);
  });

  it("colours rules and ML by their entity, matching the other charts", () => {
    const { container } = mount();
    const unseen = card(container, "Recall on payload lists the model never saw");
    expect(markClass(unseen, "XSS-EnDe-evation (n=161), Rules recall: 56.5%")).toContain("fill-s2");
    expect(markClass(unseen, "XSS-EnDe-evation (n=161), ML recall: 75.8%")).toContain("fill-s3");
  });

  it("explains when the unseen-source test was not run", () => {
    respond({ data: withData({ unseen_sources: [], unseen_weighted: null }) });
    const { container } = mount();
    expect(card(container, "Recall on payload lists the model never saw")).toBeUndefined();
    expect(screen.getByText(/unseen-source test was not run/i)).toBeTruthy();
  });
});

describe("BenchmarksPage: outcomes and examples", () => {
  const rowFor = (name) => [...document.querySelectorAll(".outcome-table tbody tr")].find((r) => r.querySelector("th").textContent === name);

  it("lists the confusion counts per detector", () => {
    mount();
    const cells = [...rowFor("Rules").querySelectorAll("td")].map((td) => td.textContent);
    expect(cells).toEqual(["2,488", "152", "0", "2,716", "1/49"]);
  });

  it("draws inline bars for the errors relative to the column maximum", () => {
    mount();
    const width = (name, col) => rowFor(name).querySelectorAll("td")[col].querySelector(".wbar div").style.width;
    expect(width("Rules", 1)).toBe("100%"); // 152 is the largest miss count
    expect(parseFloat(width("ML alone", 1))).toBeCloseTo((8 / 152) * 100, 1);
    expect(width("Rules", 2)).toBe("0%");
  });

  it("shows example misses and false positives as literal text", () => {
    const hostile = withData({ detectors: [{ ...BENCHMARK_FIXTURE.detectors[3], samples: { misses: ["<script>alert(1)</script>"], false_positives: [], hard_false_positives: [] } }] });
    respond({ data: hostile });
    const { container } = mount();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
    expect(screen.getAllByText("(none)").length).toBeGreaterThan(0);
  });

  it("caps each example list at 12 items", () => {
    const many = Array.from({ length: 30 }, (_, i) => `payload-${i}`);
    respond({ data: withData({ detectors: [{ ...BENCHMARK_FIXTURE.detectors[3], samples: { misses: many, false_positives: [], hard_false_positives: [] } }] }) });
    mount();
    expect(screen.queryByText("payload-12")).toBeNull();
    expect(screen.getByText("payload-11")).toBeTruthy();
  });

  it("shows the caveats", () => {
    mount();
    expect(screen.getByText(/unseen-source table is the fairer estimate/)).toBeTruthy();
  });
});

describe("BenchmarksPage: robustness", () => {
  it("copes with all-zero metrics and an unknown detector, without NaN", () => {
    const zero = { ...BENCHMARK_FIXTURE.detectors[0], name: "<img src=x onerror=alert(1)>", recall: 0, precision: 0, f1: 0, fpr: 0, tp: 0, fn: 0, fp: 0, tn: 0, hard_fps: 0 };
    respond({ data: withData({ detectors: [{ ...zero, shipped: true }], unseen_sources: [], unseen_weighted: null }) });
    const { container } = mount();
    expect(container.innerHTML).not.toContain("NaN");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("falls back to the first detector for the headline when none is flagged as shipped", () => {
    respond({ data: withData({ detectors: BENCHMARK_FIXTURE.detectors.map((d) => ({ ...d, shipped: false })) }) });
    const { container } = mount();
    expect(container.querySelector(".stat-value").textContent).toBe("94.2%");
  });
});
