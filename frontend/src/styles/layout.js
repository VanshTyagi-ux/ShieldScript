// Page layout: containers, the two-column page grid and cards.
export const LAYOUT = `
/* layout: one column, then input | result on wide screens */
.site-header-inner, .site-footer-inner, main { max-width: 1120px; margin: 0 auto; padding-left: var(--space-4); padding-right: var(--space-4); }
main { min-height: 60vh; padding-top: var(--space-6); padding-bottom: var(--space-6); }
/* Home's full-bleed sections need main itself unconstrained; each section's .bleed-inner re-applies the
   normal content width and padding, so it looks identical to every other page from the reader's side. */
main.main-full-bleed { max-width: none; padding-left: 0; padding-right: 0; padding-top: 0; padding-bottom: 0; }
/* Security Dashboard area: page menu in a left sidebar on wide screens, a tab strip above the page on phones */
.app-body.has-sidebar { max-width: 1280px; margin: 0 auto; }
.app-body.has-sidebar main { max-width: none; margin: 0; }
.side-nav { padding: var(--space-3) var(--space-4) 0; }
.side-nav-title { margin: 0 0 var(--space-2); padding: 0 var(--space-3); color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.side-nav ul { display: flex; gap: var(--space-1); margin: 0; padding: 0; list-style: none; overflow-x: auto; }
.side-nav a { display: block; padding: var(--space-2) var(--space-3); color: var(--muted); border-radius: var(--radius); font-size: 14px; font-weight: 600; text-decoration: none; white-space: nowrap; transition: background-color var(--t-fast), color var(--t-fast); }
.side-nav a:hover { color: var(--text); background: var(--surface-2); }
.side-nav a[aria-current="page"] { color: var(--accent); background: var(--accent-soft); }
@media (min-width: 900px) {
  .app-body.has-sidebar { display: grid; grid-template-columns: 220px minmax(0, 1fr); align-items: start; }
  .side-nav { position: sticky; top: var(--space-4); padding: var(--space-6) 0 0 var(--space-5); }
  .side-nav ul { flex-direction: column; overflow: visible; }
  .app-body.has-sidebar main { max-width: 1060px; }
}
.page-heading { margin-bottom: var(--space-5); }
.page-heading h1:focus { outline: none; }
.page-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-4); box-shadow: var(--shadow-sm); }
.form-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.outcome { padding-top: var(--space-5); border-top: 1px solid var(--border); }
@media (min-width: 900px) {
  .site-header-inner, .site-footer-inner, main { padding-left: var(--space-5); padding-right: var(--space-5); }
  .page-grid { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); }
  .card { padding: var(--space-5); }
  .wide { grid-column: 1 / -1; }
  /* Scanner: input and session insights stack on the left beside the tall result, so no blank space opens up under the input */
  .scanner-grid { grid-template-rows: auto minmax(0, 1fr) auto; }
  .scan-input { grid-column: 1; grid-row: 1; }
  .scan-result { grid-column: 2; grid-row: 1 / span 2; }
  .scan-insights { grid-column: 1; grid-row: 2; }
  .scanner-grid > .wide { grid-row: 3; }
  .scan-insights .grid-2 { grid-template-columns: minmax(0, 1fr); }
  .form-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .outcome { padding-top: 0; border-top: 0; }
}
`;
