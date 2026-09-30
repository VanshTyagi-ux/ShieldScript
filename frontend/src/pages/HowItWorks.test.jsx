import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { post } from "../api.js";
import { EXAMPLES } from "../data/walkthrough.js";
import { RouterProvider } from "../lib/router.jsx";
import { HowItWorksPage } from "./HowItWorks.jsx";

vi.mock("../api.js", () => ({ post: vi.fn() }));

const finding = (rule_id, name, category, weight, match, position) => ({ rule_id, name, category, weight, description: `${name} description`, match, position, count: 1 });
const SCRIPT = {
  score: 90, level: "critical", is_malicious: true, decode_layers: 0, ml_probability: 1,
  decoded: "<script>alert(document.cookie)</script>",
  findings: [finding("XSS001", "Script tag", "markup", 70, "<script", 0), finding("XSS033", "Popup probe", "javascript", 20, "alert(", 8)],
};
const ENCODED = {
  score: 100, level: "critical", is_malicious: true, decode_layers: 1, ml_probability: 1,
  decoded: "<script>alert(1)</script>",
  findings: [finding("XSS001", "Script tag", "markup", 70, "<script", 0), finding("XSS033", "Popup probe", "javascript", 20, "alert(", 8), finding("XSS099", "Encoded / obfuscated payload", "evasion", 15, "1 decoding layer(s)", 0)],
};
const SAFE = { score: 0, level: "safe", is_malicious: false, decode_layers: 0, ml_probability: 0.01, decoded: "Hi there", findings: [] };
const RESULTS = { [EXAMPLES[0].text]: SCRIPT, [EXAMPLES[1].text]: ENCODED, [EXAMPLES[3].text]: SAFE };
const ok = (data) => ({ status: 200, ok: true, data });

const routes = [{ path: "/how-it-works", title: "How it works", component: HowItWorksPage }];
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const tab = (name) => screen.getByText(name, { selector: "[role=tab] strong" }).closest("[role=tab]");
const panel = () => document.querySelector("[role=tabpanel]");

async function mount() {
  window.history.pushState(null, "", "/how-it-works");
  render(<RouterProvider routes={routes} notFound={{ title: "x", component: () => null }}><HowItWorksPage /></RouterProvider>);
  await advance(250);
}

beforeEach(() => {
  vi.useFakeTimers();
  post.mockReset();
  post.mockImplementation((url, { text }) => Promise.resolve(ok(RESULTS[text] ?? SAFE)));
});
afterEach(() => vi.useRealTimers());

describe("HowItWorksPage", () => {
  it("has one h1, four examples and three steps with the first selected", async () => {
    await mount();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(EXAMPLES).toHaveLength(4);
    expect(document.querySelectorAll(".example-picker button")).toHaveLength(4);
    expect(document.querySelectorAll("[role=tab]")).toHaveLength(3);
    expect(tab("Normalize").getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("[role=tablist]").getAttribute("aria-label")).toBe("Detection steps");
  });

  it("scans the first example straight away", async () => {
    await mount();
    expect(post).toHaveBeenCalledWith("/scan", { text: EXAMPLES[0].text }, expect.any(AbortSignal));
    expect(document.querySelector(".example-picker button[aria-pressed='true']").textContent).toBe(EXAMPLES[0].label);
  });
});

describe("HowItWorksPage: the three steps", () => {
  it("Normalize shows what was typed next to what was analysed, and how many layers were removed", async () => {
    await mount();
    fireEvent.click(screen.getByText(EXAMPLES[1].label));
    await advance(250);
    const p = panel();
    expect(within(p).getByText(EXAMPLES[1].text)).toBeTruthy();
    expect(within(p).getByText("<script>alert(1)</script>")).toBeTruthy();
    expect(within(p).getByText("encoded: 1 decoding layer")).toBeTruthy();
  });

  it("Normalize says when no decoding was needed", async () => {
    await mount();
    expect(within(panel()).getByText(/No decoding was needed/)).toBeTruthy();
  });

  it("Match highlights each rule's match and lists the findings", async () => {
    await mount();
    fireEvent.click(tab("Match"));
    expect(tab("Match").getAttribute("aria-selected")).toBe("true");
    expect([...panel().querySelectorAll("#decoded mark")].map((m) => m.textContent)).toEqual(["<script", "alert("]);
    expect(panel().querySelectorAll(".finding")).toHaveLength(2);
  });

  it("Score shows the gauge, where the points came from, and the decision", async () => {
    await mount();
    fireEvent.click(tab("Score"));
    const p = panel();
    expect(p.querySelector(".gauge").getAttribute("aria-label")).toBe("Risk score 90 of 100, critical");
    expect(within(p).getByText("Where the score comes from")).toBeTruthy();
    expect(within(p).getByText("Potential XSS - would be blocked")).toBeTruthy();
  });

  it("shows a harmless input passing every step", async () => {
    await mount();
    fireEvent.click(screen.getByText(EXAMPLES[3].label));
    await advance(250);
    fireEvent.click(tab("Match"));
    expect(within(panel()).getByText("No rules matched.")).toBeTruthy();
    fireEvent.click(tab("Score"));
    expect(within(panel()).getByText("Looks acceptable")).toBeTruthy();
  });
});

describe("HowItWorksPage: keyboard and input", () => {
  it("moves between steps with the arrow keys, Home and End, keeping one tab stop", async () => {
    await mount();
    const list = document.querySelector("[role=tablist]");
    tab("Normalize").focus();
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tab("Match").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Match"));
    expect(tab("Match").getAttribute("tabindex")).toBe("0");
    expect(tab("Normalize").getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(list, { key: "End" });
    expect(tab("Score").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tab("Normalize").getAttribute("aria-selected")).toBe("true"); // wraps
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(tab("Score").getAttribute("aria-selected")).toBe("true"); // wraps back
    fireEvent.keyDown(list, { key: "Home" });
    expect(tab("Normalize").getAttribute("aria-selected")).toBe("true");
  });

  it("scans the user's own input and unpresses the examples", async () => {
    await mount();
    fireEvent.change(document.querySelector("#walk-input"), { target: { value: "my own <b>input</b>" } });
    await advance(250);
    expect(post).toHaveBeenLastCalledWith("/scan", { text: "my own <b>input</b>" }, expect.any(AbortSignal));
    expect(document.querySelectorAll(".example-picker button[aria-pressed='true']")).toHaveLength(0);
  });

  it("shows hostile input as literal text", async () => {
    await mount();
    fireEvent.change(document.querySelector("#walk-input"), { target: { value: "<img src=x onerror=alert(1)>" } });
    await advance(250);
    expect(panel().querySelector("img")).toBeNull();
    expect(within(panel()).getAllByText("<img src=x onerror=alert(1)>").length).toBeGreaterThan(0);
  });

  it("shows an empty state when the input is cleared", async () => {
    await mount();
    fireEvent.change(document.querySelector("#walk-input"), { target: { value: "" } });
    await advance(250);
    expect(screen.getByText(/Choose an example or type your own input/)).toBeTruthy();
  });
});

describe("HowItWorksPage: states and links", () => {
  it("shows a skeleton while the first scan is pending", async () => {
    post.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(screen.getByRole("status", { name: "Analysing" })).toBeTruthy();
  });

  it("shows the reason when the scan fails", async () => {
    post.mockImplementation(() => Promise.reject(new Error("network down")));
    await mount();
    expect(screen.getByRole("alert").textContent).toBe("Could not analyse: network down");
  });

  it("links on to the rules and the benchmarks", async () => {
    await mount();
    expect(screen.getByRole("link", { name: "See every rule" }).getAttribute("href")).toBe("/rules");
    expect(screen.getByRole("link", { name: "See how accurate it is" }).getAttribute("href")).toBe("/benchmarks");
  });
});
