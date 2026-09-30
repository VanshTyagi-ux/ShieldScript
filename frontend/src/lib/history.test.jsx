import { act, renderHook } from "@testing-library/react";
import { HISTORY_KEY, HistoryProvider, MAX_HISTORY, addEntry, useHistory } from "./history.jsx";

const entry = (text, over = {}) => ({ id: `id-${text}`, ts: 1000, text, score: 10, level: "low", is_malicious: false, ...over });
const result = (over = {}) => ({ score: 95, level: "critical", is_malicious: true, ...over });
const wrapper = ({ children }) => <HistoryProvider>{children}</HistoryProvider>;

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("addEntry", () => {
  it("puts the newest scan first", () => {
    const list = addEntry(addEntry([], entry("a")), entry("b"));
    expect(list.map((e) => e.text)).toEqual(["b", "a"]);
  });

  it("replaces a consecutive duplicate instead of stacking it", () => {
    const list = addEntry(addEntry([], entry("a", { ts: 1 })), entry("a", { ts: 2, id: "new" }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ts: 2, id: "new" });
  });

  it("keeps a non-consecutive duplicate", () => {
    const list = ["a", "b", "a"].reduce((acc, text) => addEntry(acc, entry(text)), []);
    expect(list.map((e) => e.text)).toEqual(["a", "b", "a"]);
  });

  it("truncates long text to 300 characters", () => {
    expect(addEntry([], entry("x".repeat(500)))[0].text).toHaveLength(300);
  });

  it("caps the list at 50, dropping the oldest", () => {
    const list = Array.from({ length: 60 }, (_, i) => `t${i}`).reduce((acc, text) => addEntry(acc, entry(text)), []);
    expect(MAX_HISTORY).toBe(50);
    expect(list).toHaveLength(50);
    expect(list[0].text).toBe("t59");
    expect(list[49].text).toBe("t10");
  });
});

describe("HistoryProvider", () => {
  it("records scans with unique ids and persists them for the tab", () => {
    const { result: hook } = renderHook(() => useHistory(), { wrapper });
    act(() => { hook.current.add(result(), "<script>"); });
    act(() => { hook.current.add(result({ score: 5, level: "low", is_malicious: false }), "hello"); });
    expect(hook.current.entries.map((e) => e.text)).toEqual(["hello", "<script>"]);
    expect(new Set(hook.current.entries.map((e) => e.id)).size).toBe(2);
    expect(hook.current.entries[1]).toMatchObject({ score: 95, level: "critical", is_malicious: true });
    expect(JSON.parse(window.sessionStorage.getItem(HISTORY_KEY))).toHaveLength(2);
  });

  it("loads history stored earlier in the same tab", () => {
    window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify([entry("stored")]));
    const { result: hook } = renderHook(() => useHistory(), { wrapper });
    expect(hook.current.entries.map((e) => e.text)).toEqual(["stored"]);
  });

  it.each(["{not json", "\"a string\"", "{\"a\":1}", "null"])("starts empty when the stored value is %s", (stored) => {
    window.sessionStorage.setItem(HISTORY_KEY, stored);
    const { result: hook } = renderHook(() => useHistory(), { wrapper });
    expect(hook.current.entries).toEqual([]);
  });

  it("drops stored entries that are malformed", () => {
    window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify([entry("good"), { id: 1, text: 5 }, null, entry("also good")]));
    const { result: hook } = renderHook(() => useHistory(), { wrapper });
    expect(hook.current.entries.map((e) => e.text)).toEqual(["good", "also good"]);
  });

  it("keeps working in memory when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const { result: hook } = renderHook(() => useHistory(), { wrapper });
    expect(hook.current.entries).toEqual([]);
    act(() => { hook.current.add(result(), "hello"); });
    expect(hook.current.entries).toHaveLength(1);
  });

  it("removes one entry and clears them all", () => {
    const { result: hook } = renderHook(() => useHistory(), { wrapper });
    act(() => { hook.current.add(result(), "a"); });
    act(() => { hook.current.add(result(), "b"); });
    const [newest] = hook.current.entries;
    act(() => { hook.current.remove(newest.id); });
    expect(hook.current.entries.map((e) => e.text)).toEqual(["a"]);
    act(() => { hook.current.clear(); });
    expect(hook.current.entries).toEqual([]);
    expect(JSON.parse(window.sessionStorage.getItem(HISTORY_KEY))).toEqual([]);
  });

  it("refuses to be used outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useHistory())).toThrow(/HistoryProvider/);
    spy.mockRestore();
  });
});
