import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { post } from "../api.js";
import { AnnounceProvider } from "../lib/announce.jsx";
import { HISTORY_KEY, HistoryProvider } from "../lib/history.jsx";
import { RouterProvider } from "../lib/router.jsx";
import { encodeShare } from "../lib/share.js";
import { ToastProvider } from "../lib/toast.jsx";
import { ScannerPage } from "./Scanner.jsx";

vi.mock("../api.js", () => ({ post: vi.fn() }));

const CRITICAL = {
  score: 95, level: "critical", is_malicious: true, decode_layers: 0, ml_probability: 1.0,
  decoded: "<img src=x onerror=alert(1)>",
  findings: [{ rule_id: "XSS002", name: "Inline event handler (known)", category: "markup", weight: 60,
    description: "d", match: "onerror=", position: 11, count: 1 }],
};
const ok = (data) => ({ status: 200, ok: true, data });
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const probe = () => document.querySelector("#probe");
const type = (value) => fireEvent.change(probe(), { target: { value } });
const routes = [{ path: "/scanner", title: "Scanner", component: ScannerPage }];
const stored = () => JSON.parse(window.sessionStorage.getItem(HISTORY_KEY) || "[]");

function mount(url = "/scanner") {
  window.history.pushState(null, "", url);
  return render(
    <ToastProvider>
      <HistoryProvider>
        <AnnounceProvider>
          <RouterProvider routes={routes} notFound={{ title: "x", component: () => null }}>
            <ScannerPage />
          </RouterProvider>
        </AnnounceProvider>
      </HistoryProvider>
    </ToastProvider>,
  );
}

beforeEach(() => { vi.useFakeTimers(); post.mockReset(); window.sessionStorage.clear(); });
afterEach(() => { vi.useRealTimers(); window.sessionStorage.clear(); });

describe("ScannerPage", () => {
  it("renders the page heading and the empty result state", () => {
    mount();
    expect(document.querySelector("h1").textContent).toBe("Scanner");
    expect(document.querySelector("#scan-empty")).not.toBeNull();
  });

  it("scans a clicked sample, shows the result and announces it", async () => {
    post.mockResolvedValue(ok(CRITICAL));
    mount();
    fireEvent.click(screen.getByText("Event handler"));
    expect(probe().value).toBe("<img src=x onerror=alert(1)>");
    await advance(250);
    expect(post).toHaveBeenCalledWith("/scan", { text: "<img src=x onerror=alert(1)>" }, expect.any(AbortSignal));
    expect(within(document.querySelector("#verdict-box")).getByText("Critical risk")).toBeTruthy();
    expect(document.querySelector("#announce").textContent).toBe(
      "Critical risk, score 95 of 100. Potential XSS - would be blocked.");
  });

  it("returns to the empty state when the input is cleared", async () => {
    post.mockResolvedValue(ok(CRITICAL));
    mount();
    type("<script>");
    await advance(250);
    expect(document.querySelector("#scan-result")).not.toBeNull();
    fireEvent.click(screen.getByText("Clear"));
    await advance(250);
    expect(document.querySelector("#scan-empty")).not.toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("shows only the latest result when typing quickly", async () => {
    post.mockImplementation((url, { text }) => Promise.resolve(ok({ ...CRITICAL, score: text.length, level: "low", is_malicious: false })));
    mount();
    type("aaa");
    await advance(250);
    expect(screen.getByText("risk score 3/100")).toBeTruthy();
    type("aaaaa");
    await advance(100);
    type("aaaaaaa");
    await advance(250);
    expect(screen.getByText("risk score 7/100")).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("announces the protected form's outcome", async () => {
    post.mockResolvedValue({ status: 422, ok: false, data: { accepted: false, errors: { email: "Invalid email address" }, results: {} } });
    mount();
    await act(async () => {
      fireEvent.submit(document.querySelector("#demo-form"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.querySelector("#announce").textContent).toBe("Rejected (HTTP 422)");
  });
});

describe("ScannerPage: result extras", () => {
  it("shows the gauge, the score breakdown and the copy actions with a result", async () => {
    post.mockResolvedValue(ok(CRITICAL));
    mount();
    type("<img src=x onerror=alert(1)>");
    await advance(250);
    expect(document.querySelector(".gauge")).not.toBeNull();
    expect(screen.getByText("Where the score comes from")).toBeTruthy();
    expect(screen.getByText("Copy JSON")).toBeTruthy();
    expect(screen.getByText("Copy share link")).toBeTruthy();
  });
});

describe("ScannerPage: share links", () => {
  it("preloads the input from ?t= and scans it", async () => {
    post.mockResolvedValue(ok(CRITICAL));
    mount(`/scanner?t=${encodeShare("<b>hi</b>")}`);
    expect(probe().value).toBe("<b>hi</b>");
    await advance(250);
    expect(post).toHaveBeenCalledWith("/scan", { text: "<b>hi</b>" }, expect.any(AbortSignal));
  });

  it.each([["malformed", "!!!"], ["oversized", "A".repeat(20000)], ["not UTF-8", "__4"]])("ignores a %s ?t= value without crashing", async (_, value) => {
    mount(`/scanner?t=${value}`);
    expect(probe().value).toBe("");
    await advance(250);
    expect(post).not.toHaveBeenCalled();
  });
});

describe("ScannerPage: session history", () => {
  it("records a completed scan once, even if the same text is scanned again", async () => {
    post.mockResolvedValue(ok(CRITICAL));
    mount();
    type("<script>alert(1)</script>");
    await advance(250);
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ text: "<script>alert(1)</script>", score: 95, level: "critical" });
    type("<script>alert(1)</script> ");
    await advance(250);
    type("<script>alert(1)</script>");
    await advance(250);
    expect(stored().length).toBeLessThanOrEqual(3);
    expect(stored()[0].text).toBe("<script>alert(1)</script>");
  });

  it("does not record very short input", async () => {
    post.mockResolvedValue(ok({ ...CRITICAL, score: 0, level: "safe", is_malicious: false, findings: [] }));
    mount();
    type("hi");
    await advance(250);
    expect(stored()).toHaveLength(0);
  });

  it("lists scans under Session insights and re-runs one", async () => {
    post.mockResolvedValue(ok(CRITICAL));
    mount();
    type("<script>alert(1)</script>");
    await advance(250);
    const insights = screen.getByText("Session insights").closest("section");
    expect(within(insights).getByText("<script>alert(1)</script>")).toBeTruthy();
    fireEvent.click(screen.getByText("Clear"));
    await advance(250);
    expect(probe().value).toBe("");
    fireEvent.click(within(insights).getByText("Re-run"));
    expect(probe().value).toBe("<script>alert(1)</script>");
  });
});
