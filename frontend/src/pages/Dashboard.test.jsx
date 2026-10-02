import { fireEvent, render, screen, within } from "@testing-library/react";
import { useAnalytics } from "../lib/useAnalytics.js";
import { useApi } from "../lib/useApi.js";
import { BENCHMARK_FIXTURE } from "../test/fixtures.js";
import { DashboardPage } from "./Dashboard.jsx";

vi.mock("../lib/useAnalytics.js", () => ({ useAnalytics: vi.fn(), REFRESH_MS: 5000 }));
vi.mock("../lib/useApi.js", () => ({ useApi: vi.fn() }));

const ATTACK = "<img src=x onerror=alert(1)>";
const NOTE = "Live traffic has no labels, so a block rate is not accuracy. Recall and precision come from the benchmark.";
const summary = (over = {}) => ({
  enabled: true, range: "24h", generated: "2026-10-01T12:34:56+00:00", bucket: "hour",
  totals: { scans: 4, blocked: 3, allowed: 1, block_rate: 0.75, critical: 2, ml_escalations: 1 },
  timeline: [
    { t: "2026-10-01T11:00:00+00:00", blocked: 1, allowed: 0 },
    { t: "2026-10-01T12:00:00+00:00", blocked: 2, allowed: 1 },
  ],
  levels: { safe: 1, low: 0, medium: 1, high: 0, critical: 2 },
  rules: [
    { rule_id: "XSS002", name: "Inline event handler (known)", category: "markup", count: 3 },
    { rule_id: "XSS030", name: "Cookie / storage access", category: "javascript", count: 1 },
  ],
  categories: [{ category: "markup", count: 3 }, { category: "javascript", count: 1 }],
  sources: [{ source: "(none)", scans: 3, blocked: 2 }, { source: "blog", scans: 1, blocked: 1 }],
  fields: [{ field: "text", scans: 3, blocked: 2 }, { field: "comment", scans: 1, blocked: 1 }],
  scores: ["0-9", "10-19", "20-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80-89", "90-100"].map((label, i) => ({ label, count: i === 9 ? 2 : i === 0 ? 1 : 0 })),
  recent_critical: [{ ts: "2026-10-01T12:33:10.000+00:00", source: "blog", field: "comment", score: 100, rules: ["XSS002", "XSS030"], text: ATTACK }],
  ...over,
});
const reload = vi.fn();
const respond = (data = summary(), over = {}) => useAnalytics.mockReturnValue({ status: "ok", data, error: null, reload, ...over });
const benchmark = (over = {}) => useApi.mockReturnValue({ status: "ok", data: BENCHMARK_FIXTURE, error: null, reload: vi.fn(), ...over });
const tiles = () => document.querySelector(".stat-grid");
const tile = (label) => within(tiles()).getByText(label).nextSibling.textContent;

beforeEach(() => { useAnalytics.mockReset(); useApi.mockReset(); reload.mockReset(); respond(); benchmark(); });

describe("DashboardPage: states", () => {
  it("has a single h1 called Dashboard and reads the benchmark", () => {
    render(<DashboardPage />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("Dashboard");
    expect(useApi).toHaveBeenCalledWith("/benchmark");
  });

  it("shows loading while the first load is pending", () => {
    respond(null, { status: "loading" });
    render(<DashboardPage />);
    expect(screen.getByText(/Loading/)).toBeTruthy();
  });

  it("shows the error with a Retry that reloads when there is no data", () => {
    respond(null, { status: "error", error: "network down" });
    render(<DashboardPage />);
    expect(screen.getByRole("alert").textContent).toMatch(/network down/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the data and shows an error note when a reload fails", () => {
    respond(summary(), { status: "error", error: "network down" });
    render(<DashboardPage />);
    expect(screen.getByRole("alert").textContent).toMatch(/network down/);
    expect(tile("Total scans")).toBe("4");
  });

  it("explains that saving is off and shows no charts or tiles", () => {
    respond({ enabled: false });
    render(<DashboardPage />);
    expect(screen.getByText("Saving scans is off on this server. It is on by default only for local runs; set STORE_SCANS=1 to turn it on.")).toBeTruthy();
    expect(document.querySelector(".chart-card")).toBeNull();
    expect(document.querySelector(".stat-grid")).toBeNull();
  });

  it("says so when the range has no scans, with no charts and no NaN", () => {
    respond(summary({ totals: { scans: 0, blocked: 0, allowed: 0, block_rate: 0, critical: 0, ml_escalations: 0 } }));
    const { container } = render(<DashboardPage />);
    expect(screen.getByText("No scans in this range yet. Try the Scanner.")).toBeTruthy();
    expect(container.querySelector(".chart-card")).toBeNull();
    expect(container.textContent).not.toContain("NaN");
    expect(screen.getByRole("button", { name: "Last 7 days" })).toBeTruthy(); // the range can still be changed
  });
});

describe("DashboardPage: the analysis", () => {
  it("shows the six tiles with the right numbers", () => {
    render(<DashboardPage />);
    expect([tile("Total scans"), tile("Blocked"), tile("Allowed"), tile("Block rate"), tile("Critical"), tile("ML escalations")])
      .toEqual(["4", "3", "1", "75.0%", "2", "1"]);
  });

  it("draws every chart under its title and lists the rules by name", () => {
    render(<DashboardPage />);
    for (const name of ["Threats over time", "Most triggered rules", "Rules by category", "Risk levels", "Scans by source", "Scans by field", "Score distribution"]) {
      expect(screen.getByRole("heading", { name }), name).toBeTruthy();
    }
    expect(screen.getByLabelText(/XSS002 Inline event handler \(known\): 3/)).toBeTruthy();
    expect(screen.getAllByLabelText(/\(none\)/).length).toBeGreaterThan(0); // the unnamed source
  });

  it("changes the requested range with the chips, and notes the 10,000-scan limit for All", () => {
    render(<DashboardPage />);
    expect(useAnalytics).toHaveBeenLastCalledWith({ range: "24h" });
    expect(screen.getByRole("button", { name: "Last 24 hours" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(useAnalytics).toHaveBeenLastCalledWith({ range: "7d" });
    expect(screen.getByRole("button", { name: "Last 7 days" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("All covers at most the 10,000 most recent stored scans.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(useAnalytics).toHaveBeenLastCalledWith({ range: "all" });
    expect(screen.getByText("All covers at most the 10,000 most recent stored scans.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Last hour" }));
    expect(useAnalytics).toHaveBeenLastCalledWith({ range: "1h" });
  });

  it("keeps the same range chip mounted when the range changes and the new range has no data yet", () => {
    useAnalytics.mockImplementation(({ range }) => (range === "24h"
      ? { status: "ok", data: summary(), error: null, reload }
      : { status: "loading", data: null, error: null, reload }));
    render(<DashboardPage />);
    const chip = screen.getByRole("button", { name: "Last 7 days" });
    fireEvent.click(chip);
    expect(document.contains(chip)).toBe(true);
    expect(screen.getByRole("button", { name: "Last 24 hours" })).toBeTruthy();
    expect(screen.getByText(/Loading/)).toBeTruthy();
  });

  it("lets the range be changed again when the first load of a range fails", () => {
    useAnalytics.mockImplementation(({ range }) => (range === "24h"
      ? { status: "ok", data: summary(), error: null, reload }
      : { status: "error", data: null, error: "network down", reload }));
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(screen.getByRole("alert").textContent).toMatch(/network down/);
    fireEvent.click(screen.getByRole("button", { name: "Last hour" }));
    expect(useAnalytics).toHaveBeenLastCalledWith({ range: "1h" });
  });

  it("keeps the previous data on screen, marked busy, while a new range loads", () => {
    useAnalytics.mockImplementation(() => ({ status: "loading", data: summary(), error: null, reload }));
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(tile("Total scans")).toBe("4");
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("lists the recent critical attacks, and shows hostile text as plain text", () => {
    const hostile = '<script id="pwn">window.pwned=1</script><img src=x onerror=alert(1)>';
    respond(summary({ recent_critical: [{ ts: "2026-10-01T12:33:10.000+00:00", source: "", field: "<b>f</b>", score: 100, rules: [], text: hostile }] }));
    render(<DashboardPage />);
    const table = screen.getByRole("heading", { name: "Recent critical attacks" }).closest("section").querySelector("table");
    const cells = [...table.querySelectorAll("tbody td")].map((td) => td.textContent);
    expect(cells[0]).toBe("12:33:10");
    expect(cells[cells.length - 1]).toBe(hostile);
    expect(document.getElementById("pwn")).toBeNull();
    expect(table.querySelector("img, b")).toBeNull();
    expect(window.pwned).toBeUndefined();
  });

  it("says so when there are no critical attacks in the range", () => {
    respond(summary({ recent_critical: [] }));
    render(<DashboardPage />);
    expect(screen.getByText("No critical attacks in this range.")).toBeTruthy();
  });
});

describe("DashboardPage: detector quality", () => {
  const quality = () => screen.getByRole("heading", { name: "Detector quality" }).closest("section");

  it("shows the shipped detector's benchmark numbers beside the live block rate, with the note", () => {
    render(<DashboardPage />);
    const text = quality().textContent;
    expect(text).toContain("95.2%"); // recall of the shipped hybrid in the fixture: 2512 / 2640
    expect(text).toContain("100.0%"); // precision
    expect(text).toContain("75.0%"); // the live block rate
    expect(text).toContain(NOTE);
  });

  it("copes with a missing benchmark and still shows everything else", () => {
    benchmark({ status: "error", data: null, error: "404" });
    render(<DashboardPage />);
    expect(quality().textContent).toContain("Benchmark numbers are not available yet.");
    expect(quality().textContent).toContain(NOTE);
    expect(tile("Total scans")).toBe("4");
  });
});
