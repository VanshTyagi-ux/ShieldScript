import { absoluteApiUrl } from "../api.js";
import { ENDPOINTS, curlFor, endpointsFor } from "./apiDocs.js";

const byId = (id) => ENDPOINTS.find((e) => e.id === id);
const at = (path) => absoluteApiUrl(path, { origin: "http://localhost:8000" });

describe("ENDPOINTS", () => {
  it("documents every endpoint once, with paths relative to the API base", () => {
    expect(ENDPOINTS.map((e) => `${e.method} ${e.path}`)).toEqual([
      "POST /scan", "POST /submit", "POST /sanitize", "GET /payloads?category=bypass&limit=2", "GET /payloads/facets",
      "GET /payloads/1", "GET /rules", "GET /benchmark", "GET /events", "POST /events/clear", "GET /history?filter=all&limit=25",
      "GET /history/export?format=csv", "POST /history/clear", "GET /analytics?range=24h", "GET /health",
    ]);
    expect(new Set(ENDPOINTS.map((e) => e.id)).size).toBe(ENDPOINTS.length);
    for (const e of ENDPOINTS) expect(e.path, e.id).not.toMatch(/^\/api\b/);
  });

  it("gives every endpoint a summary and a response example, and every POST a request example", () => {
    for (const e of ENDPOINTS) {
      expect(e.summary, e.id).toBeTruthy();
      expect(e.responseExample, e.id).toBeTruthy();
      if (e.method === "POST") expect(e.requestExample, e.id).toBeTruthy();
    }
  });

  it("matches the shapes the backend returns for the new endpoints", () => {
    expect(Object.keys(byId("sanitize").responseExample)).toEqual(["clean", "changed", "report", "detector"]);
    expect(Object.keys(byId("payloads").responseExample)).toEqual(["items", "total", "skip", "limit"]);
    expect(Object.keys(byId("payload").responseExample)).toEqual(["id", "content", "source_file", "category", "created_at"]);
  });
});

describe("endpointsFor", () => {
  it("documents everything when the backend pages are on", () => {
    expect(endpointsFor(true)).toEqual(ENDPOINTS.filter((e) => !e.builtinOnly));
    expect(endpointsFor(true)).toHaveLength(9);
    expect(endpointsFor(true).map((e) => e.id)).not.toContain("events");
  });

  it("documents only what the built-in server has when they are off, in the original order", () => {
    expect(endpointsFor(false).map((e) => e.id)).toEqual(["scan", "submit", "rules", "benchmark", "events", "events-clear", "history", "history-export", "history-clear", "analytics", "health"]);
  });

  it("marks exactly the endpoints only the built-in server has, and documents the live feed's event shape", () => {
    expect(ENDPOINTS.filter((e) => e.builtinOnly).map((e) => e.id)).toEqual(["events", "events-clear", "history", "history-export", "history-clear", "analytics"]);
    expect(ENDPOINTS.find((e) => e.id === "events-clear")).toMatchObject({ method: "POST", path: "/events/clear" });
    expect(Object.keys(ENDPOINTS.find((e) => e.id === "events-clear").responseExample)).toEqual(["cleared"]);
    const events = ENDPOINTS.find((e) => e.id === "events");
    expect(events).toMatchObject({ method: "GET", path: "/events" });
    expect(Object.keys(events.responseExample)).toEqual(["events", "enabled"]);
    expect(Object.keys(events.responseExample.events[0])).toEqual(["id", "ts", "source", "field", "blocked", "score", "level", "rules", "text"]);
  });

  it("documents the scan history: its page, the export and the clear", () => {
    const history = byId("history");
    expect(history).toMatchObject({ method: "GET", builtinOnly: true });
    expect(Object.keys(history.responseExample)).toEqual(["enabled", "items", "total", "counts"]);
    expect(Object.keys(history.responseExample.items[0])).toEqual(["id", "ts", "source", "field", "text", "blocked", "score", "level", "rules", "ml_probability", "decode_layers"]);
    expect(Object.keys(history.responseExample.counts)).toEqual(["all", "blocked", "allowed"]);
    expect(byId("history-export")).toMatchObject({ method: "GET", path: "/history/export?format=csv", builtinOnly: true });
    expect(byId("history-export").summary).toMatch(/CSV/);
    expect(byId("history-clear")).toMatchObject({ method: "POST", path: "/history/clear", builtinOnly: true });
    expect(Object.keys(byId("history-clear").responseExample)).toEqual(["cleared"]);
  });

  it("documents the analytics endpoint and its summary shape", () => {
    const analytics = ENDPOINTS.find((e) => e.id === "analytics");
    expect(analytics).toMatchObject({ method: "GET", path: "/analytics?range=24h", builtinOnly: true });
    expect(Object.keys(analytics.responseExample)).toEqual(["enabled", "range", "generated", "bucket", "totals", "timeline", "levels", "rules", "categories", "sources", "fields", "scores", "recent_critical"]);
    expect(analytics.summary).toMatch(/1h/);
  });

  it("says the scan endpoint takes an optional source", () => {
    expect(ENDPOINTS.find((e) => e.id === "scan").summary).toMatch(/source/);
    expect(ENDPOINTS.find((e) => e.id === "scan").summary).toMatch(/"store": false/);
  });

  it("marks exactly the endpoints only the FastAPI backend has", () => {
    expect(ENDPOINTS.filter((e) => e.backendOnly).map((e) => e.id)).toEqual(["sanitize", "payloads", "payload-facets", "payload"]);
  });
});

describe("curlFor", () => {
  it("builds a POST with a JSON header and body against the full API URL", () => {
    expect(curlFor(byId("scan"), "http://localhost:8000")).toBe(
      `curl -X POST '${at("/scan")}' -H 'Content-Type: application/json' -d '{"text":"<img src=x onerror=alert(1)>"}'`);
  });

  it("uses a given body instead of the example", () => {
    expect(curlFor(byId("scan"), "http://x", { text: "hi" })).toContain(`-d '{"text":"hi"}'`);
  });

  it("escapes single quotes so the command stays valid in a shell", () => {
    expect(curlFor(byId("scan"), "http://x", { text: "it's" })).toContain(`-d '{"text":"it'\\''s"}'`);
  });

  it("builds a bare GET, quoting the URL so a query string survives the shell", () => {
    expect(curlFor(byId("health"), "http://localhost:8000")).toBe(`curl '${at("/health")}'`);
    expect(curlFor(byId("payloads"), "http://localhost:8000")).toBe(`curl '${at("/payloads?category=bypass&limit=2")}'`);
  });
});
