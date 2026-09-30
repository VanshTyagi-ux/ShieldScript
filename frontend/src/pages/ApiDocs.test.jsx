import { render, screen, within } from "@testing-library/react";
import { absoluteApiBase } from "../api.js";
import { RouterProvider } from "../lib/router.jsx";
import { ToastProvider } from "../lib/toast.jsx";
import { ApiDocsPage } from "./ApiDocs.jsx";

vi.mock("../api.js", async (importOriginal) => ({ ...(await importOriginal()), get: vi.fn(), post: vi.fn() }));

const routes = [{ path: "/api-docs", title: "API docs", component: ApiDocsPage }];
const mount = () => {
  window.history.pushState(null, "", "/api-docs");
  return render(
    <ToastProvider><RouterProvider routes={routes} notFound={{ title: "x", component: () => null }}><ApiDocsPage /></RouterProvider></ToastProvider>,
  );
};

describe("ApiDocsPage", () => {
  it("has a single h1 and one section per endpoint", () => {
    mount();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "POST /scan", "POST /submit", "POST /sanitize", "GET /payloads?category=bypass&limit=2", "GET /payloads/facets",
      "GET /payloads/1", "GET /rules", "GET /benchmark", "GET /health", "Errors",
    ]);
  });

  it("shows the configured API base URL once", () => {
    const { container } = mount();
    expect(container.querySelector(".api-base code").textContent).toBe(absoluteApiBase());
  });

  it("badges each method and shows a curl example for every endpoint", () => {
    const { container } = mount();
    expect(container.querySelectorAll(".method-post")).toHaveLength(3);
    expect(container.querySelectorAll(".method-get")).toHaveLength(6);
    for (const section of container.querySelectorAll("section.endpoint")) {
      expect(within(section).getByText(/^curl /)).toBeTruthy();
    }
  });

  it("offers a Try-it box per endpoint", () => {
    mount();
    expect(screen.getAllByRole("button", { name: "Send request" })).toHaveLength(9);
  });

  it("lists the error statuses", () => {
    mount();
    for (const status of ["400", "404", "411", "413", "422", "503"]) expect(screen.getAllByText(status).length).toBeGreaterThan(0);
  });
});
