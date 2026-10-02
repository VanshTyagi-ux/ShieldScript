import { act, fireEvent, render, screen } from "@testing-library/react";
import { post } from "../api.js";
import { HeroDemo } from "./HeroDemo.jsx";

vi.mock("../api.js", () => ({ post: vi.fn() }));

const CRITICAL = {
  score: 95, level: "critical", is_malicious: true, decode_layers: 0, ml_probability: 1, decoded: "ab",
  findings: [
    { rule_id: "XSS002", name: "Inline event handler (known)", category: "markup", weight: 60, description: "d", match: "x", position: 0, count: 1 },
    { rule_id: "XSS033", name: "Popup probe", category: "javascript", weight: 20, description: "d", match: "y", position: 1, count: 1 },
    { rule_id: "XSS007", name: "Handler-carrying tag", category: "markup", weight: 15, description: "d", match: "z", position: 2, count: 1 },
  ],
};
const ok = (data) => ({ status: 200, ok: true, data });
const originalMatchMedia = window.matchMedia;
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
// The demo schedules each timer after React re-renders, so time must pass one tick per act, as it does in a
// browser; a single big advance would fire only the first timer.
const steps = async (n, ms = 10) => { for (let i = 0; i < n; i += 1) await advance(ms); };
const flush = async () => { for (let i = 0; i < 4; i += 1) await advance(0); }; // let the scan promise settle
const typed = (c) => c.querySelector(".demo-typed").textContent;
const mount = (props) => render(<HeroDemo payloads={["ab"]} typeMs={10} holdMs={100} {...props} />);

beforeEach(() => { vi.useFakeTimers(); post.mockReset(); post.mockResolvedValue(ok(CRITICAL)); });
afterEach(() => { vi.useRealTimers(); window.matchMedia = originalMatchMedia; });

describe("HeroDemo: the animation", () => {
  it("is a labelled group", () => {
    mount();
    expect(screen.getByRole("group", { name: "Live detection demo" })).toBeTruthy();
  });

  it("types one character per tick", async () => {
    const { container } = mount();
    expect(typed(container)).toBe("");
    await advance(10);
    expect(typed(container)).toBe("a");
    await advance(10);
    expect(typed(container)).toBe("ab");
  });

  it("scans the finished payload once and shows the verdict, score and top findings", async () => {
    const { container } = mount();
    await steps(3);
    await flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/scan", { text: "ab", store: false }, expect.any(AbortSignal)); // canned demo scans stay out of the history
    const result = container.querySelector(".demo-result");
    expect(result.textContent).toContain("Critical risk");
    expect(result.textContent).toContain("score 95/100");
    expect(result.textContent).toContain("Inline event handler (known)");
    expect(result.textContent).toContain("Popup probe");
    expect(result.textContent).not.toContain("Handler-carrying tag"); // only the top two
  });

  it("moves on to the next payload after the hold, and caches results instead of rescanning", async () => {
    const { container } = mount({ payloads: ["ab", "cd"] });
    await steps(3); // typed "ab", then scanning
    await flush(); // result arrives, showing
    expect(post).toHaveBeenCalledTimes(1);
    await advance(100); // hold ends, next payload starts
    await steps(1);
    expect(typed(container)).toBe("c");
    await steps(2); // "cd", then scanning
    await flush();
    expect(post).toHaveBeenCalledTimes(2);
    await advance(100); // hold ends, back to the first payload
    await steps(3); // types it again, then reaches scanning
    await flush();
    expect(post).toHaveBeenCalledTimes(2); // its result was cached
    expect(container.querySelector(".demo-result").textContent).toContain("Critical risk");
  });

  it("shows a quiet fallback when the API is unreachable", async () => {
    post.mockImplementation(() => Promise.reject(new Error("network down")));
    const { container } = mount();
    await steps(3);
    await flush();
    expect(container.querySelector(".demo-result").textContent).toContain("Live results unavailable - is the server running?");
  });

  it("renders the typed payload as literal text", async () => {
    const { container } = mount({ payloads: ["<b>x</b>"] });
    await steps(8);
    expect(container.querySelector("b")).toBeNull();
    expect(typed(container)).toBe("<b>x</b>");
  });

  it("clears its timers and aborts a pending scan on unmount", async () => {
    post.mockReturnValue(new Promise(() => {}));
    const { unmount } = mount();
    await steps(3);
    await flush();
    const signal = post.mock.calls[0][2];
    unmount();
    expect(signal.aborted).toBe(true);
    await advance(1000); // nothing should throw or update after unmount
  });
});

describe("HeroDemo: pausing", () => {
  it("has a Pause button that stops progress, and a Play button that resumes it", async () => {
    const { container } = mount();
    await advance(10);
    fireEvent.click(screen.getByRole("button", { name: "Pause demo" }));
    await advance(200);
    expect(typed(container)).toBe("a");
    fireEvent.click(screen.getByRole("button", { name: "Play demo" }));
    await advance(10);
    expect(typed(container)).toBe("ab");
  });

  it("pauses while the pointer is over the demo and resumes when it leaves", async () => {
    const { container } = mount();
    const group = screen.getByRole("group", { name: "Live detection demo" });
    await advance(10);
    fireEvent.mouseEnter(group);
    await advance(200);
    expect(typed(container)).toBe("a");
    fireEvent.mouseLeave(group);
    await advance(10);
    expect(typed(container)).toBe("ab");
  });

  it("pauses while focus is inside the demo", async () => {
    const { container } = mount();
    await advance(10);
    fireEvent.focus(screen.getByRole("button", { name: "Pause demo" }));
    await advance(200);
    expect(typed(container)).toBe("a");
  });
});

describe("HeroDemo: reduced motion", () => {
  it("shows the whole payload and its result at once, and starts no animation", async () => {
    window.matchMedia = (media) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} });
    const { container } = mount({ payloads: ["ab", "cd"] });
    await advance(0);
    expect(typed(container)).toBe("ab");
    expect(container.querySelector(".demo-result").textContent).toContain("Critical risk");
    await advance(5000);
    expect(typed(container)).toBe("ab");
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Pause demo" })).toBeNull(); // nothing moves, so nothing to pause
  });
});
