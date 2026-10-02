import { useCallback, useEffect, useState } from "react";
import { get } from "../api.js";

export const REFRESH_MS = 5000;

// Loads GET /analytics for a range at once, then again REFRESH_MS after each load finishes (so a slow server never
// gets overlapping requests). Polling pauses while the tab is hidden and loads again as soon as it is visible. A
// range change keeps the previous data on screen (status "loading") until the new range arrives; an answer to an
// older request is never used. A failed load keeps the last data and sets `error`; reload() loads now.
// -> { status: "loading" | "ok" | "error", data, error, reload }
export function useAnalytics({ range }) {
  const [state, setState] = useState({ status: "loading", data: null, error: null, range });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let timer = null;
    let controller = null;
    let stopped = false;

    setState((s) => (s.range === range ? s : { ...s, status: "loading", error: null, range }));

    const schedule = () => {
      if (!stopped && !document.hidden) timer = setTimeout(poll, REFRESH_MS);
    };

    async function poll() {
      timer = null;
      controller = new AbortController();
      const { signal } = controller;
      try {
        const { ok, data } = await get(`/analytics?range=${range}`, signal);
        if (signal.aborted) return;
        if (!ok || !data || typeof data.enabled !== "boolean") throw new Error((data && data.error) || "unexpected response");
        setState({ status: "ok", data, error: null, range });
      } catch (err) {
        if (signal.aborted) return;
        setState((s) => ({ ...s, status: "error", error: err.message || "server unreachable" }));
      }
      controller = null;
      schedule();
    }

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        timer = null;
        if (controller) controller.abort();
        controller = null;
      } else if (timer === null && controller === null) {
        poll();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (controller) controller.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [range, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const { status, data, error } = state;
  return { status, data, error, reload };
}
