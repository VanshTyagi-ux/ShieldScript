// The one place that knows where the API lives. Every call passes a path relative to the API base
// ("/scan", "/payloads?limit=25"); the base comes from the VITE_API_URL environment variable, read at build
// time (see .env.example and scripts/build.mjs).
//
//   VITE_API_URL=http://localhost:8000/api/v1   the FastAPI backend (npm run dev)
//   VITE_API_URL=/api                           same origin, the built-in server (.env.production)
export const DEFAULT_API_URL = "http://localhost:8000/api/v1";

// -> { base, ignored }. `base` has no trailing slash. A blank value means "not set" and gives the default; a
// value that is neither an http(s) URL nor an absolute path is ignored (and reported) rather than guessed at.
export function resolveApiBase(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw === "") return { base: DEFAULT_API_URL, ignored: null };
  if (!/^https?:\/\//i.test(raw) && !(raw.startsWith("/") && !raw.startsWith("//"))) {
    return { base: DEFAULT_API_URL, ignored: raw };
  }
  return { base: raw.replace(/\/+$/, ""), ignored: null };
}

const resolved = resolveApiBase(import.meta.env?.VITE_API_URL);
if (resolved.ignored !== null) {
  console.warn(`VITE_API_URL must be an http(s) URL or a path starting with "/", got "${resolved.ignored}"; using ${DEFAULT_API_URL}`);
}
export const API_BASE = resolved.base;

// "/scan" -> "http://localhost:8000/api/v1/scan"
export function apiUrl(path, base = API_BASE) {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

// Like apiUrl, but always absolute (a relative base is resolved against `origin`), for showing to people, e.g. curl.
export function absoluteApiUrl(path, { base = API_BASE, origin = window.location.origin } = {}) {
  const url = apiUrl(path, base);
  return url.startsWith("/") ? `${origin}${url}` : url;
}

// The base itself, absolute: "http://localhost:8000/api/v1".
export function absoluteApiBase({ base = API_BASE, origin = window.location.origin } = {}) {
  return base.startsWith("/") ? `${origin}${base}` : base;
}

async function send(path, init) {
  const res = await fetch(apiUrl(path), init);
  let data = null;
  try { data = await res.json(); } catch (_) { /* non-JSON error body, e.g. an HTML 502 */ }
  return { status: res.status, ok: res.ok, data };
}

// GET JSON and return { status, ok, data }; data is null when the body is not JSON.
export function get(path, signal) {
  return send(path, { method: "GET", headers: { Accept: "application/json" }, signal });
}

// POST JSON and return { status, ok, data }; data is null when the body is not JSON.
export function post(path, body, signal) {
  return send(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}
