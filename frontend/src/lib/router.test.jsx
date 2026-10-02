import { act, fireEvent, render, screen } from "@testing-library/react";
import { Link, RouterProvider, Routes, matchRoute, useRoute } from "./router.jsx";

const Where = () => {
  const { path, search } = useRoute();
  return <p data-testid="where">{path + search}</p>;
};
const routes = [
  { path: "/", title: "", component: () => <h1>Home page</h1> },
  { path: "/rules", title: "Rules", nav: "Rules", component: () => <h1>Rules page</h1> },
  { path: "/about", title: "About", component: () => <h1>About page</h1> },
];
const notFound = { title: "Page not found", component: () => <h1>Missing page</h1> };

function mount(startAt = "/") {
  window.history.pushState(null, "", startAt);
  return render(
    <RouterProvider routes={routes} notFound={notFound}>
      <Link to="/rules">Rules link</Link>
      <Link to="/about">About link</Link>
      <Link to="https://example.com/x">External link</Link>
      <Link to="/rules" target="_blank">Blank link</Link>
      <Where />
      <Routes />
    </RouterProvider>,
  );
}

beforeEach(() => { window.scrollTo = vi.fn(); });
afterEach(() => vi.restoreAllMocks());

describe("matchRoute", () => {
  it("matches exactly, ignoring one trailing slash", () => {
    expect(matchRoute(routes, "/rules").path).toBe("/rules");
    expect(matchRoute(routes, "/rules/").path).toBe("/rules");
    expect(matchRoute(routes, "/").path).toBe("/");
  });

  it("returns null for an unknown path", () => {
    expect(matchRoute(routes, "/nope")).toBeNull();
    expect(matchRoute(routes, "/rules/x")).toBeNull();
  });
});

describe("area", () => {
  const AreaIs = () => <p data-testid="area">{useRoute().area}</p>;
  const areaRoutes = [
    { path: "/", title: "", component: () => <h1>Home</h1> },
    { path: "/rules", title: "Rules", nav: "Rules", component: () => <h1>Rules</h1> },
    { path: "/dashboard", title: "Dashboard", nav: "Dashboard", area: "security", component: () => <h1>Dashboard</h1> },
  ];
  const areaAt = (path) => {
    window.history.pushState(null, "", path);
    render(<RouterProvider routes={areaRoutes} notFound={notFound}><AreaIs /></RouterProvider>);
    return screen.getByTestId("area").textContent;
  };

  it("is security for a security page and site for every other page, including home and not-found", () => {
    expect(areaAt("/dashboard")).toBe("security");
  });
  it("is site for a main-site page", () => expect(areaAt("/rules")).toBe("site"));
  it("is site for the home page", () => expect(areaAt("/")).toBe("site"));
  it("is site for an unknown page", () => expect(areaAt("/nope")).toBe("site"));
});

describe("router", () => {
  it("renders the route for the current location", () => {
    mount("/rules");
    expect(screen.getByRole("heading").textContent).toBe("Rules page");
  });

  it("navigates on a plain click without a page load, and scrolls to the top", () => {
    mount("/");
    const notCancelled = fireEvent.click(screen.getByText("Rules link"));
    expect(notCancelled).toBe(false); // preventDefault was called
    expect(window.location.pathname).toBe("/rules");
    expect(screen.getByRole("heading").textContent).toBe("Rules page");
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("leaves modified clicks, new-tab links and external links to the browser", () => {
    mount("/");
    expect(fireEvent.click(screen.getByText("Rules link"), { metaKey: true })).toBe(true);
    expect(fireEvent.click(screen.getByText("Rules link"), { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(screen.getByText("Blank link"))).toBe(true);
    expect(fireEvent.click(screen.getByText("External link"))).toBe(true);
    expect(window.location.pathname).toBe("/");
  });

  it("marks only the link to the current page with aria-current", () => {
    mount("/rules");
    expect(screen.getByText("Rules link").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("About link").getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("External link").getAttribute("aria-current")).toBeNull();
  });

  it("follows the browser's back and forward buttons", () => {
    mount("/");
    fireEvent.click(screen.getByText("About link"));
    expect(screen.getByRole("heading").textContent).toBe("About page");
    act(() => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("heading").textContent).toBe("Home page");
  });

  it("exposes the query string", () => {
    mount("/rules?t=1");
    expect(screen.getByTestId("where").textContent).toBe("/rules?t=1");
  });

  it("replaces instead of pushing when asked to", () => {
    mount("/");
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    let navigate;
    const Grab = () => { navigate = useRoute().navigate; return null; };
    render(<RouterProvider routes={routes} notFound={notFound}><Grab /></RouterProvider>);
    act(() => navigate("/about", { replace: true }));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("sets the document title per route", () => {
    mount("/rules");
    expect(document.title).toBe("Rules · ScriptShield");
    fireEvent.click(screen.getByText("About link"));
    expect(document.title).toBe("About · ScriptShield");
  });

  it("uses the bare product title for a route with an empty title", () => {
    mount("/");
    expect(document.title).toBe("ScriptShield");
  });

  it("renders the not-found route, with its own title, for an unknown path", () => {
    mount("/definitely/not/here");
    expect(screen.getByRole("heading").textContent).toBe("Missing page");
    expect(document.title).toBe("Page not found · ScriptShield");
  });

  it("refuses to be used outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Where />)).toThrow(/RouterProvider/);
    spy.mockRestore();
  });
});
