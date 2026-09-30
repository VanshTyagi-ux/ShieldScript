// Controls, buttons, result views, findings, tables, and reduced motion (must stay last).
export const COMPONENTS = `
/* form controls */
label { display: block; margin: var(--space-4) 0 var(--space-1); font-size: 13px; line-height: 20px; font-weight: 600; }
h2 + label { margin-top: 0; }
label .chip { margin-left: var(--space-2); text-transform: capitalize; }
input, textarea {
  width: 100%; min-height: 40px; padding: var(--space-2) var(--space-3);
  background: var(--input-bg); color: var(--text); border: 1px solid var(--border-strong); border-radius: var(--radius);
  font: inherit; transition: border-color var(--t-fast), box-shadow var(--t-fast), background-color var(--t-fast);
}
textarea { font-family: var(--mono); font-size: 13px; line-height: 20px; resize: vertical; }
input::placeholder, textarea::placeholder { color: var(--placeholder); opacity: 1; }
input:hover, textarea:hover { border-color: var(--muted); }
input:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; border-color: var(--accent); }
input:disabled, textarea:disabled { background: var(--surface-2); color: var(--muted); border-color: var(--border); cursor: not-allowed; }
input[aria-invalid="true"], textarea[aria-invalid="true"] { border-color: var(--critical); }
.err { margin-top: var(--space-1); color: var(--danger-text); font-size: 13px; line-height: 20px; }
.err:empty { display: none; }

/* buttons */
button {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
  min-height: 40px; padding: 0 var(--space-4);
  background: var(--accent); color: var(--on-accent); border: 1px solid transparent; border-radius: var(--radius);
  font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  transition: background-color var(--t-fast), border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast), color var(--t-fast);
}
button:hover:not(:disabled) { background: var(--accent-hover); box-shadow: var(--shadow-sm); }
button:active:not(:disabled) { background: var(--accent-active); box-shadow: none; transform: translateY(1px); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button:disabled { opacity: .5; cursor: not-allowed; }
button.ghost { min-height: 32px; padding: 0 var(--space-3); background: transparent; color: var(--text); border-color: var(--border-strong); font-size: 13px; }
button.ghost:hover:not(:disabled) { background: var(--surface-2); border-color: var(--muted); box-shadow: none; }
button.ghost:active:not(:disabled) { background: var(--border); }
button.sample { min-height: 28px; padding: 0 var(--space-3); background: var(--surface-2); color: var(--text); border-color: var(--border); font-size: 12px; font-weight: 500; }
button.sample:hover:not(:disabled) { background: var(--accent-soft); border-color: var(--accent); box-shadow: none; }
button.sample:active:not(:disabled) { background: var(--accent-soft); border-color: var(--accent-active); }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin-top: var(--space-3); }
.samples { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-4); }
.row .samples { flex-direction: row; flex-wrap: wrap; margin: 0; }
.sample-group { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.group-label { min-width: 64px; color: var(--muted); font-size: 12px; font-weight: 600; }

/* result states */
.empty { margin: 0; padding: var(--space-7) var(--space-4); text-align: center; color: var(--muted); background: var(--surface-2); border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); }
.error-box { padding: var(--space-3) var(--space-4); color: var(--danger-text); background: var(--danger-soft); border: 1px solid var(--danger-border); border-radius: var(--radius); font-size: 14px; line-height: 20px; }
.skeleton-block { display: grid; gap: var(--space-3); }
.skeleton { display: block; height: 16px; border-radius: var(--radius); background: linear-gradient(90deg, var(--surface-2) 25%, var(--border) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
.skeleton.tall { height: 48px; }
.skeleton.mid { width: 70%; }
.skeleton.short { width: 40%; }
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
#scan-result { transition: opacity var(--t-base); }
#scan-result[aria-busy="true"] { opacity: .6; }

/* verdict, meter, chips */
.verdict { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); padding: var(--space-3) var(--space-4); background: var(--surface-2); border: 1px solid var(--border); border-left-width: 4px; border-radius: var(--radius); }
.border-safe { border-left-color: var(--safe); } .border-low { border-left-color: var(--low); }
.border-medium { border-left-color: var(--medium); } .border-high { border-left-color: var(--high); }
.border-critical { border-left-color: var(--critical); }
.score { margin-left: auto; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
@media (max-width: 480px) { .score { margin-left: 0; flex-basis: 100%; } }
.badge { padding: var(--space-1) var(--space-3); color: #fff; border-radius: var(--radius-pill); font-size: 12px; line-height: 16px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }
.chip { display: inline-flex; align-items: center; padding: var(--space-1) var(--space-2); background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius-pill); font-size: 12px; line-height: 16px; font-weight: 600; }
.chip.ok { color: var(--ok-text); background: var(--ok-soft); border-color: transparent; }
.chip.bad { color: var(--danger-text); background: var(--danger-soft); border-color: transparent; }
/* level colours come last so they win over the generic .chip look; amber carries dark text */
.level-safe { background: var(--safe); } .level-low { background: var(--low); }
.level-medium { background: var(--medium); } .level-high { background: var(--high); }
.level-critical { background: var(--critical); }
.chip[class*="level-"] { color: #fff; border-color: transparent; }
.badge.level-medium, .chip.level-medium { color: var(--on-medium); }

/* findings and decoded view */
.findings ul { list-style: none; margin: 0; padding: 0; }
.finding { padding: var(--space-3); border-radius: var(--radius); transition: background-color var(--t-fast); }
.finding + .finding { border-top: 1px solid var(--border); border-top-left-radius: 0; border-top-right-radius: 0; }
.finding:hover, .finding:focus-visible { background: var(--surface-2); }
.finding:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.finding-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-2); }
.finding .rule { font: 12px/16px var(--mono); color: var(--muted); }
.finding .w { margin-left: auto; color: var(--danger-text); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.finding code { display: inline-block; margin-top: var(--space-2); }
.wbar { height: 4px; margin: var(--space-2) 0; overflow: hidden; background: var(--surface-2); border-radius: var(--radius-pill); }
.wbar div { height: 100%; background: var(--critical); }
code, pre { background: var(--surface-2); border-radius: var(--radius-sm); font: 12.5px/20px var(--mono); }
code { padding: 0 var(--space-1); word-break: break-all; }
pre { margin: var(--space-2) 0 0; padding: var(--space-3) var(--space-4); overflow-x: auto; white-space: pre-wrap; word-break: break-all; border: 1px solid var(--border); border-radius: var(--radius); }
mark.hit { background: var(--hit); color: inherit; border-bottom: 2px solid var(--medium); border-radius: var(--radius-sm); transition: background-color var(--t-fast); }
mark.hit.on { background: var(--hit-on); border-bottom-color: var(--critical); }

/* protected form outcome */
#submit-status { display: inline-flex; align-items: center; padding: var(--space-1) var(--space-3); border-radius: var(--radius-pill); font-size: 13px; font-weight: 600; }
#submit-status.ok { color: var(--ok-text); background: var(--ok-soft); }
#submit-status.bad { color: var(--danger-text); background: var(--danger-soft); }
#submit-body { margin-top: var(--space-3); }
#submit-body p { margin: 0; }
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
table { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 20px; }
th, td { padding: var(--space-2) var(--space-3); text-align: left; vertical-align: top; overflow-wrap: break-word; }
th { color: var(--muted); background: var(--surface-2); font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
tr + tr td { border-top: 1px solid var(--border); }
.errors { margin: 0; padding-left: var(--space-5); }
.errors li { margin: var(--space-1) 0; }
`;
