import { render, screen, within } from "@testing-library/react";
import { useEvents } from "../lib/useEvents.js";
import { LivePage } from "./Live.jsx";

vi.mock("../lib/useEvents.js", () => ({ useEvents: vi.fn() }));

const ev = (over = {}) => ({
  id: 1, ts: "2026-09-30T04:10:53.123+00:00", source: "dummy-site", field: "comment", blocked: true, score: 95,
  level: "critical", rules: ["XSS002", "XSS033"], text: "<img src=x onerror=alert(1)>", ...over,
});
const respond = (over = {}) => useEvents.mockReturnValue({ status: "ok", events: [], enabled: true, error: null, ...over });
const rows = () => [...document.querySelectorAll(".live-table tbody tr")];

beforeEach(() => { useEvents.mockReset(); respond(); });

describe("LivePage", () => {
  it("has a single h1", () => {
    render(<LivePage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows how to start the dummy site when there are no events yet", () => {
    render(<LivePage />);
    expect(screen.getByText(/python -m xss_detector demo/)).toBeTruthy();
    expect(rows()).toHaveLength(0);
  });

  it("explains that the feed is off, and how to turn it on", () => {
    respond({ enabled: false });
    render(<LivePage />);
    expect(screen.getByText(/LIVE_FEED=1/)).toBeTruthy();
  });

  it("shows loading while the first poll is pending", () => {
    respond({ status: "loading" });
    render(<LivePage />);
    expect(screen.getByText(/Loading/)).toBeTruthy();
  });

  it("lists each event with time, source, field, verdict, score, rules and text", () => {
    respond({ events: [ev(), ev({ id: 2, blocked: false, score: 0, level: "safe", rules: [], field: "name", text: "Ada" })] });
    render(<LivePage />);
    const [first, second] = rows();
    const cells = (row) => [...row.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells(first)).toEqual(["04:10:53", "dummy-site", "comment", "Blocked", "95 critical", "XSS002 XSS033", "<img src=x onerror=alert(1)>"]);
    expect(cells(second)).toEqual(["04:10:53", "dummy-site", "name", "Allowed", "0 safe", "none", "Ada"]);
  });

  it("shows counters and the most triggered rules", () => {
    respond({ events: [ev(), ev({ id: 2 }), ev({ id: 3, blocked: false, rules: [] })] });
    render(<LivePage />);
    const stats = document.querySelector(".stat-grid");
    expect(within(stats).getByText("Scanned").nextSibling.textContent).toBe("3");
    expect(within(stats).getByText("Blocked").nextSibling.textContent).toBe("2");
    expect(within(stats).getByText("Allowed").nextSibling.textContent).toBe("1");
    expect(screen.getByText(/XSS002/, { selector: ".top-rules *" })).toBeTruthy();
  });

  it("renders hostile event text as plain text and creates no elements from it", () => {
    const hostile = '<script id="pwn">window.pwned=1</script><img src=x onerror=alert(1)>';
    respond({ events: [ev({ text: hostile, field: "<b>f</b>", source: "a-b" })] });
    render(<LivePage />);
    expect(document.getElementById("pwn")).toBeNull();
    expect(document.querySelector(".live-table img")).toBeNull();
    expect(document.querySelector(".live-table b")).toBeNull();
    expect(rows()[0].textContent).toContain(hostile);
    expect(window.pwned).toBeUndefined();
  });

  it("keeps the table and shows a note when a poll fails", () => {
    respond({ status: "error", error: "network down", events: [ev()] });
    render(<LivePage />);
    expect(screen.getByRole("alert").textContent).toMatch(/Can't reach the server/);
    expect(rows()).toHaveLength(1);
  });

  it("puts the table in a keyboard-focusable, labelled scroll region", () => {
    respond({ events: [ev()] });
    render(<LivePage />);
    const region = screen.getByRole("region", { name: "Recent scans" });
    expect(region.getAttribute("tabindex")).toBe("0");
  });
});
