import { render, screen, within } from "@testing-library/react";
import { post } from "../api.js";
import { RouterProvider } from "../lib/router.jsx";
import { ToastProvider } from "../lib/toast.jsx";
import { useApi } from "../lib/useApi.js";
import { BENCHMARK_FIXTURE, HEALTH_FIXTURE } from "../test/fixtures.js";
import { HomePage } from "./Home.jsx";

vi.mock("../api.js", async (importOriginal) => ({ ...(await importOriginal()), post: vi.fn() }));
vi.mock("../lib/useApi.js", () => ({ useApi: vi.fn() }));

const originalMatchMedia = window.matchMedia;
const routes = [{ path: "/", title: "", component: HomePage }];
const answer = (benchmark, health = { status: "ok", data: HEALTH_FIXTURE }) => {
  useApi.mockImplementation((path) => ({ error: null, reload() {}, ...(path === "/benchmark" ? benchmark : health) }));
};
const okBench = () => ({ status: "ok", data: BENCHMARK_FIXTURE });
const mount = () => {
  window.history.pushState(null, "", "/");
  return render(
    <ToastProvider><RouterProvider routes={routes} notFound={{ title: "x", component: () => null }}><HomePage /></RouterProvider></ToastProvider>,
  );
};
const tiles = (c) => [...c.querySelectorAll(".stat-tile")].map((t) => [t.querySelector(".stat-label").textContent, t.querySelector(".stat-value").textContent]);

beforeEach(() => {
  useApi.mockReset();
  post.mockReset();
  post.mockReturnValue(new Promise(() => {}));
  // count-ups and the hero animation are covered elsewhere; here they should settle immediately
  window.matchMedia = (media) => ({ matches: true, media, addEventListener() {}, removeEventListener() {} });
  answer(okBench());
});
afterEach(() => { window.matchMedia = originalMatchMedia; });

describe("HomePage", () => {
  it("has one h1 with the headline, a subhead, and two calls to action", () => {
    const { container } = mount();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1").textContent).toBe("Catch XSS in user input before it reaches your page.");
    expect(screen.getByRole("link", { name: "Try the scanner" }).getAttribute("href")).toBe("/scanner");
    expect(screen.getByRole("link", { name: "See how it works" }).getAttribute("href")).toBe("/how-it-works");
  });

  it("includes the live demo", () => {
    mount();
    expect(screen.getByRole("group", { name: "Live detection demo" })).toBeTruthy();
  });

  it("shows the headline numbers from the benchmark and the rule count from the server", () => {
    const { container } = mount();
    expect(tiles(container)).toEqual([
      ["Recall", "95.2%"], ["Precision", "100.0%"], ["False-positive rate", "0.00%"], ["Rules", "23"], ["Payloads tested", "5,405"],
    ]);
  });

  it("shows skeletons while the numbers load", () => {
    answer({ status: "loading", data: null });
    const { container } = mount();
    expect(screen.getByRole("status", { name: "Loading statistics" })).toBeTruthy();
    expect(container.querySelector(".stat-tile")).toBeNull();
  });

  it("says the numbers are unavailable, without breaking the page, when the benchmark cannot be loaded", () => {
    answer({ status: "error", data: null, error: "Benchmark not generated" });
    const { container } = mount();
    expect(screen.getByText("Benchmark numbers are not available yet.")).toBeTruthy();
    expect(container.querySelector(".stat-tile")).toBeNull();
    expect(container.querySelector("h1")).not.toBeNull();
  });

  it("copes with a malformed benchmark response", () => {
    answer({ status: "ok", data: { unexpected: true } });
    const { container } = mount();
    expect(screen.getByText("Benchmark numbers are not available yet.")).toBeTruthy();
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("omits the rule count tile when the server status is unavailable", () => {
    answer(okBench(), { status: "error", data: null });
    const { container } = mount();
    expect(tiles(container).map(([label]) => label)).toEqual(["Recall", "Precision", "False-positive rate", "Payloads tested"]);
  });

  it("lists six features", () => {
    const { container } = mount();
    expect(container.querySelectorAll("li.feature")).toHaveLength(6);
  });

  it("shows how to use it, in Python and over HTTP, each copyable", () => {
    const { container } = mount();
    const codes = [...container.querySelectorAll(".code-block")];
    expect(codes).toHaveLength(2);
    expect(within(codes[0]).getByText("Python library")).toBeTruthy();
    expect(codes[0].querySelector("code").textContent).toContain("from xss_detector import scan");
    expect(within(codes[1]).getByText("curl")).toBeTruthy();
    expect(codes[1].querySelector("code").textContent).toContain("/scan");
    expect(within(codes[0]).getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("ends with links to the benchmarks and the rules", () => {
    mount();
    expect(screen.getByRole("link", { name: "Read the benchmarks" }).getAttribute("href")).toBe("/benchmarks");
    expect(screen.getByRole("link", { name: "Browse the rules" }).getAttribute("href")).toBe("/rules");
  });

  it("uses the page-level h2s for its sections", () => {
    const { container } = mount();
    expect([...container.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Key numbers", "Why it works", "Use it in your app", "See it on your own input"]);
  });

  it("lays out full-bleed sections, the hero and closing CTA sharing the bold background", () => {
    const { container } = mount();
    const bleeds = [...container.querySelectorAll(".bleed")];
    expect(bleeds.map((el) => el.className)).toEqual([
      "hero-block bleed", "stats-block bleed", "features-block bleed", "code-block-section bleed", "cta-block bleed",
    ]);
  });
});
