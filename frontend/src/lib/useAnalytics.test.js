import { act, renderHook } from "@testing-library/react";
import { get } from "../api.js";
import { REFRESH_MS, useAnalytics } from "./useAnalytics.js";

vi.mock("../api.js", () => ({ get: vi.fn() }));

const summary = (range) => ({ enabled: true, range, totals: { scans: 1 } });
const reply = (range = "24h") => ({ ok: true, status: 200, data: summary(range) });
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const setHidden = (hidden) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => { vi.useFakeTimers(); get.mockReset(); get.mockResolvedValue(reply()); });
afterEach(() => { vi.useRealTimers(); setHidden(false); });

describe("useAnalytics", () => {
  it("loads at once with the range and then every 5 seconds", async () => {
    expect(REFRESH_MS).toBe(5000);
    renderHook(() => useAnalytics({ range: "24h" }));
    await tick(0);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe("/analytics?range=24h");
    await tick(5000);
    expect(get).toHaveBeenCalledTimes(2);
    await tick(10000);
    expect(get).toHaveBeenCalledTimes(4);
  });

  it("returns the data", async () => {
    const { result } = renderHook(() => useAnalytics({ range: "24h" }));
    expect(result.current.status).toBe("loading");
    await tick(0);
    expect(result.current).toMatchObject({ status: "ok", data: summary("24h"), error: null });
  });

  it("loads the new range after a range change and ignores the old answer", async () => {
    const slow = deferred();
    get.mockReturnValueOnce(slow.promise);
    get.mockResolvedValue(reply("24h"));
    const { result, rerender } = renderHook(({ range }) => useAnalytics({ range }), { initialProps: { range: "7d" } });
    await tick(0);
    rerender({ range: "24h" });
    await tick(0);
    expect(get.mock.calls.map((c) => c[0])).toEqual(["/analytics?range=7d", "/analytics?range=24h"]);
    expect(result.current.data).toEqual(summary("24h"));
    await act(async () => { slow.resolve(reply("7d")); await Promise.resolve(); });
    expect(result.current.data).toEqual(summary("24h"));
  });

  it("keeps showing the previous data, marked loading, while a new range loads", async () => {
    const { result, rerender } = renderHook(({ range }) => useAnalytics({ range }), { initialProps: { range: "7d" } });
    await tick(0);
    expect(result.current.data).toEqual(summary("24h"));
    get.mockReturnValue(new Promise(() => {}));
    rerender({ range: "1h" });
    await tick(0);
    expect(result.current).toMatchObject({ status: "loading", data: summary("24h"), error: null });
  });

  it("does not start a new load while one is in flight", async () => {
    get.mockReturnValue(new Promise(() => {}));
    renderHook(() => useAnalytics({ range: "24h" }));
    await tick(20000);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("pauses while the tab is hidden and loads again when it is visible", async () => {
    renderHook(() => useAnalytics({ range: "24h" }));
    await tick(0);
    setHidden(true);
    await tick(20000);
    expect(get).toHaveBeenCalledTimes(1);
    setHidden(false);
    await tick(0);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("keeps the last data after a failed load and recovers", async () => {
    const { result } = renderHook(() => useAnalytics({ range: "24h" }));
    await tick(0);
    get.mockRejectedValue(new Error("network down"));
    await tick(5000);
    expect(result.current).toMatchObject({ status: "error", data: summary("24h"), error: "network down" });
    get.mockResolvedValue(reply());
    await tick(5000);
    expect(result.current).toMatchObject({ status: "ok", error: null });
  });

  it("reload loads now", async () => {
    const { result } = renderHook(() => useAnalytics({ range: "24h" }));
    await tick(0);
    expect(get).toHaveBeenCalledTimes(1);
    act(() => { result.current.reload(); });
    await tick(0);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("stops polling on unmount", async () => {
    const { unmount } = renderHook(() => useAnalytics({ range: "24h" }));
    await tick(0);
    unmount();
    await tick(20000);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
