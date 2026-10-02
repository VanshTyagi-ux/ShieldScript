import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// A tiny History-API router: real <a href> links, exact path matching, per-route document titles.
// A route is { path, title, nav?, component }; notFound is { title, component }.
const RouterContext = createContext(null);

const normalize = (pathname) => (pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname);
const readLocation = () => ({ path: normalize(window.location.pathname), search: window.location.search });
const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

export function matchRoute(routes, pathname) {
  const path = normalize(pathname);
  return routes.find((r) => r.path === path) || null;
}

const titleFor = (route) => (route && route.title ? `${route.title} · ScriptShield` : "ScriptShield");

export function RouterProvider({ routes, notFound, children }) {
  const [location, setLocation] = useState(readLocation);
  const route = useMemo(() => matchRoute(routes, location.path), [routes, location.path]);

  useEffect(() => { document.title = titleFor(route || notFound); }, [route, notFound]);

  useEffect(() => {
    const onPop = () => setLocation(readLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    const url = new URL(to, window.location.origin);
    const target = url.pathname + url.search + url.hash;
    if (replace) window.history.replaceState(null, "", target);
    else window.history.pushState(null, "", target);
    setLocation({ path: normalize(url.pathname), search: url.search });
    window.scrollTo(0, 0);
  }, []);

  const area = route && route.area === "security" ? "security" : "site"; // home and the not-found page belong to the main site
  const value = useMemo(() => ({ ...location, route, routes, notFound, navigate, area }), [location, route, routes, notFound, navigate, area]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRoute() {
  const value = useContext(RouterContext);
  if (!value) throw new Error("useRoute must be used inside a RouterProvider");
  return value;
}

export function Routes() {
  const { route, notFound } = useRoute();
  const Page = (route || notFound).component;
  return <Page />;
}

export function Link({ to, children, onClick, ...rest }) {
  const { path, navigate } = useRoute();
  const external = EXTERNAL.test(to);
  const current = !external && normalize(new URL(to, window.location.origin).pathname) === path;

  function handleClick(event) {
    if (onClick) onClick(event);
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.defaultPrevented || event.button !== 0 || modified || external || rest.target || rest.download) return;
    event.preventDefault();
    navigate(to);
  }

  return (
    <a href={to} aria-current={current ? "page" : undefined} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
