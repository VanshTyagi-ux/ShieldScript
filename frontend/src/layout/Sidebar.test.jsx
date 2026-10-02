import { render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "../lib/theme.jsx";
import { RouterProvider } from "../lib/router.jsx";
import { Sidebar } from "./Sidebar.jsx";

const empty = () => null;
const routes = [
  { path: "/", title: "", component: empty },
  { path: "/scanner", title: "Scanner", nav: "Scanner", component: empty },
  { path: "/dashboard", title: "Dashboard", nav: "Dashboard", area: "security", component: empty },
  { path: "/history", title: "History", nav: "History", area: "security", component: empty },
  { path: "/live", title: "Live feed", nav: "Live", area: "security", component: empty },
];

function mount(at, list = routes) {
  window.history.pushState(null, "", at);
  return render(
    <ThemeProvider>
      <RouterProvider routes={list} notFound={{ title: "Not found", component: empty }}>
        <Sidebar />
      </RouterProvider>
    </ThemeProvider>,
  );
}
const side = () => screen.getByRole("navigation", { name: "Security Dashboard" });

describe("Sidebar", () => {
  it("lists the Security Dashboard pages inside the area", () => {
    mount("/history");
    const links = within(side()).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Dashboard", "/dashboard"], ["History", "/history"], ["Live", "/live"],
    ]);
  });

  it("marks the current page", () => {
    mount("/live");
    const current = within(side()).getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Live"]);
  });

  it("is on the main-site pages too", () => {
    mount("/scanner");
    expect(within(side()).getAllByRole("link")).toHaveLength(3);
  });

  it("is absent on the full-width Home page", () => {
    mount("/");
    expect(screen.queryByRole("navigation", { name: "Security Dashboard" })).toBeNull();
  });

  it("is absent when the build has no security pages", () => {
    mount("/scanner", routes.filter((r) => !r.area));
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
