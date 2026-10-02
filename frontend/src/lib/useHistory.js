import { useCallback, useEffect, useState } from "react";
import { get, post } from "../api.js";

export const PAGE_SIZE = 25;

// Loads one page of the stored scans (GET /history) for a filter ("all", "blocked", "allowed"): when it mounts and
// whenever the filter, the page or reload() changes. A failed load keeps the last data and sets `error`.
// clear() deletes every stored scan (POST /history/clear) and loads the list again.
// -> { status: "loading" | "ok" | "error", data, error, reload, clear }
export function useHistory({ filter, page }) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ status: "loading", data: s.data, error: null }));
    get(`/history?filter=${filter}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, controller.signal)
      .then(({ ok, data }) => {
        if (controller.signal.aborted) return;
        if (!ok || !data || !Array.isArray(data.items)) throw new Error((data && data.error) || "unexpected response");
        setState({ status: "ok", data, error: null });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ status: "error", data: s.data, error: err.message || "server unreachable" }));
      });
    return () => controller.abort();
  }, [filter, page, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const clear = useCallback(async () => {
    try {
      const { ok, data } = await post("/history/clear", {});
      if (!ok || !data) throw new Error((data && data.error) || "unexpected response");
      reload();
    } catch (err) {
      setState((s) => ({ status: "error", data: s.data, error: err.message || "server unreachable" }));
    }
  }, [reload]);

  return { ...state, reload, clear };
}
