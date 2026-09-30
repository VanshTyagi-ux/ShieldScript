// The payload browser and the sanitizer playground, plus the select control and the API base line they use.
export const TOOLS = `
/* api base + hint */
.api-base { margin: 0 0 var(--space-4); color: var(--muted); font-size: 14px; }
.api-hint { margin-top: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); font-size: 14px; line-height: 20px; }
.api-hint p { margin: 0; }
.api-hint p + p { margin-top: var(--space-2); }

/* select */
select { max-width: 100%; min-height: 40px; padding: var(--space-2) var(--space-3); background: var(--input-bg); color: var(--text); border: 1px solid var(--border-strong); border-radius: var(--radius); font: inherit; transition: border-color var(--t-fast), box-shadow var(--t-fast), background-color var(--t-fast); }
select:hover { border-color: var(--muted); }
select:focus-visible { outline: 2px solid var(--accent); outline-offset: 0; border-color: var(--accent); }
select:disabled { background: var(--surface-2); color: var(--muted); border-color: var(--border); cursor: not-allowed; }

/* payload browser */
.payload-filters { align-items: center; }.payload-filters label { display: inline-block; margin: 0; color: var(--muted); font-weight: 500; }
.payload-table { min-width: 760px; }
.payload-table td { vertical-align: top; }
.payload-table th, .payload-table td:first-child code { white-space: nowrap; word-break: normal; }
.payload-table tr.open > td { background: var(--surface-2); }
.source-cell { font-size: 13px; overflow-wrap: anywhere; }
.payload-code, .payload-full, .payload-full code { unicode-bidi: bidi-override; direction: ltr; }
.payload-code { display: block; max-width: 100%; padding: 0; background: transparent; white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; }
.payload-detail > td { padding: 0; }
.payload-details { padding: var(--space-3) var(--space-4) var(--space-4); }
.payload-full { max-height: 320px; margin: 0; overflow: auto; }
.payload-full code { padding: 0; background: transparent; }
/* A scrolling table wrapper must also be the containing block of what is absolutely positioned inside it (the
   .sr-only header cells and caption). Otherwise those escape its clipping and sit out in the scrolled-off part of
   the table, which stretches the whole page sideways on a phone. */
.table-wrap { position: relative; }
.dimmed { opacity: .55; transition: opacity var(--t-base); }
.pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--space-2); }
.pager button { min-height: 32px; }

/* sanitizer playground */
.section-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.section-head h3 { margin: 0; }
.count-note { color: var(--muted); font-size: 13px; }
.count-note.over { color: var(--danger-text); font-weight: 600; }
#sanitized-output { max-height: 240px; overflow: auto; }
.html-preview { display: block; width: 100%; height: 200px; min-height: 96px; margin-top: var(--space-2); background: #ffffff; border: 1px solid var(--border-strong); border-radius: var(--radius); resize: vertical; overflow: auto; }
.sanitize-report { display: flex; flex-direction: column; gap: var(--space-3); }
.report-summary { margin: 0; padding: var(--space-2) var(--space-3); border-left: 4px solid var(--medium); border-radius: var(--radius); background: var(--surface-2); font-size: 14px; line-height: 20px; }
.report-summary.ok { color: var(--ok-text); background: var(--ok-soft); border-left-color: var(--safe); }
.report-table { min-width: 480px; }
.detector-alert { display: flex; flex-direction: column; gap: var(--space-2); }
.detector-alert p { margin: 0; }
.rule-ids { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
`;
