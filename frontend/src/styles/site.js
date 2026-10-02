// Site chrome: skip link, sticky header and navigation, footer, status badge, toasts.
export const SITE = `
/* skip link and header */
.skip-link { position: absolute; left: var(--space-4); top: var(--space-2); z-index: 20; padding: var(--space-2) var(--space-4); background: var(--accent); color: var(--on-accent); border-radius: var(--radius); font-weight: 600; text-decoration: none; transform: translateY(-200%); transition: transform var(--t-fast); }
.skip-link:focus { transform: translateY(0); }
.skip-link:hover { color: var(--on-accent); }
.site-header { position: sticky; top: 0; z-index: 10; background: var(--surface); border-bottom: 1px solid var(--border); }
.site-header-inner { display: flex; align-items: center; gap: var(--space-4); min-height: 64px; }
.brand { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text); font-size: 17px; font-weight: 800; letter-spacing: -.02em; text-decoration: none; }
.brand:hover { color: var(--text); }
.shield { flex: none; color: var(--accent); }
.shield-check { stroke: var(--on-accent); }
.site-nav { display: flex; align-items: center; gap: var(--space-4); margin-left: auto; }
.site-nav ul, .footer-links { display: flex; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.site-nav a { display: block; padding: var(--space-2) var(--space-3); color: var(--muted); border-radius: var(--radius); font-size: 14px; font-weight: 600; text-decoration: none; transition: background-color var(--t-fast), color var(--t-fast); }
.site-nav a:hover { color: var(--text); background: var(--surface-2); }
.site-nav a[aria-current="page"] { color: var(--accent); background: var(--accent-soft); }
.menu-button { display: none; margin-left: auto; }
.theme-toggle { min-height: 40px; padding: 0 var(--space-3); }
@media (max-width: 719px) {
  .menu-button { display: inline-flex; }
  .site-nav { display: none; position: absolute; top: 100%; left: 0; right: 0; margin: 0; padding: var(--space-3) var(--space-4); background: var(--surface); border-bottom: 1px solid var(--border); box-shadow: var(--shadow-md); }
  .site-nav.open { display: block; }
      .site-nav ul { flex-direction: column; }
  .site-nav a { padding: var(--space-3); font-size: 15px; }
  .site-header-inner { min-height: 56px; }
  .toasts { left: var(--space-4); max-width: none; }
}

/* footer and status */
.site-footer { margin-top: var(--space-7); background: var(--surface); border-top: 1px solid var(--border); }
.site-footer-inner { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); padding-top: var(--space-6); padding-bottom: var(--space-6); }
.site-footer-inner .muted { margin: var(--space-3) 0 0; max-width: 40ch; }
.footer-links { flex-direction: column; gap: var(--space-2); }
.footer-links a { color: var(--muted); font-size: 14px; text-decoration: none; }
.footer-links a:hover { color: var(--text); }
.status-badge { display: inline-flex; align-items: center; gap: var(--space-2); margin: 0; padding: var(--space-1) var(--space-3); background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-pill); font-size: 13px; }
.status-dot { width: 8px; height: 8px; background: var(--muted); border-radius: var(--radius-pill); }
.status-dot.ok { background: var(--safe); }
.status-dot.down { background: var(--critical); }
@media (min-width: 720px) {
  .site-footer-inner { grid-template-columns: 2fr 1fr 1fr; }
}

/* toasts */
.toasts { position: fixed; right: var(--space-4); bottom: var(--space-4); z-index: 30; display: grid; gap: var(--space-2); max-width: min(360px, calc(100vw - 32px)); pointer-events: none; }
.toast { padding: var(--space-3) var(--space-4); background: var(--text); color: var(--bg); border-radius: var(--radius); box-shadow: var(--shadow-md); font-size: 14px; line-height: 20px; }
.toast-error { background: var(--critical); color: #fff; }
`;
