import { act, renderHook, waitFor } from "@testing-library/react";
import { get } from "../api.js";
import { clearApiCache, useApi } from "./useApi.js";

vi.mock("../api.js", () => ({ get: vi.fn() }));

const ok = (data) => ({ status: 200, ok: true, data });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => { get.mockReset(); clearApiCache(); });

describe("useApi", () => {
  it("loads, then reports the data", async () => {
    get.mockResolvedValue(ok({ a: 1 }));
    const { result } = renderHook(() => useApi("/api/x"));
    expect(result.current).toMatchObject({ status: "loading", data: null });
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data).toEqual({ a: 1 });
    expect(get).toHaveBeenCalledWith("/api/x", expect.any(AbortSignal));
  });

  it("serves a cached path instantly without fetching again", async () => {
    get.mockResolvedValue(ok({ a: 1 }));
    const first = renderHook(() => useApi("/api/x"));
    await waitFor(() => expect(first.result.current.status).toBe("ok"));
    const second = renderHook(() => useApi("/api/x"));
    expect(second.result.current).toMatchObject({ status: "ok", data: { a: 1 } });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("reports the API's own error message", async () => {
    get.mockResolvedValue({ status: 404, ok: false, data: { error: "Benchmark not generated" } });
    const { result } = renderHook(() => useApi("/api/x"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Benchmark not generated");
  });

  it("reports 'unexpected response' for a non-JSON error body", async () => {
    get.mockResolvedValue({ status: 502, ok: false, data: null });
    const { result } = renderHook(() => useApi("/api/x"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("unexpected response");
  });

  it("reports 'unexpected response' when a 200 has no JSON body", async () => {
    get.mockResolvedValue({ status: 200, ok: true, data: null });
    const { result } = renderHook(() => useApi("/api/x"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("unexpected response");
  });

  it("reports the message when the request rejects", async () => {
    get.mockImplementation(() => Promise.reject(new Error("network down")));
    const { result } = renderHook(() => useApi("/api/x"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("network down");
  });

  it("keeps the previous data on screen while reloading", async () => {
    get.mockResolvedValueOnce(ok({ v: 1 }));
    const { result } = renderHook(() => useApi("/api/x"));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    const pending = deferred();
    get.mockReturnValueOnce(pending.promise);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe("loading"));
    expect(result.current.data).toEqual({ v: 1 });
    await act(async () => { pending.resolve(ok({ v: 2 })); });
    expect(result.current).toMatchObject({ status: "ok", data: { v: 2 } });
  });

  it("aborts the request on unmount", () => {
    get.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderHook(() => useApi("/api/x"));
    const signal = get.mock.calls[0][1];
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("does not show one path's data for another", async () => {
    get.mockResolvedValueOnce(ok({ from: "a" }));
    const { result, rerender } = renderHook(({ path }) => useApi(path), { initialProps: { path: "/api/a" } });
    await waitFor(() => expect(result.current.data).toEqual({ from: "a" }));
    get.mockReturnValueOnce(new Promise(() => {}));
    rerender({ path: "/api/b" });
    expect(result.current).toMatchObject({ status: "loading", data: null });
  });
});
