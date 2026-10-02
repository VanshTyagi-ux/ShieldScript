import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useHistory } from "../lib/useHistory.js";
import { HistoryPage } from "./History.jsx";

vi.mock("../lib/useHistory.js", () => ({ useHistory: vi.fn(), PAGE_SIZE: 25 }));

const ATTACK = "<img src=x onerror=alert(1)>";
const row = (over = {}) => ({
  id: 1, ts: "2026-10-01T04:10:53.123+00:00", source: "blog", field: "comment", text: ATTACK, blocked: true,
  score: 95, level: "critical", rules: ["XSS002", "XSS033"], ml_probability: 1, decode_layers: 0, ...over,
});
const dataOf = (items, over = {}) => ({
  enabled: true, items, total: items.length,
  counts: { all: items.length, blocked: items.filter((i) => i.blocked).length, allowed: items.filter((i) => !i.blocked).length },
  ...over,
});
const reload = vi.fn();
const clear = vi.fn();
const respond = (over = {}) => useHistory.mockReturnValue({ status: "ok", data: dataOf([row()]), error: null, reload, clear, ...over });
const rows = () => [...document.querySelectorAll(".live-table tbody tr")];

beforeEach(() => { useHistory.mockReset(); reload.mockReset(); clear.mockReset(); respond(); });

describe("HistoryPage", () => {
  it("has a single h1 called History", () => {
    render(<HistoryPage />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("History");
  });

  it("shows loading while the first load is pending", () => {
    respond({ status: "loading", data: null });
    render(<HistoryPage />);
    expect(screen.getByText(/Loading/)).toBeTruthy();
  });

  it("shows the error with a Retry button that reloads", () => {
    respond({ status: "error", data: null, error: "network down" });
    render(<HistoryPage />);
    expect(screen.getByRole("alert").textContent).toMatch(/network down/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("explains that saving is off, and how to turn it on", () => {
    respond({ data: dataOf([], { enabled: false }) });
    render(<HistoryPage />);
    expect(screen.getByText("Saving scans is off on this server. It is on by default only for local runs; set STORE_SCANS=1 to turn it on.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear history" })).toBeNull();
  });

  it("says so when nothing is stored yet", () => {
    respond({ data: dataOf([]) });
    render(<HistoryPage />);
    expect(screen.getByText("No scans stored yet. Try the Scanner.")).toBeTruthy();
    expect(rows()).toHaveLength(0);
  });

  it("shows the counters and a row with time, source, field, verdict, score, rules and input", () => {
    respond({ data: dataOf([row(), row({ id: 2, blocked: false, score: 0, level: "safe", rules: [], field: "name", source: "", text: "Ada" })]) });
    render(<HistoryPage />);
    const stats = document.querySelector(".stat-grid");
    expect(within(stats).getByText("Total").nextSibling.textContent).toBe("2");
    expect(within(stats).getByText("Blocked").nextSibling.textContent).toBe("1");
    expect(within(stats).getByText("Allowed").nextSibling.textContent).toBe("1");
    const cells = (r) => [...r.querySelectorAll("td")].map((td) => td.textContent);
    const [first, second] = rows();
    expect(cells(first)).toEqual(["04:10:53", "blog", "comment", "Blocked", "95 critical", "XSS002 XSS033", ATTACK]);
    expect(cells(second)).toEqual(["04:10:53", "-", "name", "Allowed", "0 safe", "none", "Ada"]);
  });

  it("shows stored markup as plain text and creates no elements from it", () => {
    const hostile = '<script id="pwn">window.pwned=1</script><img src=x onerror=alert(1)>';
    respond({ data: dataOf([row({ text: hostile, field: "<b>f</b>" })]) });
    render(<HistoryPage />);
    expect(document.getElementById("pwn")).toBeNull();
    expect(document.querySelector(".live-table img")).toBeNull();
    expect(document.querySelector(".live-table b")).toBeNull();
    expect(rows()[0].textContent).toContain(hostile);
    expect(window.pwned).toBeUndefined();
  });

  it("requests another filter and resets to the first page, and pages with Previous and Next", () => {
    respond({ data: dataOf([row()], { total: 60, counts: { all: 60, blocked: 30, allowed: 30 } }) });
    render(<HistoryPage />);
    expect(useHistory).toHaveBeenLastCalledWith({ filter: "all", page: 0 });
    expect(screen.getByRole("button", { name: "Previous" }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Blocked" }));
    expect(useHistory).toHaveBeenLastCalledWith({ filter: "blocked", page: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(useHistory).toHaveBeenLastCalledWith({ filter: "blocked", page: 1 });
    expect(screen.getByRole("button", { name: "Previous" }).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Allowed" }));
    expect(useHistory).toHaveBeenLastCalledWith({ filter: "allowed", page: 0 });
  });

  it("disables Next on the last page", () => {
    respond({ data: dataOf([row()], { total: 25, counts: { all: 25, blocked: 25, allowed: 0 } }) });
    render(<HistoryPage />);
    expect(screen.getByRole("button", { name: "Next" }).disabled).toBe(true);
  });

  it("links to the CSV and JSON exports", () => {
    render(<HistoryPage />);
    expect(screen.getByRole("link", { name: "Export CSV" }).getAttribute("href")).toMatch(/\/history\/export\?format=csv$/);
    expect(screen.getByRole("link", { name: "Export JSON" }).getAttribute("href")).toMatch(/\/history\/export\?format=json$/);
  });

  it("has a Refresh button that reloads", () => {
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("needs two clicks to clear, and the confirmation lapses after 4 seconds", () => {
    vi.useFakeTimers();
    try {
      render(<HistoryPage />);
      fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
      expect(clear).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Click again to confirm" })).toBeTruthy();
      act(() => { vi.advanceTimersByTime(4000); });
      expect(screen.getByRole("button", { name: "Clear history" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
      fireEvent.click(screen.getByRole("button", { name: "Click again to confirm" }));
      expect(clear).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables Clear history when nothing is stored", () => {
    respond({ data: dataOf([]) });
    render(<HistoryPage />);
    expect(screen.getByRole("button", { name: "Clear history" }).disabled).toBe(true);
  });

  it("keeps the table and shows the error note when a reload fails", () => {
    respond({ status: "error", error: "network down" });
    render(<HistoryPage />);
    expect(screen.getByRole("alert").textContent).toMatch(/network down/);
    expect(rows()).toHaveLength(1);
  });

  it("puts the table in a keyboard-focusable, labelled scroll region", () => {
    render(<HistoryPage />);
    expect(screen.getByRole("region", { name: "Stored scans" }).getAttribute("tabindex")).toBe("0");
  });
});
