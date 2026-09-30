// Page-specific styles: prose pages, API docs.
export const PAGES = `
/* shared page helpers */
.stack { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); }
.prose { max-width: 72ch; }
.prose p { margin: 0 0 var(--space-3); }
.prose ul { margin: 0 0 var(--space-4); padding-left: var(--space-5); }
.prose li { margin: var(--space-1) 0; }
.callout { padding: var(--space-4); background: var(--accent-soft); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: var(--radius); }

.grid-2 { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
@media (min-width: 900px) { .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-bottom: var(--space-3); }
.controls input[type="search"] { flex: 1 1 240px; max-width: 320px; }
.chip-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip-button { min-height: 32px; padding: 0 var(--space-3); color: var(--text); background: var(--surface-2); border-color: var(--border); border-radius: var(--radius-pill); font-size: 13px; font-weight: 500; }
.chip-button:hover:not(:disabled) { background: var(--accent-soft); border-color: var(--accent); box-shadow: none; }
.chip-button[aria-pressed="true"] { color: var(--on-accent); background: var(--accent); border-color: var(--accent); }
.chip-button[aria-pressed="true"]:hover:not(:disabled) { background: var(--accent-hover); }

/* rules table: a readable minimum width, so on a phone it scrolls inside its wrapper instead of collapsing */
.live-table { min-width: 720px; }
.live-table td { vertical-align: top; }
.live-text { max-width: 360px; word-break: break-all; }
.top-rules ul { padding: 0; margin: var(--space-3) 0 0; list-style: none; }
.rules-group h3 { margin: 0; font-size: inherit; line-height: inherit; }
.group-toggle { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); width: 100%; min-height: 0; padding: 0; color: inherit; background: transparent; border: 0; font: inherit; font-weight: 600; text-align: left; }
.group-toggle:hover:not(:disabled) { color: var(--text); background: transparent; box-shadow: none; }
.group-toggle:active:not(:disabled) { background: transparent; transform: none; }
.group-toggle::before { content: "\\25B8"; color: var(--muted); }
.group-toggle[aria-expanded="true"]::before { content: "\\25BE"; }
.rules-group .table-wrap { margin-top: var(--space-3); }
.rules-table { min-width: 720px; }
.rules-table th, .rules-table td:first-child code { white-space: nowrap; word-break: normal; }
.th-sort { min-height: 0; padding: 0; color: inherit; background: transparent; border: 0; font: inherit; letter-spacing: inherit; text-transform: inherit; }
.th-sort:hover:not(:disabled) { color: var(--text); background: transparent; box-shadow: none; }
.th-sort:active:not(:disabled) { background: transparent; transform: none; }
th[aria-sort="ascending"] .th-sort::after { content: " ↑"; }
th[aria-sort="descending"] .th-sort::after { content: " ↓"; }
.cat { display: inline-flex; align-items: center; gap: var(--space-2); white-space: nowrap; }
.cat-dot { flex: none; width: 8px; height: 8px; background: var(--muted); border-radius: var(--radius-pill); }
.weight-cell { display: flex; align-items: center; gap: var(--space-2); min-width: 120px; }
.weight-cell .wbar { flex: 1; margin: 0; }
.tag { margin-left: var(--space-2); }

/* home: full-bleed alternating sections. main.main-full-bleed (layout.js) removes main's own max-width and
   padding on this route, so .bleed's background can span edge to edge; .bleed-inner re-applies the site's
   normal content width and side padding inside it, so the content lines up exactly like every other page. */
.bleed { width: 100%; }
.bleed-inner { max-width: 1120px; margin: 0 auto; padding: 0 var(--space-4); }
@media (min-width: 900px) { .bleed-inner { padding: 0 var(--space-5); } }
.hero-block, .cta-block { background: var(--hero-gradient); color: #ffffff; }
.hero-block { padding: var(--space-7) 0; }
.hero-block .bleed-inner { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-6); align-items: center; }
@media (min-width: 900px) { .hero-block .bleed-inner { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-7); } }
.hero-title { margin: 0; font-size: 40px; line-height: 1.05; font-weight: 800; letter-spacing: -.04em; text-wrap: balance; color: #ffffff; }
@media (min-width: 720px) { .hero-title { font-size: 68px; line-height: 1.02; } }
.hero-title:focus { outline: none; }
.hero-block .lede, .cta-block .lede { margin: var(--space-3) 0 var(--space-5); font-size: 20px; line-height: 1.5; color: rgba(255, 255, 255, .88); }
.hero-block .row { margin-top: 0; }
.stats-block, .code-block-section { padding: var(--space-7) 0; }
.features-block { padding: var(--space-7) 0; background: var(--surface-2); }
.section-title { margin: 0 0 var(--space-5); font-size: 32px; line-height: 1.15; font-weight: 800; letter-spacing: -.02em; }
.button-link { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 var(--space-5); color: var(--on-accent); background: var(--accent); border: 1px solid transparent; border-radius: var(--radius-lg); font-size: 16px; font-weight: 700; text-decoration: none; transition: background-color var(--t-fast), border-color var(--t-fast), transform var(--t-fast); }
.button-link:hover { color: var(--on-accent); background: var(--accent-hover); }
.button-link:active { background: var(--accent-active); transform: translateY(1px); }
.button-link.secondary { color: var(--text); background: transparent; border-color: var(--border-strong); }
.button-link.secondary:hover { color: var(--text); background: var(--surface-2); border-color: var(--muted); }
.hero-block .button-link, .cta-block .button-link { color: var(--accent); background: #ffffff; }
.hero-block .button-link:hover, .cta-block .button-link:hover { background: #f0f4ff; }
.hero-block .button-link.secondary, .cta-block .button-link.secondary { color: #ffffff; background: transparent; border-color: rgba(255, 255, 255, .4); }
.hero-block .button-link.secondary:hover, .cta-block .button-link.secondary:hover { color: #ffffff; background: rgba(255, 255, 255, .12); border-color: rgba(255, 255, 255, .6); }
.demo { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); background: var(--surface); color: var(--text); border-radius: var(--radius-lg); padding: var(--space-5); box-shadow: 0 24px 60px rgba(0, 0, 0, .25); }
.demo-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.demo-input { min-height: 80px; padding: var(--space-3); background: var(--input-bg); border: 1px solid var(--border-strong); border-radius: var(--radius); font: 13px/20px var(--mono); overflow-wrap: anywhere; }
.demo-input code { padding: 0; background: transparent; word-break: normal; }
.caret { display: inline-block; width: 2px; height: 16px; margin-left: var(--space-1); vertical-align: text-bottom; background: var(--accent); animation: blink 1s steps(2, start) infinite; }
@keyframes blink { to { visibility: hidden; } }
.demo-result { min-height: 88px; }
.demo-result p { margin: var(--space-2) 0 0; }
.demo-verdict { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.stat-skeleton { display: grid; gap: var(--space-2); padding: var(--space-4); }
.stat-accent { display: block; width: 32px; height: 4px; margin-bottom: var(--space-3); border-radius: var(--radius-pill); }
.feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-4); margin: 0; padding: 0; list-style: none; }
.feature h3 { margin: var(--space-3) 0 var(--space-2); font-size: 17px; }
.feature p { margin: 0; }
.feature-icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; color: var(--accent); background: var(--bg); border-radius: var(--radius); margin-bottom: var(--space-2); }
.cta-block { padding: var(--space-7) 0; text-align: center; }
.cta-block .bleed-inner { max-width: 640px; }
.cta-block .row { margin-top: var(--space-5); justify-content: center; }
.cta-block .section-title { color: #ffffff; }
.reveal { opacity: 0; transform: translateY(16px); transition: opacity var(--t-base), transform var(--t-base); }
.reveal.is-visible { opacity: 1; transform: none; }

/* how it works */
.steps { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2); margin-bottom: var(--space-3); }
@media (min-width: 720px) { .steps { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); } }
.step { justify-content: flex-start; gap: var(--space-3); min-height: 64px; padding: var(--space-3) var(--space-4); color: var(--text); text-align: left; background: var(--surface); border-color: var(--border); }
.step:hover:not(:disabled) { background: var(--surface-2); border-color: var(--border-strong); box-shadow: none; }
.step[aria-selected="true"] { background: var(--accent-soft); border-color: var(--accent); }
.step-num { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 28px; height: 28px; color: var(--on-accent); background: var(--accent); border-radius: var(--radius-pill); font-size: 13px; font-weight: 700; }
.step-text { display: grid; gap: 0; }
.step-text span { color: var(--muted); font-size: 13px; font-weight: 400; }
.step-panel > p:first-child, .step-panel > div > p:first-child { margin-top: 0; }
.compare { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
@media (min-width: 720px) { .compare { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.compare h4 { margin-top: 0; }
.verdict-line { margin: var(--space-2) 0 0; text-align: center; }

/* scanner extras */
.result-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--border); }
.result-actions .muted { flex-basis: 100%; margin: 0; }
.breakdown { margin-top: var(--space-4); }
.breakdown h3 { margin-top: 0; }
.breakdown .muted { margin: var(--space-2) 0 0; }
.history-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-2); }
.history-head h3 { margin: 0; }
.history-list { margin: 0 0 var(--space-3); padding: 0; list-style: none; }
.history-list li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); padding: var(--space-2) 0; }
.history-list li + li { border-top: 1px solid var(--border); }
.history-list code { flex: 1 1 160px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* benchmarks */
.outcome-table { min-width: 720px; }
.outcome-table th { white-space: nowrap; }
.outcome-table th[scope="row"] { font-weight: 600; text-align: left; text-transform: none; letter-spacing: 0; color: var(--text); background: transparent; }
.bar-cell { display: flex; align-items: center; gap: var(--space-2); min-width: 96px; }
.bar-cell span { min-width: 40px; }
.bar-cell .wbar { flex: 1; margin: 0; }
details.card summary { cursor: pointer; font-weight: 600; }
details.card[open] summary { margin-bottom: var(--space-2); }
.examples { margin: 0 0 var(--space-3); padding-left: var(--space-5); }
.examples li { margin: var(--space-1) 0; }

/* API docs */
.endpoint-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-2); }
.endpoint-head code { font-size: 14px; background: transparent; }
.method { display: inline-block; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); font: 700 12px/16px var(--mono); letter-spacing: .04em; }
.method-get { color: var(--ok-text); background: var(--ok-soft); }
.method-post { color: var(--accent); background: var(--accent-soft); }
.code-block { margin: var(--space-3) 0; overflow: hidden; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); }
.code-head { display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border); }
.code-block pre { margin: 0; overflow-x: auto; background: transparent; border: 0; border-radius: 0; }
.tryit textarea { min-height: 120px; }
.tryit-result { margin-top: var(--space-3); }
.tryit .error-box { margin-top: var(--space-3); }
`;
