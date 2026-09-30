import { act, renderHook } from "@testing-library/react";
import { post } from "../api.js";
import { useScan } from "./useScan.js";

vi.mock("../api.js", () => ({ post: vi.fn() }));

const RESULT = { score: 95, level: "critical", is_malicious: true, findings: [], decoded: "x", decode_layers: 0, ml_probability: 1 };
const ok = (data) => ({ status: 200, ok: true, data });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const setup = (text) => renderHook(({ text }) => useScan(text), { initialProps: { text } });

beforeEach(() => { vi.useFakeTimers(); post.mockReset(); });
afterEach(() => vi.useRealTimers());

describe("useScan", () => {
  it("stays idle and sends nothing for empty text", async () => {
    const { result } = setup("");
    await advance(500);
    expect(result.current).toEqual({ status: "idle", result: null, error: null });
    expect(post).not.toHaveBeenCalled();
  });

  it("debounces: three quick changes send one request with the last text", async () => {
    post.mockResolvedValue(ok(RESULT));
    const { rerender } = setup("a");
    await advance(100);
    rerender({ text: "ab" });
    await advance(100);
    rerender({ text: "abc" });
    await advance(250);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/scan", { text: "abc" }, expect.any(AbortSignal));
  });

  it("is loading immediately and ok once the response arrives", async () => {
    post.mockResolvedValue(ok(RESULT));
    const { result } = setup("<script>");
    expect(result.current.status).toBe("loading");
    await advance(250);
    expect(result.current).toEqual({ status: "ok", result: RESULT, error: null });
  });

  it("keeps the previous result while the next scan is loading", async () => {
    post.mockResolvedValue(ok(RESULT));
    const { result, rerender } = setup("a");
    await advance(250);
    rerender({ text: "ab" });
    expect(result.current.status).toBe("loading");
    expect(result.current.result).toEqual(RESULT);
  });

  it("shows the server's message for an oversized paste (413)", async () => {
    post.mockResolvedValue({ status: 413, ok: false, data: { error: "Body must be at most 262144 bytes" } });
    const { result } = setup("x".repeat(10));
    await advance(250);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Body must be at most 262144 bytes");
  });

  it("shows the server's message when rate limited (429)", async () => {
    post.mockResolvedValue({ status: 429, ok: false, data: { error: "Rate limit exceeded; retry in 12 s" } });
    const { result } = setup("x".repeat(10));
    await advance(250);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Rate limit exceeded; retry in 12 s");
  });

  it("reports 'unexpected response' for a non-JSON error body", async () => {
    post.mockResolvedValue({ status: 502, ok: false, data: null });
    const { result } = setup("x");
    await advance(250);
    expect(result.current.error).toBe("unexpected response");
  });

  it("reports 'unexpected response' when a 200 body has no score", async () => {
    post.mockResolvedValue(ok({ hello: "world" }));
    const { result } = setup("x");
    await advance(250);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("unexpected response");
  });

  it("reports the error message when the request rejects", async () => {
    post.mockRejectedValue(new Error("network down"));
    const { result } = setup("x");
    await advance(250);
    expect(result.current).toEqual({ status: "error", result: null, error: "network down" });
  });

  it("aborts the older request and ignores its late response", async () => {
    const first = deferred();
    post.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok({ ...RESULT, score: 5, level: "low" }));
    const { result, rerender } = setup("a");
    await advance(250);
    const firstSignal = post.mock.calls[0][2];
    rerender({ text: "b" });
    expect(firstSignal.aborted).toBe(true);
    await advance(250);
    expect(result.current.result.score).toBe(5);
    await act(async () => { first.resolve(ok({ ...RESULT, score: 99 })); });
    expect(result.current.result.score).toBe(5);
  });

  it("refuses to send an input over the size limit, saying why, without any request", async () => {
    const { result } = setup("x".repeat(300 * 1024));
    await advance(500);
    expect(post).not.toHaveBeenCalled();
    expect(result.current).toEqual({ status: "error", result: null, error: "Input is too large to scan (limit 256 KiB)" });
  });

  it("scans again once an oversized input shrinks back under the limit", async () => {
    post.mockResolvedValue(ok(RESULT));
    const { result, rerender } = setup("x".repeat(300 * 1024));
    await advance(250);
    expect(result.current.status).toBe("error");
    rerender({ text: "x".repeat(256 * 1024 - 20) });
    await advance(250);
    expect(post).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ok");
  });

  it("returns to idle with no result when the text is cleared", async () => {
    post.mockResolvedValue(ok(RESULT));
    const { result, rerender } = setup("a");
    await advance(250);
    rerender({ text: "" });
    expect(result.current).toEqual({ status: "idle", result: null, error: null });
  });
});
