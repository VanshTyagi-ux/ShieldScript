// Build-time feature switches, read from VITE_* variables (see .env.example).

export function parseFlag(value, fallback = true) {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

// The payload browser and the sanitizer playground (and their API docs) need endpoints only the FastAPI backend
// has. Turn this off for a build whose API is the built-in Python server, so it does not offer pages that
// could only show an error. On by default, so `npm run dev` against the backend needs no configuration.
export const BACKEND_PAGES = parseFlag(import.meta.env?.VITE_BACKEND_PAGES);
