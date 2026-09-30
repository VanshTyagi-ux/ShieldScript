import { useApi } from "../lib/useApi.js";

// Live server status from GET /health. The state is in the text; the dot is decoration.
export function StatusBadge() {
  const { status, data } = useApi("/health");
  let tone = "down";
  let text = "Status unavailable";
  if (status === "loading" && !data) {
    tone = "wait";
    text = "Checking status…";
  } else if (data && data.status === "ok") {
    tone = "ok";
    text = data.ml_loaded ? "Operational · ML model loaded" : "Operational · rules only";
  }
  return (
    <p className="status-badge">
      <span className={`status-dot ${tone}`} aria-hidden="true" />
      {text}
    </p>
  );
}
