import { fireEvent, render, screen, within } from "@testing-library/react";
import { ResultPanel } from "./ResultPanel.jsx";

const finding = (rule_id, name, category, weight, match, position, extra = {}) => ({
  rule_id, name, category, weight, description: `${name} description`, match, position, count: 1, ...extra,
});
const RESULT = {
  score: 95, level: "critical", is_malicious: true, decode_layers: 0, ml_probability: 1.0,
  decoded: "<img src=x onerror=alert(1)>",
  findings: [
    finding("XSS002", "Inline event handler (known)", "markup", 60, "onerror=", 11),
    finding("XSS007", "Handler-carrying tag", "markup", 15, "<img", 0),
    finding("XSS033", "Popup probe", "javascript", 20, "alert(", 19),
  ],
};
const ok = (result) => ({ status: "ok", result, error: null });
const markTexts = (container, selector = "#decoded mark") => [...container.querySelectorAll(selector)].map((m) => m.textContent);

describe("ResultPanel", () => {
  it("shows the empty state when idle", () => {
    render(<ResultPanel scan={{ status: "idle", result: null, error: null }} />);
    expect(screen.getByText("Type or paste some input, or pick a sample, to see how it scores.")).toBeTruthy();
    expect(document.querySelector("#scan-result")).toBeNull();
  });

  it("shows an alert with the reason when the scan failed", () => {
    render(<ResultPanel scan={{ status: "error", result: null, error: "network down" }} />);
    expect(screen.getByRole("alert").textContent).toBe("Could not scan: network down");
  });

  it("renders the verdict, score, meter and chips", () => {
    const { container } = render(<ResultPanel scan={ok(RESULT)} />);
    expect(screen.getByText("Critical risk")).toBeTruthy();
    expect(screen.getByText("Potential XSS - would be blocked")).toBeTruthy();
    expect(screen.getByText("risk score 95/100")).toBeTruthy();
    expect(container.querySelector(".gauge").getAttribute("aria-label")).toBe("Risk score 95 of 100, critical");
    expect(container.querySelector(".gauge-score").textContent).toBe("95");
    expect(container.querySelector("#verdict-box").className).toContain("border-critical");
    expect(screen.getByText("ML: 100.0% malicious")).toBeTruthy();
    expect(screen.getByText("blocked")).toBeTruthy();
  });

  it("explains where the score comes from, one segment per rule that fired", () => {
    const { container } = render(<ResultPanel scan={ok(RESULT)} />);
    expect(screen.getByRole("heading", { name: "Where the score comes from" })).toBeTruthy();
    expect(container.querySelectorAll(".breakdown .mark")).toHaveLength(3);
  });

  it("shows a footer, such as result actions, only when there is a result", () => {
    const footer = <p>result footer</p>;
    const { rerender } = render(<ResultPanel scan={ok(RESULT)} footer={footer} />);
    expect(screen.getByText("result footer")).toBeTruthy();
    rerender(<ResultPanel scan={{ status: "idle", result: null, error: null }} footer={footer} />);
    expect(screen.queryByText("result footer")).toBeNull();
  });

  it("groups findings by category and marks each match in the decoded view", () => {
    const { container } = render(<ResultPanel scan={ok(RESULT)} />);
    expect(container.querySelectorAll(".finding")).toHaveLength(3);
    expect([...container.querySelectorAll(".group h4")].map((h) => h.textContent)).toEqual(["markup", "javascript"]);
    expect(markTexts(container)).toEqual(["<img", "onerror=", "alert("]);
    expect(container.querySelector("#decoded").textContent).toBe(RESULT.decoded);
  });

  it("highlights only the hovered finding's match, on hover and on keyboard focus", () => {
    const { container } = render(<ResultPanel scan={ok(RESULT)} />);
    const item = within(container.querySelector("#findings")).getByText("XSS002").closest(".finding");
    fireEvent.mouseEnter(item);
    expect(markTexts(container, "#decoded mark.on")).toEqual(["onerror="]);
    fireEvent.mouseLeave(item);
    expect(markTexts(container, "#decoded mark.on")).toEqual([]);
    fireEvent.focus(item);
    expect(markTexts(container, "#decoded mark.on")).toEqual(["onerror="]);
    fireEvent.blur(item);
    expect(markTexts(container, "#decoded mark.on")).toEqual([]);
  });

  it("shows the repeat count and a weight bar for each finding", () => {
    const repeated = { ...RESULT, findings: [finding("XSS001", "Script tag", "markup", 70, "<script", 0, { count: 2 })], decoded: "<script></script>" };
    const { container } = render(<ResultPanel scan={ok(repeated)} />);
    expect(screen.getByText("×2")).toBeTruthy();
    expect(screen.getByText("+70")).toBeTruthy();
    expect(container.querySelector(".wbar div").style.width).toBe("70%");
  });

  it("reports decoding layers, pluralised, with a note", () => {
    const { rerender } = render(<ResultPanel scan={ok({ ...RESULT, decode_layers: 1 })} />);
    expect(screen.getByText("encoded: 1 decoding layer")).toBeTruthy();
    expect(screen.getByText("1 decoding layer(s) removed before scanning.")).toBeTruthy();
    rerender(<ResultPanel scan={ok({ ...RESULT, decode_layers: 2 })} />);
    expect(screen.getByText("encoded: 2 decoding layers")).toBeTruthy();
  });

  it("says when the ML model is not trained", () => {
    render(<ResultPanel scan={ok({ ...RESULT, ml_probability: null })} />);
    expect(screen.getByText("ML model not trained (python -m xss_detector train)")).toBeTruthy();
  });

  it("renders a safe result with no findings", () => {
    const safe = { score: 0, level: "safe", is_malicious: false, decode_layers: 0, ml_probability: 0.01, decoded: "hello", findings: [] };
    render(<ResultPanel scan={ok(safe)} />);
    expect(screen.getByText("Safe")).toBeTruthy();
    expect(screen.getByText("Looks acceptable")).toBeTruthy();
    expect(screen.getByText("allowed")).toBeTruthy();
    expect(screen.getByText("No indicators found.")).toBeTruthy();
    expect(screen.getByText("Input needed no decoding.")).toBeTruthy();
  });

  it("keeps the previous result on screen, marked busy, while the next scan loads", () => {
    const { container } = render(<ResultPanel scan={{ status: "loading", result: RESULT, error: null }} />);
    expect(container.querySelector("#scan-result").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Critical risk")).toBeTruthy();
  });

  it("shows a loading skeleton, not the empty state, while the first scan is in flight", () => {
    render(<ResultPanel scan={{ status: "loading", result: null, error: null }} />);
    const loading = screen.getByRole("status", { name: "Scanning" });
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.querySelectorAll(".skeleton").length).toBeGreaterThan(1);
    expect(document.querySelector("#scan-empty")).toBeNull();
    expect(document.querySelector("#scan-result")).toBeNull();
  });

  it("never turns decoded input into live DOM or runs its handlers", () => {
    const hostile = { ...RESULT, decoded: '<img src=x onerror="window.__x=1"><b id=inj>x</b>', findings: [] };
    const { container } = render(<ResultPanel scan={ok(hostile)} />);
    expect(container.querySelector("img, #inj, b")).toBeNull();
    expect(container.querySelector("#decoded").textContent).toBe(hostile.decoded);
    expect(window.__x).toBeUndefined();
  });
});
