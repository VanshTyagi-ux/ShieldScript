import { NOT_FOUND, ROUTES, buildRoutes } from "./routes.js";

const paths = (routes) => routes.map((r) => r.path);
const BACKEND_ONLY = ["/payloads", "/playground"];
const CORE = ["/", "/scanner", "/how-it-works", "/rules", "/benchmarks", "/api-docs", "/about"];

describe("buildRoutes", () => {
  it("has unique paths and gives every page a title, except the home page", () => {
    const routes = buildRoutes(true);
    expect(new Set(paths(routes)).size).toBe(routes.length);
    for (const route of routes.filter((r) => r.path !== "/")) expect(route.title, route.path).toBeTruthy();
    expect(NOT_FOUND.title).toBeTruthy();
  });

  it("with the backend pages: puts the payload browser and the sanitizer playground in the navigation", () => {
    const routes = buildRoutes(true);
    const nav = Object.fromEntries(routes.filter((r) => r.nav).map((r) => [r.path, r.nav]));
    expect(nav["/payloads"]).toBe("Payloads");
    expect(nav["/playground"]).toBe("Sanitizer");
    for (const path of CORE) expect(paths(routes)).toContain(path);
  });

  it("without them: leaves those two pages out entirely, and keeps every other page", () => {
    const routes = buildRoutes(false);
    for (const path of BACKEND_ONLY) expect(paths(routes)).not.toContain(path);
    expect(paths(routes)).toEqual(["/", "/scanner", "/live", "/how-it-works", "/rules", "/benchmarks", "/api-docs", "/about"]);
    expect(routes.filter((r) => r.nav).map((r) => r.nav)).not.toContain("Payloads");
  });

  it("offers the live feed only in builds served by the built-in server, which is what has /events", () => {
    expect(paths(buildRoutes(false))).toContain("/live");
    expect(paths(buildRoutes(true))).not.toContain("/live");
    expect(buildRoutes(false).find((r) => r.path === "/live")).toMatchObject({ title: "Live feed", nav: "Live" });
  });

  it("ROUTES is the build's choice, and the default build has the backend pages", () => {
    expect(ROUTES.map((r) => r.path)).toEqual(buildRoutes(true).map((r) => r.path));
  });
});
