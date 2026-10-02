# Security dashboard: analyse the stored scans on one page

Date: 2026-10-01. Status: awaiting review.

## Goal

One page, `/dashboard`, that answers "what is being attacked, how, from where, and is the detector keeping up?" from
the stored scan history (see `2026-10-01-scan-history-design.md`), refreshing itself while it is open.

Success, checked by hand on one machine:

1. With the dummy blog and the Scanner used for a few minutes, the dashboard shows non-zero tiles, a timeline with
   blocked and allowed columns, the rules that fired, and the attacks in "recent critical".
2. Changing the range (Last hour, Last 24 hours, Last 7 days, All) changes every panel.
3. A new scan appears on the open page within about 5 seconds, with no click.
4. With storing off (public bind), the page says so and shows no charts. With no scans in the range, it says that.
5. An input containing `<script>` shown in "recent critical" is displayed as text and runs nothing.

Audience: an evaluator or the author analysing a demo run on one machine.

## Non-goals

Alerts or notifications, exporting charts, per-user views, IP or location analysis (IPs are not stored), a live
"recall" or accuracy number (live traffic has no labels), changes to the stored data or its 10,000-row cap, and the
FastAPI backend in `backend/`. No change to detector rules or scoring.

## What the page shows

A range selector (Last hour, Last 24 hours, Last 7 days, All; default 24 hours), then, top to bottom:

1. **Tiles.** Total scans, blocked, allowed, block rate (blocked / total, shown as a percentage), critical scans, and
   **ML escalations**: scans that were blocked although their rule score was below the block threshold (25), i.e.
   the ML second opinion made the difference.
2. **Threats over time.** Stacked columns, blocked and allowed per bucket (UTC). Buckets: 5 minutes for the last hour,
   1 hour for 24 hours, 1 day for 7 days, 1 day for All (the most recent 60 days at most). Every bucket in the range is
   shown, with zero where nothing happened.
3. **Attack types and rules.** Top 10 rules with their names; a part-to-whole bar of scans per rule category
   (markup, javascript, uri, css, template, evasion); a part-to-whole bar of the risk-level mix (safe to critical).
4. **Sources and fields.** Two bar charts, top 8 each, showing scans and blocked scans per `source` and per `field`.
   An empty source is labelled `(none)`.
5. **Score distribution.** Scans per score band: 0-9, 10-19, ... 80-89, 90-100.
6. **Recent critical attacks.** The last 5 critical scans: time (UTC), source, field, score, rules, and the input cut
   to 120 characters, shown as plain text.
7. **Detector quality.** The benchmark's recall, precision, false-positive rate and hard negatives for the shipped
   detector (from the existing `GET /api/benchmark`), beside the live block rate, with the note: `Live traffic has no
   labels, so a block rate is not accuracy. Recall and precision come from the benchmark.` If the benchmark is
   missing, this panel says it is not available and the rest of the page is unaffected.

States: loading; error with the last data kept and a Retry button; **off** (`Saving scans is off on this server. It is
on by default only for local runs; set STORE_SCANS=1 to turn it on.`); **empty** for the range (`No scans in this range
yet. Try the Scanner.`). Every chart has a "View as table" alternative (the existing `ChartCard` does this).
"All" covers at most the 10,000 stored rows; a footnote says so.

## Data and refresh

The page loads when opened, on every range change, and then every **5 seconds**. Polling pauses while the browser tab
is hidden and resumes with an immediate load when it is visible again (the pattern in `useEvents`). A failed load
keeps the last data and shows the error note.

## API (built-in server only)

`GET /api/analytics?range=1h|24h|7d|all` (default `24h`; any other value is 400 `{"error": ...}`). Rate-limit cost
**0.5**. When storing is off: `{"enabled": false}`. Otherwise:

```
{ "enabled": true, "range": "24h", "generated": "<UTC ISO>", "bucket": "hour",
  "totals": {"scans": n, "blocked": n, "allowed": n, "block_rate": 0..1, "critical": n, "ml_escalations": n},
  "timeline": [{"t": "<UTC ISO bucket start>", "blocked": n, "allowed": n}, ...],
  "levels": {"safe": n, "low": n, "medium": n, "high": n, "critical": n},
  "rules": [{"rule_id": "XSS002", "name": "...", "category": "markup", "count": n}, ...],   // top 10
  "categories": [{"category": "markup", "count": n}, ...],
  "sources": [{"source": "blog", "scans": n, "blocked": n}, ...],                          // top 8
  "fields":  [{"field": "comment", "scans": n, "blocked": n}, ...],                        // top 8
  "scores": [{"label": "0-9", "count": n}, ... {"label": "90-100", "count": n}],
  "recent_critical": [{"ts": "...", "source": "", "field": "comment", "score": 100, "rules": [...], "text": "..."}] }
```

Definitions: a rule's `count` is the number of scans in which it fired (once per scan). A category's `count` is the
number of scans in which at least one rule of that category fired. Rule names and categories come from the server's rule
catalog; an id the catalog does not know is shown with its id as the name and category `other`. `levels` always has all
five keys. `rules`, `categories`, `sources` and `fields` are sorted by count (descending), ties by name. The block
threshold used for `ml_escalations` is the running detector's `block_threshold`. The timeline's `bucket` is `"5min"`,
`"hour"` or `"day"`.

`/dashboard` is added to `PAGES` so the app shell is served for it.

## Components and files

| File | Change |
|---|---|
| `xss_detector/analytics.py` (new) | `summarize(rows, *, range_key, now, rules, block_threshold) -> dict`: a pure function that builds the response above from stored rows. No I/O. |
| `xss_detector/store.py` | `ScanStore.rows_since(since: datetime \| None) -> list[dict]`: stored rows (same row shape as `export_rows`) at or after `since`, newest first; `None` means all. |
| `xss_detector/server.py` | `GET /api/analytics`, the `0.5` cost, `/dashboard` in `PAGES` |
| `frontend/src/lib/useAnalytics.js` (new) | `useAnalytics({ range })`: loads and polls every 5 s, pauses when hidden |
| `frontend/src/charts/StackedColumns.jsx` (new) | Stacked columns for the timeline, built like the existing charts (`frame.js`, `scale.js`, tooltip, colour slots, table alternative) |
| `frontend/src/pages/Dashboard.jsx` (new) | The page. Reuses `StatTile`, `ChartCard`, `BarChart`, `StackedBar`, `GroupedBars`, and the benchmark data from `useApi("/benchmark")` |
| `frontend/src/routes.js`, `data/apiDocs.js`, `styles/*` | route `/dashboard` (nav "Dashboard", after History, left out of the `backendPages` build), API docs entry (built-in only), small style additions |
| `README.md` | document the page and the endpoint |

## Testing

- `tests/test_analytics.py`: fixed rows and a fixed `now` for each range: bucket count and boundaries (12, 24, 7, and up
  to 60), zero-filled buckets, rows exactly on a boundary, rows outside the range ignored; totals, block rate (and 0
  when there are no scans, not a division error); ML escalation counted only when blocked and score below the
  threshold; rule and category counting rules; unknown rule id; `(none)` source; sort order and top-N cut-offs; all
  five levels present; score band edges (0, 9, 10, 89, 90, 100); `recent_critical` limited to 5, newest first, text cut
  to 120.
- `tests/test_store.py` addition: `rows_since` with a cut-off and with `None`.
- `tests/test_history_api.py` or a new `tests/test_analytics_api.py`: the route with seeded scans for each range, default
  range, bad range is 400, off shape `{"enabled": false}`, cost 0.5, `/dashboard` serves the shell.
- Frontend: `useAnalytics` (loads, polls, pauses when hidden, keeps data on error); `StackedColumns` (bars, labels,
  table); `Dashboard` states (loading, error, off, empty, populated), range change refetches, `<script>` text in recent
  critical is plain text, benchmark missing does not break the page; route and nav; API docs entries.
- All existing suites stay green.

## Risks and decisions

- **Cost of refreshing.** Summarising up to 10,000 rows every 5 seconds is a few milliseconds of Python; the 0.5 rate
  cost leaves room beside the Live page's polling (about 6 and 8 requests a minute against the 60 allowed).
- **Time.** Everything is UTC, and bucket starts are aligned to UTC boundaries, so the timeline does not shift when the
  page is opened from another time zone.
- **Typing collapse** (from the history design) means a typed payload counts as one scan, which keeps the numbers close
  to "payloads tested" rather than keystrokes.
- **Honesty about quality.** Live data has no ground truth, so the dashboard never shows live recall; the benchmark
  panel and its note say where each number comes from.
