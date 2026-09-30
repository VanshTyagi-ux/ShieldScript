import { useEffect, useState } from "react";
import { Link, useRoute } from "../lib/router.jsx";
import { Shield } from "./Shield.jsx";
import { ThemeToggle } from "./ThemeToggle.jsx";

export function Header() {
  const { routes, path } = useRoute();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [path]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="site-header">
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="site-header-inner">
        <Link to="/" className="brand"><Shield /><span>XSS Detector</span></Link>
        <button type="button" className="ghost menu-button" aria-label="Menu" aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen(!open)}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        <nav id="site-nav" className={`site-nav${open ? " open" : ""}`} aria-label="Main">
          <ul>
            {routes.filter((r) => r.nav).map((r) => (
              <li key={r.path}><Link to={r.path}>{r.nav}</Link></li>
            ))}
          </ul>
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
