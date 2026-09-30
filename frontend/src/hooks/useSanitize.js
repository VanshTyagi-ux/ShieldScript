import { useEffect, useState } from "react";
import { post } from "../api.js";
import { MAX_HTML_CHARS } from "../limits.js";

const IDLE = { status: "idle", result: null, error: null, httpStatus: null };

// Debounced POST /sanitize. A newer input aborts the older request, and a response that arrives after its
// request was aborted never changes state. `httpStatus` is set when the server answered with an error, so the
// page can explain a 404 (the API has no /sanitize) or a 503 (no sanitizer installed) properly.
export function useSanitize(html, { delay = 300 } = {}) {
  const [state, setState] = useState(IDLE);

  useEffect(() => {
    if (!html) {
      setState(IDLE);
      return undefined;
    }
    if (html.length > MAX_HTML_CHARS) {
      setState({ status: "error", result: null, httpStatus: null,
        error: `Input is too long (${html.length.toLocaleString("en-US")} characters; the limit is ${MAX_HTML_CHARS.toLocaleString("en-US")})` });
      return undefined;
    }
    setState((s) => ({ status: "loading", result: s.result, error: null, httpStatus: null }));
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { ok, status, data } = await post("/sanitize", { html }, controller.signal);
        if (controller.signal.aborted) return;
        if (!ok || !data || typeof data.clean !== "string") {
          setState({ status: "error", result: null, httpStatus: status, error: (data && data.error) || "unexpected response" });
          return;
        }
        setState({ status: "ok", result: data, error: null, httpStatus: null });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({ status: "error", result: null, httpStatus: null, error: err.message || "server unreachable" });
      }
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [html, delay]);

  return state;
}
