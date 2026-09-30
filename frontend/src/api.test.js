import { API_BASE, DEFAULT_API_URL, absoluteApiUrl, apiUrl, get, post, resolveApiBase } from "./api.js";

const response = (status, body, { json = true } = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: json ? async () => body : async () => { throw new SyntaxError("Unexpected token <"); },
});

describe("resolveApiBase", () => {
  it("defaults to the FastAPI backend when the variable is not set or blank", () => {
    for (const value of [undefined, null, "", "   ", 5]) {
      expect(resolveApiBase(value)).toEqual({ base: "http://localhost:8000/api/v1", ignored: null });
    }
    expect(DEFAULT_API_URL).toBe("http://localhost:8000/api/v1");
  });

  it("accepts http(s) URLs and absolute paths, dropping trailing slashes and spaces", () => {
    expect(resolveApiBase("https://api.example.com/api/v1").base).toBe("https://api.example.com/api/v1");
    expect(resolveApiBase("  http://localhost:8000/api/v1///  ").base).toBe("http://localhost:8000/api/v1");
    expect(resolveApiBase("HTTP://Example.com/x").base).toBe("HTTP://Example.com/x");
    expect(resolveApiBase("/api").base).toBe("/api");
    expect(resolveApiBase("/api/").base).toBe("/api");
    expect(resolveApiBase("/").base).toBe("");
  });

  it("ignores, and reports, values that are neither a URL nor an absolute path", () => {
    for (const bad of ["localhost:8000/api/v1", "api/v1", "//evil.example/api", "javascript:alert(1)", "ftp://x/y", "data:text/plain,x"]) {
      expect(resolveApiBase(bad)).toEqual({ base: DEFAULT_API_URL, ignored: bad });
    }
  });
});

describe("apiUrl", () => {
  it("joins the base and a path with exactly one slash", () => {
    expect(apiUrl("/scan", "http://h/api/v1")).toBe("http://h/api/v1/scan");
    expect(apiUrl("scan", "http://h/api/v1")).toBe("http://h/api/v1/scan");
    expect(apiUrl("/payloads?limit=5&category=bypass", "/api")).toBe("/api/payloads?limit=5&category=bypass");
    expect(apiUrl("/scan", "")).toBe("/scan");
  });

  it("uses the configured base by default", () => {
    expect(apiUrl("/health")).toBe(`${API_BASE}/health`);
    expect(API_BASE).toBe(resolveApiBase(import.meta.env?.VITE_API_URL).base);
  });
});

describe("absoluteApiUrl", () => {
  it("resolves a relative base against the page origin and leaves an absolute one alone", () => {
    expect(absoluteApiUrl("/scan", { base: "/api", origin: "http://127.0.0.1:8010" })).toBe("http://127.0.0.1:8010/api/scan");
    expect(absoluteApiUrl("/scan", { base: "http://localhost:8000/api/v1", origin: "http://127.0.0.1:8010" })).toBe("http://localhost:8000/api/v1/scan");
  });
});

describe("get", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends a JSON GET to the base URL with no body and forwards the abort signal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(200, { ok: 1 }));
    const signal = new AbortController().signal;
    expect(await get("/health", signal)).toEqual({ status: 200, ok: true, data: { ok: 1 } });
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/health`, { method: "GET", headers: { Accept: "application/json" }, signal });
  });

  it("returns data: null when the body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(502, null, { json: false }));
    expect(await get("/rules")).toEqual({ status: 502, ok: false, data: null });
  });

  it("lets a network failure reject so callers can show it", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(get("/rules")).rejects.toThrow("Failed to fetch");
  });
});

describe("post", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends a JSON POST to the base URL and forwards the abort signal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(200, { score: 1 }));
    const signal = new AbortController().signal;
    await post("/scan", { text: "hi" }, signal);
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
      signal,
    });
  });

  it("returns status, ok and parsed data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(422, { accepted: false }));
    expect(await post("/submit", {})).toEqual({ status: 422, ok: false, data: { accepted: false } });
  });

  it("returns data: null when the body is not JSON (e.g. an HTML 502 from a proxy)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(502, null, { json: false }));
    expect(await post("/scan", {})).toEqual({ status: 502, ok: false, data: null });
  });
});
