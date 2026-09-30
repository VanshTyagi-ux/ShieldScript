import { useEffect, useState } from "react";
import { get } from "../api.js";

// Polls GET /events for the live feed: at once, then every `interval` ms. Polling pauses while the tab is hidden and
// resumes with an immediate poll when it is visible again. A failed poll keeps the last events and sets `error`.
// -> { status: "loading" | "ok" | "error", events, enabled, error }
export function useEvents({ interval = 2000 } = {}) {
  const [state, setState] = useState({ status: "loading", events: [], enabled: true, error: null });

  useEffect(() => {
    let timer = null;
    let controller = null;
    let stopped = false;

    const schedule = () => {
      if (!stopped && !document.hidden) timer = setTimeout(poll, interval);
    };

    async function poll() {
      timer = null;
      controller = new AbortController();
      const { signal } = controller;
      try {
        const { ok, data } = await get("/events", signal);
        if (signal.aborted) return;
        if (!ok || !data || !Array.isArray(data.events)) throw new Error((data && data.error) || "unexpected response");
        setState({ status: "ok", events: data.events, enabled: data.enabled !== false, error: null });
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
  }, [interval]);

  return state;
}
