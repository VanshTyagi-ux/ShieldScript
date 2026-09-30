import { act, renderHook } from "@testing-library/react";
import { get, post } from "../api.js";
import { useEvents } from "./useEvents.js";

vi.mock("../api.js", () => ({ get: vi.fn(), post: vi.fn() }));

const EVENT = { id: 1, ts: "2026-09-30T04:10:53.000+00:00", source: "dummy-site", field: "comment", blocked: true, score: 95, level: "critical", rules: ["XSS002"], text: "x" };
const reply = (over = {}) => ({ ok: true, status: 200, data: { events: [EVENT], enabled: true, ...over } });
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const setHidden = (hidden) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
};

beforeEach(() => { vi.useFakeTimers(); get.mockReset(); post.mockReset(); get.mockResolvedValue(reply()); });
afterEach(() => { vi.useRealTimers(); setHidden(false); });

describe("useEvents", () => {
  it("polls /events at once and then every 2000 ms", async () => {
    renderHook(() => useEvents());
    await tick(0);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe("/events");
    await tick(2000);
    expect(get).toHaveBeenCalledTimes(2);
    await tick(4000);
    expect(get).toHaveBeenCalledTimes(4);
  });

  it("returns the events and the enabled flag", async () => {
    const { result } = renderHook(() => useEvents());
    expect(result.current.status).toBe("loading");
    await tick(0);
    expect(result.current).toMatchObject({ status: "ok", events: [EVENT], enabled: true, error: null });
  });

  it("reports enabled false when the server says the feed is off", async () => {
    get.mockResolvedValue(reply({ events: [], enabled: false }));
    const { result } = renderHook(() => useEvents());
    await tick(0);
    expect(result.current).toMatchObject({ status: "ok", events: [], enabled: false });
  });

  it("stops polling on unmount", async () => {
    const { unmount } = renderHook(() => useEvents());
    await tick(0);
    unmount();
    await tick(10000);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("pauses while the tab is hidden and polls again as soon as it is visible", async () => {
    renderHook(() => useEvents());
    await tick(0);
    setHidden(true);
    await tick(10000);
    expect(get).toHaveBeenCalledTimes(1);
    setHidden(false);
    await tick(0);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("keeps the last events after a failed poll and reports the error", async () => {
    const { result } = renderHook(() => useEvents());
    await tick(0);
    get.mockRejectedValue(new Error("network down"));
    await tick(2000);
    expect(result.current).toMatchObject({ status: "error", events: [EVENT], error: "network down" });
    get.mockResolvedValue(reply());
    await tick(2000);
    expect(result.current).toMatchObject({ status: "ok", error: null });
  });

  it("clear posts to /events/clear and empties the events at once", async () => {
    post.mockResolvedValue({ ok: true, status: 200, data: { cleared: 1 } });
    const { result } = renderHook(() => useEvents());
    await tick(0);
    expect(result.current.events).toHaveLength(1);
    await act(async () => { await result.current.clear(); });
    expect(post).toHaveBeenCalledWith("/events/clear", {});
    expect(result.current).toMatchObject({ status: "ok", events: [], error: null });
  });

  it("a failed clear keeps the events and reports the error", async () => {
    const { result } = renderHook(() => useEvents());
    await tick(0);
    post.mockRejectedValue(new Error("network down"));
    await act(async () => { await result.current.clear(); });
    expect(result.current).toMatchObject({ status: "error", events: [EVENT], error: "network down" });
    post.mockResolvedValue({ ok: false, status: 415, data: { error: "Content-Type must be application/json" } });
    await act(async () => { await result.current.clear(); });
    expect(result.current).toMatchObject({ status: "error", events: [EVENT], error: "Content-Type must be application/json" });
  });

  it("a poll already in flight when the feed was cleared does not bring the old events back", async () => {
    const { result } = renderHook(() => useEvents());
    await tick(0);
    let finish;
    get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await tick(2000); // the second poll starts and stays pending
    post.mockResolvedValue({ ok: true, status: 200, data: { cleared: 1 } });
    await act(async () => { await result.current.clear(); });
    expect(result.current.events).toEqual([]);
    await act(async () => { finish(reply()); }); // the stale answer arrives after the clear
    expect(result.current.events).toEqual([]);
    get.mockResolvedValue(reply({ events: [] }));
    const before = get.mock.calls.length;
    await tick(2000); // and polling carries on
    expect(get.mock.calls.length).toBeGreaterThan(before);
  });

  it("treats a 404 (a server without /events) as an error", async () => {
    get.mockResolvedValue({ ok: false, status: 404, data: { error: "Not found" } });
    const { result } = renderHook(() => useEvents());
    await tick(0);
    expect(result.current).toMatchObject({ status: "error", events: [], error: "Not found" });
  });
});
