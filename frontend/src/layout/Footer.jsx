import { Link, useRoute } from "../lib/router.jsx";
import { Shield } from "./Shield.jsx";
import { StatusBadge } from "./StatusBadge.jsx";

export function Footer() {
  const { routes } = useRoute();
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div>
          <Link to="/" className="brand"><Shield /><span>ScriptShield</span></Link>
          <p className="muted">Detection is heuristic. Always encode output and use a CSP.</p>
        </div>
        <nav aria-label="Footer">
          <ul className="footer-links">
            {routes.filter((r) => r.nav).map((r) => (
              <li key={r.path}><Link to={r.path}>{r.nav}</Link></li>
            ))}
          </ul>
        </nav>
        <div><StatusBadge /></div>
      </div>
    </footer>
  );
}
