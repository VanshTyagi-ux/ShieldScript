import { useCallback, useEffect, useState } from "react";
import { get } from "../api.js";

// GET a JSON endpoint. Successful responses are cached per path, so pages that share an endpoint
// (the footer badge and the home page both read /health) do not refetch it.
const cache = new Map();

export function clearApiCache() {
  cache.clear();
}

const initial = (path) => (cache.has(path)
  ? { path, status: "ok", data: cache.get(path), error: null }
  : { path, status: "loading", data: null, error: null });

// -> { status: "loading" | "ok" | "error", data, error, reload }. While reloading, the previous data is kept.
export function useApi(path) {
  const [state, setState] = useState(() => initial(path));
  const [attempt, setAttempt] = useState(0);
  const view = state.path === path ? state : initial(path); // never show another path's data

  useEffect(() => {
    if (attempt === 0 && cache.has(path)) {
      setState(initial(path));
      return undefined;
    }
    const controller = new AbortController();
    setState((s) => ({ path, status: "loading", data: cache.has(path) ? cache.get(path) : (s.path === path ? s.data : null), error: null }));
    get(path, controller.signal)
      .then(({ ok, data }) => {
        if (controller.signal.aborted) return;
        if (!ok || data === null) throw new Error((data && data.error) || "unexpected response");
        cache.set(path, data);
        setState({ path, status: "ok", data, error: null });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ path, status: "error", data: s.path === path ? s.data : null, error: err.message || "server unreachable" }));
      });
    return () => controller.abort();
  }, [path, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { status: view.status, data: view.data, error: view.error, reload };
}
