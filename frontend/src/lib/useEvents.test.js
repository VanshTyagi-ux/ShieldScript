import { act, renderHook } from "@testing-library/react";
import { get } from "../api.js";
import { useEvents } from "./useEvents.js";

vi.mock("../api.js", () => ({ get: vi.fn() }));

const EVENT = { id: 1, ts: "2026-09-30T04:10:53.000+00:00", source: "dummy-site", field: "comment", blocked: true, score: 95, level: "critical", rules: ["XSS002"], text: "x" };
const reply = (over = {}) => ({ ok: true, status: 200, data: { events: [EVENT], enabled: true, ...over } });
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const setHidden = (hidden) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
};

beforeEach(() => { vi.useFakeTimers(); get.mockReset(); get.mockResolvedValue(reply()); });
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

  it("treats a 404 (a server without /events) as an error", async () => {
    get.mockResolvedValue({ ok: false, status: 404, data: { error: "Not found" } });
    const { result } = renderHook(() => useEvents());
    await tick(0);
    expect(result.current).toMatchObject({ status: "error", events: [], error: "Not found" });
  });
});
