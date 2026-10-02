// Reset, page defaults and typography.
export const BASE = `
/* base */
* { box-sizing: border-box; }
html { overflow-x: clip; scroll-padding-top: 80px; }
body { margin: 0; overflow-x: clip; background: var(--bg); color: var(--text); font: 15px/24px var(--font); -webkit-font-smoothing: antialiased; }
::selection { background: var(--accent); color: var(--on-accent); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* typography */
h1 { margin: 0; font-size: 30px; line-height: 36px; font-weight: 800; letter-spacing: -.03em; }
@media (min-width: 720px) { h1 { font-size: 38px; line-height: 44px; } }
h2 { margin: 0 0 var(--space-4); font-size: 20px; line-height: 26px; font-weight: 700; letter-spacing: -.015em; }
h3 { margin: var(--space-5) 0 var(--space-2); font-size: 14px; line-height: 20px; font-weight: 600; }
h3 small { font-weight: 400; color: var(--muted); font-size: 13px; }
h4 { margin: var(--space-4) 0 var(--space-1); font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.lede { margin: var(--space-2) 0 0; max-width: 72ch; color: var(--muted); }
a { color: var(--accent); text-underline-offset: 2px; transition: color var(--t-fast); }
a:hover { color: var(--accent-hover); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-sm); }
.hint, .muted { color: var(--muted); font-size: 13px; line-height: 20px; }
.hint { margin: 0 0 var(--space-4); }
.card > h2 + .hint { margin-top: calc(var(--space-2) * -1); }
`;
