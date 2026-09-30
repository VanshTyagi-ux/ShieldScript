// Page layout: containers, the two-column page grid and cards.
export const LAYOUT = `
/* layout: one column, then input | result on wide screens */
.site-header-inner, .site-footer-inner, main { max-width: 1120px; margin: 0 auto; padding-left: var(--space-4); padding-right: var(--space-4); }
main { min-height: 60vh; padding-top: var(--space-6); padding-bottom: var(--space-6); }
/* Home's full-bleed sections need main itself unconstrained; each section's .bleed-inner re-applies the
   normal content width and padding, so it looks identical to every other page from the reader's side. */
main.main-full-bleed { max-width: none; padding-left: 0; padding-right: 0; padding-top: 0; padding-bottom: 0; }
.page-heading { margin-bottom: var(--space-5); }
.page-heading h1:focus { outline: none; }
.page-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-4); }
.form-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.outcome { padding-top: var(--space-5); border-top: 1px solid var(--border); }
@media (min-width: 900px) {
  .site-header-inner, .site-footer-inner, main { padding-left: var(--space-5); padding-right: var(--space-5); }
  .page-grid { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); }
  .card { padding: var(--space-5); }
  .wide { grid-column: 1 / -1; }
  .form-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .outcome { padding-top: 0; border-top: 0; }
}
`;
