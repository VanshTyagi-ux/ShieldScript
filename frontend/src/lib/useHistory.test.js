import { act, renderHook } from "@testing-library/react";
import { get, post } from "../api.js";
import { PAGE_SIZE, useHistory } from "./useHistory.js";

vi.mock("../api.js", () => ({ get: vi.fn(), post: vi.fn() }));

const ROW = { id: 1, ts: "2026-10-01T04:10:53.123+00:00", source: "", field: "text", text: "x", blocked: true, score: 95, level: "critical", rules: ["XSS002"], ml_probability: 1, decode_layers: 0 };
const DATA = { enabled: true, items: [ROW], total: 1, counts: { all: 1, blocked: 1, allowed: 0 } };
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => { get.mockReset(); post.mockReset(); get.mockResolvedValue({ ok: true, status: 200, data: DATA }); });

describe("useHistory", () => {
  it("requests the filter and the page", async () => {
    renderHook(() => useHistory({ filter: "blocked", page: 1 }));
    await settle();
    expect(PAGE_SIZE).toBe(25);
    expect(get.mock.calls[0][0]).toBe("/history?filter=blocked&limit=25&offset=25");
  });

  it("returns the data once it has arrived", async () => {
    const { result } = renderHook(() => useHistory({ filter: "all", page: 0 }));
    expect(result.current.status).toBe("loading");
    await settle();
    expect(result.current).toMatchObject({ status: "ok", data: DATA, error: null });
  });

  it("reports an error and keeps the last data when a reload fails", async () => {
    const { result } = renderHook(() => useHistory({ filter: "all", page: 0 }));
    await settle();
    get.mockRejectedValue(new Error("network down"));
    act(() => { result.current.reload(); });
    await settle();
    expect(result.current).toMatchObject({ status: "error", data: DATA, error: "network down" });
  });

  it("clear posts to /history/clear and then loads the list again", async () => {
    post.mockResolvedValue({ ok: true, status: 200, data: { cleared: 1 } });
    const { result } = renderHook(() => useHistory({ filter: "all", page: 0 }));
    await settle();
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.clear(); });
    await settle();
    expect(post).toHaveBeenCalledWith("/history/clear", {});
    expect(get).toHaveBeenCalledTimes(2);
  });
});
