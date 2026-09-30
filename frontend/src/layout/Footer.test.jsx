import { render, screen, within } from "@testing-library/react";
import { useApi } from "../lib/useApi.js";
import { RouterProvider } from "../lib/router.jsx";
import { Footer } from "./Footer.jsx";
import { StatusBadge } from "./StatusBadge.jsx";
import { HEALTH_FIXTURE } from "../test/fixtures.js";

vi.mock("../lib/useApi.js", () => ({ useApi: vi.fn() }));

const empty = () => null;
const routes = [
  { path: "/", title: "", component: empty },
  { path: "/scanner", title: "Scanner", nav: "Scanner", component: empty },
];
const withRouter = (ui) => {
  window.history.pushState(null, "", "/");
  return render(<RouterProvider routes={routes} notFound={{ title: "x", component: empty }}>{ui}</RouterProvider>);
};
const health = (state) => useApi.mockReturnValue({ status: "ok", data: null, error: null, reload() {}, ...state });

beforeEach(() => { useApi.mockReset(); });

describe("StatusBadge", () => {
  it("reads GET /health", () => {
    health({ data: HEALTH_FIXTURE });
    render(<StatusBadge />);
    expect(useApi).toHaveBeenCalledWith("/health");
  });

  it("says the ML model is loaded", () => {
    health({ data: HEALTH_FIXTURE });
    render(<StatusBadge />);
    expect(screen.getByText("Operational · ML model loaded")).toBeTruthy();
    expect(document.querySelector(".status-dot").className).toContain("ok");
  });

  it("says when only the rules are running", () => {
    health({ data: { ...HEALTH_FIXTURE, ml_loaded: false } });
    render(<StatusBadge />);
    expect(screen.getByText("Operational · rules only")).toBeTruthy();
  });

  it("says when the status is unavailable", () => {
    health({ status: "error", error: "network down" });
    render(<StatusBadge />);
    expect(screen.getByText("Status unavailable")).toBeTruthy();
    expect(document.querySelector(".status-dot").className).toContain("down");
  });

  it("says it is checking while the first response is pending", () => {
    health({ status: "loading" });
    render(<StatusBadge />);
    expect(screen.getByText("Checking status…")).toBeTruthy();
  });

  it("does not rely on colour alone: the dot is decorative and the text carries the state", () => {
    health({ data: HEALTH_FIXTURE });
    render(<StatusBadge />);
    expect(document.querySelector(".status-dot").getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Footer", () => {
  it("shows the tagline, the nav links and the status", () => {
    health({ data: HEALTH_FIXTURE });
    withRouter(<Footer />);
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText("Detection is heuristic. Always encode output and use a CSP.")).toBeTruthy();
    expect(within(within(footer).getByRole("navigation", { name: "Footer" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["Scanner"]);
    expect(within(footer).getByText("Operational · ML model loaded")).toBeTruthy();
  });
});
