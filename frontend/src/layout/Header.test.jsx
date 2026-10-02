import { fireEvent, render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "../lib/theme.jsx";
import { RouterProvider } from "../lib/router.jsx";
import { Header } from "./Header.jsx";

const empty = () => null;
const routes = [
  { path: "/", title: "", component: empty },
  { path: "/scanner", title: "Scanner", nav: "Scanner", component: empty },
  { path: "/rules", title: "Rules", nav: "Rules", component: empty },
];

function mount(at = "/scanner") {
  window.history.pushState(null, "", at);
  return render(
    <ThemeProvider>
      <RouterProvider routes={routes} notFound={{ title: "Not found", component: empty }}>
        <Header />
      </RouterProvider>
    </ThemeProvider>,
  );
}
const SECURITY = [
  { path: "/dashboard", title: "Dashboard", nav: "Dashboard", area: "security", component: empty },
  { path: "/history", title: "History", nav: "History", area: "security", component: empty },
  { path: "/live", title: "Live feed", nav: "Live", area: "security", component: empty },
];
function mountAreas(at) {
  window.history.pushState(null, "", at);
  return render(
    <ThemeProvider>
      <RouterProvider routes={[...routes, ...SECURITY]} notFound={{ title: "Not found", component: empty }}>
        <Header />
      </RouterProvider>
    </ThemeProvider>,
  );
}
const pages = () => within(within(nav()).getByRole("list")).getAllByRole("link").map((a) => a.textContent);
const nav = () => screen.getByRole("navigation", { name: "Main" });
const menuButton = () => screen.getByRole("button", { name: "Menu" });

describe("Header: Security Dashboard pages", () => {
  it("lists only the main-site pages; the Security Dashboard pages are in the sidebar", () => {
    for (const at of ["/scanner", "/dashboard", "/history"]) {
      const { unmount } = mountAreas(at);
      expect(pages()).toEqual(["Scanner", "Rules"]);
      unmount();
    }
  });
});

describe("Header", () => {
  it("has the brand link to the home page", () => {
    mount();
    const brand = within(screen.getByRole("banner")).getByRole("link", { name: /ScriptShield/ });
    expect(brand.getAttribute("href")).toBe("/");
  });

  it("lists only the routes that have a nav label", () => {
    mount();
    expect(within(nav()).getAllByRole("link").map((a) => a.textContent)).toEqual(["Scanner", "Rules"]);
  });

  it("marks the current page", () => {
    mount("/rules");
    expect(within(nav()).getByText("Rules").getAttribute("aria-current")).toBe("page");
    expect(within(nav()).getByText("Scanner").getAttribute("aria-current")).toBeNull();
  });

  it("has a skip link to the main content", () => {
    mount();
    expect(document.querySelector("a.skip-link").getAttribute("href")).toBe("#main");
  });

  it("includes the theme toggle", () => {
    mount();
    expect(screen.getByRole("button", { name: /^Theme:/ })).toBeTruthy();
  });

  it("toggles the mobile menu and reports its state", () => {
    mount();
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
    expect(menuButton().getAttribute("aria-controls")).toBe("site-nav");
    fireEvent.click(menuButton());
    expect(menuButton().getAttribute("aria-expanded")).toBe("true");
    expect(nav().className).toContain("open");
  });

  it("closes the menu when a link is chosen", () => {
    mount();
    fireEvent.click(menuButton());
    fireEvent.click(within(nav()).getByText("Rules"));
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
    expect(window.location.pathname).toBe("/rules");
  });

  it("closes the menu on Escape", () => {
    mount();
    fireEvent.click(menuButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
  });
});
