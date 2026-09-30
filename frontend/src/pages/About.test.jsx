import { render, screen } from "@testing-library/react";
import { RouterProvider } from "../lib/router.jsx";
import { AboutPage } from "./About.jsx";

const routes = [{ path: "/about", title: "About", component: AboutPage }];
const mount = () => {
  window.history.pushState(null, "", "/about");
  return render(<RouterProvider routes={routes} notFound={{ title: "x", component: () => null }}><AboutPage /></RouterProvider>);
};

describe("AboutPage", () => {
  it("has a single h1 and the expected sections", () => {
    mount();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "What it is", "Limitations", "How it is built", "Roadmap",
    ]);
  });

  it("is honest about the limits", () => {
    mount();
    expect(screen.getByText(/Detection is heuristic/)).toBeTruthy();
    expect(screen.getByText(/DOM-based XSS/)).toBeTruthy();
    expect(screen.getByText(/not production-grade/)).toBeTruthy();
  });

  it("lists the rich-text sanitizer as planned, not shipped", () => {
    mount();
    const item = screen.getByText(/Rich-text sanitizer/).closest("li");
    expect(item.textContent).toMatch(/planned/i);
  });

  it("links to the scanner and the benchmarks", () => {
    mount();
    expect(screen.getByRole("link", { name: "Try the scanner" }).getAttribute("href")).toBe("/scanner");
    expect(screen.getByRole("link", { name: "See the benchmarks" }).getAttribute("href")).toBe("/benchmarks");
  });
});
