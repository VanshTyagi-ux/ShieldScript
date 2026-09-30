// Chart styles: the card frame, legend, tooltip, mark colours and SVG text/lines. Marks are coloured by
// class (fill-s1, stroke-t-critical, bg-s2, ...) because the CSP forbids style= attributes.
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const LEVELS = ["safe", "low", "medium", "high", "critical"];

const tones = [
  ...range(6).map((n) => [`s${n}`, `var(--series-${n})`]),
  ...LEVELS.map((level) => [`t-${level}`, `var(--${level})`]),
];
const toneRules = tones
  .map(([name, colour]) => `.fill-${name} { fill: ${colour}; }\n.stroke-${name} { stroke: ${colour}; }\n.bg-${name} { background: ${colour}; }\n.color-${name} { color: ${colour}; }`)
  .join("\n");

export const CHARTS = `
/* chart frame */
.chart-card { margin: 0; }
.chart-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--space-2) var(--space-4); margin-bottom: var(--space-3); }
.chart-head h3 { margin: 0; font-size: 16px; line-height: 24px; }
.chart-head p { margin: 0; }
.chart-body { position: relative; }
.chart-foot { margin: var(--space-3) 0 0; }
.legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin: 0 0 var(--space-3); padding: 0; list-style: none; color: var(--muted); font-size: 13px; }
.legend li { display: inline-flex; align-items: center; gap: var(--space-2); }
.legend-key { flex: none; width: 12px; height: 12px; background: var(--muted); border-radius: var(--radius-sm); }
.chart-wrap { position: relative; }
.chart-wrap svg { display: block; width: 100%; height: auto; overflow: visible; }
.chart-scroll { overflow-x: auto; }
/* on a phone, scroll the chart sideways rather than shrink its 12px text to ~6px */
@media (max-width: 719px) { .chart-scroll svg { min-width: 520px; } }
thead + tbody td { border-top: 1px solid var(--border); }

/* tooltip */
.chart-tip { position: absolute; z-index: 5; min-width: 120px; margin-top: calc(var(--space-2) * -1); padding: var(--space-2) var(--space-3); color: var(--text); background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius); box-shadow: var(--shadow-md); font-size: 12px; line-height: 16px; white-space: nowrap; pointer-events: none; transform: translate(-50%, -100%); }
.tip-title { display: block; margin-bottom: var(--space-1); color: var(--muted); }
.tip-row { display: flex; align-items: center; gap: var(--space-2); }
.tip-row strong { font-size: 13px; }
.tip-key { flex: none; width: 12px; height: 4px; border-radius: var(--radius-pill); }

/* mark colours (a mark with no slot or level stays neutral) */
.mark { fill: var(--muted); }
${toneRules}

/* svg text, lines and interaction */
.axis-text { fill: var(--muted); font: 12px var(--font); }
.value-text { fill: var(--text); font: 600 12px var(--font); }
.grid-line { stroke: var(--border); stroke-width: 1; }
.axis-line { stroke: var(--border-strong); stroke-width: 1; }
.ring { stroke: var(--surface); stroke-width: 2; }
.mark { transition: opacity var(--t-fast); }
.mark-group { cursor: default; outline: none; }
.mark-group:hover .mark, .mark-group:focus-visible .mark { opacity: .8; }
.hit { fill: transparent; }
.mark-group:focus-visible .hit { stroke: var(--accent); stroke-width: 2; }

/* sparkline / area (a tone class, if present, overrides the default accent colour) */
.spark-line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
${range(6).map((n) => `.spark-line.stroke-s${n} { stroke: var(--series-${n}); }`).join("\n")}
.spark-area { stroke: none; opacity: .16; }
.spark-end { fill: var(--accent); }
${range(6).map((n) => `.spark-end.fill-s${n} { fill: var(--series-${n}); }`).join("\n")}
.chart-scroll > svg[tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: var(--radius); }

/* gauge */
.gauge { display: block; width: 100%; max-width: 320px; margin: 0 auto; }
.gauge-band { fill: none; stroke: var(--surface-2); stroke-width: 14; }
.gauge-fill { fill: none; stroke-width: 14; stroke-linecap: round; }
.gauge-score { fill: var(--text); font: 700 48px var(--font); }

/* stat tiles */
.stat-tile { padding: var(--space-4); }
.stat-label { color: var(--muted); font-size: 13px; line-height: 20px; }
.stat-value { margin-top: var(--space-1); font-size: 28px; line-height: 32px; font-weight: 700; letter-spacing: -.02em; }
.stat-note { margin-top: var(--space-1); }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--space-4); }
`;
