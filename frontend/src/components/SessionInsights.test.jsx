import { fireEvent, render, screen, within } from "@testing-library/react";
import { SessionInsights } from "./SessionInsights.jsx";

const entry = (n, over = {}) => ({ id: `e${n}`, ts: 1_700_000_000_000 + n * 1000, text: `payload ${n}`, score: (n * 10) % 100, level: "low", is_malicious: false, ...over });
// newest first, like the history hook returns them
const entries = (count, over) => Array.from({ length: count }, (_, i) => entry(count - i, over));
const mount = (props) => render(<SessionInsights entries={entries(3)} onRerun={() => {}} onClear={() => {}} {...props} />);
const items = (c) => [...c.querySelectorAll(".history-list li")];

describe("SessionInsights", () => {
  it("shows an empty state before any scan", () => {
    const { container } = mount({ entries: [] });
    expect(screen.getByText("Your scans this session will appear here.")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("draws the score history oldest to newest, one point per scan", () => {
    const { container } = mount({ entries: entries(10) });
    expect(container.querySelectorAll(".spark-point")).toHaveLength(10);
    const ys = [...container.querySelectorAll(".spark-point")].map((p) => Number(p.getAttribute("data-x")));
    expect([...ys].sort((a, b) => a - b)).toEqual(ys); // left to right = oldest to newest
  });

  it("plots at most the latest 30 scans", () => {
    const { container } = mount({ entries: entries(35) });
    expect(container.querySelectorAll(".spark-point")).toHaveLength(30);
  });

  it("marks the blocking threshold on the history chart", () => {
    mount();
    expect(screen.getAllByText("Blocked from 25").length).toBeGreaterThan(0);
  });

  it("shows the level mix as counts and shares", () => {
    mount({ entries: [entry(3, { level: "critical" }), entry(2, { level: "critical" }), entry(1, { level: "safe", score: 0 })] });
    expect(screen.getByLabelText("Critical: 2 (67%)")).toBeTruthy();
    expect(screen.getByLabelText("Safe: 1 (33%)")).toBeTruthy();
  });

  it("lists the newest scans first and shows eight until asked for more", () => {
    const { container } = mount({ entries: entries(10) });
    expect(items(container)).toHaveLength(8);
    expect(items(container)[0].textContent).toContain("payload 10");
    fireEvent.click(screen.getByRole("button", { name: "Show all (10)" }));
    expect(items(container)).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(items(container)).toHaveLength(8);
  });

  it("re-runs a scan with its full stored text, though the list shows it shortened", () => {
    const onRerun = vi.fn();
    const long = "x".repeat(100);
    const { container } = mount({ entries: [entry(1, { text: long })], onRerun });
    expect(items(container)[0].querySelector("code").textContent.length).toBeLessThan(100);
    fireEvent.click(within(items(container)[0]).getByRole("button", { name: /Re-run/ }));
    expect(onRerun).toHaveBeenCalledWith(long);
  });

  it("clears the history", () => {
    const onClear = vi.fn();
    mount({ onClear });
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("renders stored text as literal text", () => {
    const { container } = mount({ entries: [entry(1, { text: "<img src=x onerror=alert(1)>" })] });
    expect(container.querySelector("img")).toBeNull();
    expect(items(container)[0].textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("has a table view for each chart", () => {
    mount();
    expect(screen.getAllByRole("button", { name: "View as table" })).toHaveLength(2);
  });
});
