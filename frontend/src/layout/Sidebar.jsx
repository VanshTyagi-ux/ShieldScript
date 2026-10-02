import { Link, useRoute } from "../lib/router.jsx";

// The Security Dashboard menu, on every page except the full-width Home page. Only builds that have the pages get it.
export function useSidebarPages() {
  const { routes, path } = useRoute();
  return path === "/" ? [] : routes.filter((r) => r.nav && r.area === "security");
}

export function Sidebar() {
  const pages = useSidebarPages();
  if (pages.length === 0) return null;
  return (
    <nav className="side-nav" aria-label="Security Dashboard">
      <p className="side-nav-title">Security Dashboard</p>
      <ul>
        {pages.map((r) => (
          <li key={r.path}><Link to={r.path}>{r.nav}</Link></li>
        ))}
      </ul>
    </nav>
  );
}
