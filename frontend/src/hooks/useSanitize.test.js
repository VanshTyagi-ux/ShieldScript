import { act, renderHook } from "@testing-library/react";
import { post } from "../api.js";
import { MAX_HTML_CHARS } from "../limits.js";
import { useSanitize } from "./useSanitize.js";

vi.mock("../api.js", () => ({ post: vi.fn() }));

const OK = (clean) => ({ status: 200, ok: true, data: { clean, changed: true, report: {}, detector: {} } });
const flush = async (ms) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { post.mockReset(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe("useSanitize", () => {
  it("is idle and sends nothing for empty input", async () => {
    const { result } = renderHook(() => useSanitize(""));
    await flush(1000);
    expect(result.current).toEqual({ status: "idle", result: null, error: null, httpStatus: null });
    expect(post).not.toHaveBeenCalled();
  });

  it("debounces: a burst of changes sends one request with the last value", async () => {
    post.mockResolvedValue(OK("done"));
    const { rerender } = renderHook(({ html }) => useSanitize(html), { initialProps: { html: "<b>1" } });
    await flush(100);
    rerender({ html: "<b>12" });
    await flush(100);
    rerender({ html: "<b>123" });
    await flush(400);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/sanitize", { html: "<b>123" }, expect.any(AbortSignal));
  });

  it("goes loading, then ok with the result", async () => {
    post.mockResolvedValue(OK("<b>x</b>"));
    const { result } = renderHook(() => useSanitize("<b>x</b>"));
    expect(result.current.status).toBe("loading");
    await flush(400);
    expect(result.current.status).toBe("ok");
    expect(result.current.result.clean).toBe("<b>x</b>");
  });

  it("keeps the previous result while the next one loads", async () => {
    post.mockResolvedValue(OK("one"));
    const { result, rerender } = renderHook(({ html }) => useSanitize(html), { initialProps: { html: "a" } });
    await flush(400);
    rerender({ html: "ab" });
    expect(result.current.status).toBe("loading");
    expect(result.current.result.clean).toBe("one");
  });

  it("reports the server's error message and status (413 too long, 503 unavailable)", async () => {
    post.mockResolvedValue({ status: 503, ok: false, data: { error: "HTML sanitizer unavailable" } });
    const { result } = renderHook(() => useSanitize("<b>x"));
    await flush(400);
    expect(result.current).toEqual({ status: "error", result: null, error: "HTML sanitizer unavailable", httpStatus: 503 });
  });

  it("copes with a non-JSON error body such as an HTML 502", async () => {
    post.mockResolvedValue({ status: 502, ok: false, data: null });
    const { result } = renderHook(() => useSanitize("<b>x"));
    await flush(400);
    expect(result.current).toMatchObject({ status: "error", error: "unexpected response", httpStatus: 502 });
  });

  it("rejects a 200 that lacks the expected shape", async () => {
    post.mockResolvedValue({ status: 200, ok: true, data: { hello: 1 } });
    const { result } = renderHook(() => useSanitize("<b>x"));
    await flush(400);
    expect(result.current.status).toBe("error");
  });

  it("reports a network failure", async () => {
    post.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useSanitize("<b>x"));
    await flush(400);
    expect(result.current).toMatchObject({ status: "error", error: "Failed to fetch", httpStatus: null });
  });

  it("does not send input over the length limit, and says why", async () => {
    const { result } = renderHook(() => useSanitize("a".repeat(MAX_HTML_CHARS + 1)));
    await flush(1000);
    expect(post).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("64,000");
  });

  it("sends input exactly at the limit", async () => {
    post.mockResolvedValue(OK("x"));
    renderHook(() => useSanitize("a".repeat(MAX_HTML_CHARS)));
    await flush(400);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("aborts the older request and ignores its late answer", async () => {
    let resolveFirst;
    post.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = () => resolve(OK("stale")); }));
    post.mockResolvedValueOnce(OK("fresh"));
    const { result, rerender } = renderHook(({ html }) => useSanitize(html), { initialProps: { html: "one" } });
    await flush(400); // first request is now in flight
    const firstSignal = post.mock.calls[0][2];
    rerender({ html: "two" });
    expect(firstSignal.aborted).toBe(true);
    await flush(400);
    await act(async () => { resolveFirst(); });
    expect(result.current.result.clean).toBe("fresh");
  });

  it("returns to idle when the input is cleared", async () => {
    post.mockResolvedValue(OK("x"));
    const { result, rerender } = renderHook(({ html }) => useSanitize(html), { initialProps: { html: "<b>x" } });
    await flush(400);
    rerender({ html: "" });
    expect(result.current).toEqual({ status: "idle", result: null, error: null, httpStatus: null });
  });
});
