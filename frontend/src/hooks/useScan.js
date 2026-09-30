import { useEffect, useState } from "react";
import { post } from "../api.js";
import { tooLarge } from "../limits.js";

const IDLE = { status: "idle", result: null, error: null };

// Debounced POST /scan. A newer text aborts the older request, and a response that
// arrives after its request was aborted never changes state.
export function useScan(text, { delay = 200 } = {}) {
  const [state, setState] = useState(IDLE);

  useEffect(() => {
    if (!text) {
      setState(IDLE);
      return undefined;
    }
    if (tooLarge({ text })) {
      setState({ status: "error", result: null, error: "Input is too large to scan (limit 256 KiB)" });
      return undefined;
    }
    setState((s) => ({ status: "loading", result: s.result, error: null }));
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { ok, data } = await post("/scan", { text }, controller.signal);
        if (controller.signal.aborted) return;
        if (!ok || !data || typeof data.score !== "number") throw new Error((data && data.error) || "unexpected response");
        setState({ status: "ok", result: data, error: null });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({ status: "error", result: null, error: err.message || "server unreachable" });
      }
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, delay]);

  return state;
}
