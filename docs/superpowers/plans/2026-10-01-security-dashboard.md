# Security Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/dashboard` page that analyses the stored scan history (threats over time, rules, categories, sources, fields, scores, recent critical attacks, detector quality) and refreshes itself every 5 seconds.

**Architecture:** A pure function `xss_detector/analytics.py: summarize(...)` turns stored rows into one JSON summary; `GET /api/analytics?range=1h|24h|7d|all` serves it from `ScanStore.rows_since`. The React page polls it through a `useAnalytics` hook and draws it with the existing chart components plus one new `StackedColumns` chart. Benchmark numbers come from the existing `/api/benchmark`.

**Tech Stack:** Python 3.10+ standard library only; React 19 + Vitest (existing); `unittest` (existing).

**Spec:** `docs/superpowers/specs/2026-10-01-security-dashboard-design.md` (it builds on the scan history in `2026-10-01-scan-history-design.md`, already implemented: `xss_detector/store.py`, `/api/history`, `/history`)

## Global Constraints

- Python standard library only. No new Python or npm dependency.
- Ranges and buckets (verbatim): `1h` -> 12 buckets of 5 minutes (`"5min"`); `24h` -> 24 buckets of 1 hour (`"hour"`); `7d` -> 7 buckets of 1 day (`"day"`); `all` -> daily buckets from the oldest stored row's day to today, at most the 60 most recent days (`"day"`). All times UTC, bucket starts aligned to UTC boundaries, the last bucket is the one containing `now`, every bucket present (zeros where empty). Default range `24h`; any other value is 400.
- Top-N: rules 10, sources 8, fields 8; `recent_critical` 5, its `text` cut to 120 characters. Score bands: `0-9`, `10-19`, ... `80-89`, `90-100` (ten bands, `100` is in the last). `levels` always has `safe, low, medium, high, critical`.
- `GET /api/analytics` rate-limit cost **0.5**; storing off -> `{"enabled": false}`. `/dashboard` is in `PAGES`.
- Refresh every **5000 ms**; pause while the tab is hidden and load again at once when visible; a failed load keeps the last data.
- Page texts (verbatim): off `Saving scans is off on this server. It is on by default only for local runs; set STORE_SCANS=1 to turn it on.`; empty `No scans in this range yet. Try the Scanner.`; quality note `Live traffic has no labels, so a block rate is not accuracy. Recall and precision come from the benchmark.`; All footnote `All covers at most the 10,000 most recent stored scans.`
- Nav label `Dashboard`, placed after `History`, absent from the `backendPages` build. Stored text is untrusted: rendered as text only.
- Charts: **before writing `StackedColumns`, load the `dataviz` skill** and follow it. Use the existing colour tokens and slots (`toneClass`, `lib/categories.js`), `ChartCard` with a table alternative, and `--space-*` tokens in styles (the style tests enforce the spacing grid).
- The working tree has unrelated uncommitted changes and the user has asked for commits only on request. **Commit steps: skip unless the user has told you to commit, and then `git add` only the files named in the step.** Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tests never write to the real `scans.db` (`tests/__init__.py` redirects it); keep it that way.

## Review Focus

1. Rows exactly on a bucket boundary, at `now`, and one millisecond before the window start: each lands in exactly one bucket or is ignored; range start is inclusive (Task 2).
2. No scans at all, and storing off: `block_rate` is 0 (never NaN or a division error) and the page shows the empty or off message, not blank charts (Tasks 2, 6).
3. Rows with an unknown rule id, empty `source` or `field`, or `ml_probability` null must not crash `summarize` (Task 2).
4. Hostile text such as `<script>` in "recent critical" renders as plain text and creates no elements (Task 6).
5. A slow response for the previous range must not overwrite the data of the range now selected; and polling must not stack requests while one is in flight (Task 4).

---

### Task 1: Read rows since a time

**Files:**
- Modify: `xss_detector/store.py`
- Test: `tests/test_store.py`

**Interfaces:**
- Produces: `ScanStore.rows_since(since: datetime | None) -> list[dict]`: stored rows (same row shape as `export_rows`) whose `ts` is at or after `since`, newest first; `None` returns all rows.

- [ ] **Step 1: Write the failing test** `test_rows_since_returns_rows_at_or_after_the_cut_off_newest_first` in `tests/test_store.py` (class `RowTests`): add rows at clock +0, +10, +20 s (non-prefix texts); `rows_since(datetime.fromtimestamp(clock.now_at_second_row, timezone.utc))` returns the second and third rows only, newest first (the cut-off row itself is included); `rows_since(None)` returns all three; a cut-off after the last row returns `[]`.
- [ ] **Step 2: Run** `python -m unittest tests.test_store -v`. Expected: the new test FAILS (`AttributeError: rows_since`).
- [ ] **Step 3: Implement `ScanStore.rows_since`** in `xss_detector/store.py`: `WHERE ts >= ?` with `since.astimezone(timezone.utc).isoformat(timespec="milliseconds")` (stored `ts` strings use the same format, so string comparison is time order); map rows with `_row`.
- [ ] **Step 4: Run** `python -m unittest tests.test_store -v`. Expected: all PASS.
- [ ] **Step 5: Commit** `xss_detector/store.py tests/test_store.py` with message `Add ScanStore.rows_since`.

---

### Task 2: The summary function

**Files:**
- Create: `xss_detector/analytics.py`
- Test: `tests/test_analytics.py`

**Interfaces:**
- Consumes: store row dicts (keys `id, ts, source, field, text, blocked, score, level, rules, ml_probability, decode_layers`); the rule catalog rows from `xss_detector.catalog.rules_payload(...)["rules"]` (each `{"id", "name", "category", ...}`).
- Produces (in `xss_detector/analytics.py`):
  - `RANGES = ("1h", "24h", "7d", "all")`
  - `window_start(range_key: str, now: datetime) -> datetime | None`: the start of the first bucket (`1h`: floor(now, 5 min) minus 11 buckets; `24h`: floor(now, 1 h) minus 23 buckets; `7d`: floor(now, 1 day) minus 6 buckets); `None` for `all`. Raises `ValueError` for an unknown range.
  - `summarize(rows: list[dict], *, range_key: str, now: datetime, rules: list[dict], block_threshold: int) -> dict` returning exactly the response shape in the spec's API section, with `"enabled": True`, `"range"`, `"generated"` (`now` as UTC ISO, seconds precision), `"bucket"`, `totals`, `timeline`, `levels`, `rules`, `categories`, `sources`, `fields`, `scores`, `recent_critical`. Bucket `t` values are UTC ISO strings with seconds precision.

- [ ] **Step 1: Write the failing tests** in `tests/test_analytics.py` (fixed `NOW = datetime(2026, 10, 1, 12, 34, 56, tzinfo=timezone.utc)`; a row builder `row(ts, **over)` with defaults `source="blog", field="comment", text="x", blocked=False, score=0, level="safe", rules=[], ml_probability=None, decode_layers=0`; a small `RULES` list of catalog-shaped dicts for `XSS001` Script tag/markup, `XSS002` Inline event handler (known)/markup, `XSS030` Cookie / storage access/javascript, `XSS099` Encoded / obfuscated payload/evasion):
  - `test_window_start_per_range`: `1h` -> `2026-10-01T11:35:00+00:00`; `24h` -> `2026-09-30T13:00:00+00:00`; `7d` -> `2026-09-25T00:00:00+00:00`; `all` -> `None`; `"2h"` raises `ValueError`.
  - `test_timeline_has_every_bucket_zero_filled_and_the_right_size`: lengths 12, 24, 7 for `1h`, `24h`, `7d`; `bucket` values `"5min"`, `"hour"`, `"day"`; the last bucket's `t` contains `now` (`12:30:00`, `12:00:00`, `2026-10-01T00:00:00`); empty buckets have `blocked == 0` and `allowed == 0`.
  - `test_all_range_spans_from_the_oldest_row_up_to_60_days`: oldest row 3 days ago -> 4 buckets; oldest row 100 days ago -> 60 buckets, and the older row still counts in `totals.scans`.
  - `test_boundaries`: in `1h`, a row at exactly `12:30:00` is counted in the last bucket only; a row at `11:35:00` (window start, inclusive) is counted in the first bucket; a row at `11:34:59.999` is ignored everywhere (totals included); a row after `now` is counted in the last bucket.
  - `test_totals_and_block_rate`: 3 blocked + 1 allowed -> `scans 4, blocked 3, allowed 1, block_rate 0.75`; `critical` counts rows whose `level == "critical"`; no rows -> all zeros and `block_rate == 0`.
  - `test_ml_escalations_are_blocked_scans_below_the_threshold`: with `block_threshold=25`: blocked score 10 counts; blocked score 30 does not; allowed score 10 does not.
  - `test_rule_counts_once_per_scan_and_use_catalog_names`: a row whose `rules` is `["XSS002", "XSS002", "XSS030"]` adds 1 to each; the result has `{"rule_id": "XSS002", "name": "Inline event handler (known)", "category": "markup", "count": n}`; sorted by count desc then name; at most 10.
  - `test_unknown_rule_ids_do_not_crash`: rule `"XSS777"` appears with `name == "XSS777"` and `category == "other"`, and `categories` includes `other`.
  - `test_categories_count_scans_with_at_least_one_rule_in_them`: one scan with two markup rules adds 1 to `markup`; list sorted desc.
  - `test_sources_and_fields_group_sort_and_cut`: empty source shows as `(none)`; `{"source", "scans", "blocked"}` entries sorted by scans desc then name; 9 distinct sources -> 8 returned; same for `fields`.
  - `test_levels_always_has_all_five_keys`: empty input gives `{"safe": 0, "low": 0, "medium": 0, "high": 0, "critical": 0}`; counts land under the right key.
  - `test_score_bands`: scores 0 and 9 -> `0-9`; 10 -> `10-19`; 89 -> `80-89`; 90 and 100 -> `90-100`; always ten bands in order.
  - `test_recent_critical_is_newest_first_limited_and_cut`: 7 critical rows plus non-critical ones -> 5 returned, newest first, only critical; a 300-character text comes back 120 long; each entry has keys `ts, source, field, score, rules, text`.
  - `test_input_order_does_not_matter`: the summary of a shuffled copy of the rows equals the summary of the original.
- [ ] **Step 2: Run** `python -m unittest tests.test_analytics -v`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `RANGES`, `window_start` and `summarize`** in `xss_detector/analytics.py`. One pass over the rows; parse each `ts` with `datetime.fromisoformat`; derive the bucket index from the window start and the bucket length (clamp future rows to the last bucket, drop rows before the window start). For `all` the window is derived from the oldest row (limited to 60 days back from today's bucket) for the timeline only; totals and the other panels use every row passed in.
- [ ] **Step 4: Run** `python -m unittest tests.test_analytics -v`. Expected: all PASS.
- [ ] **Step 5: Commit** `xss_detector/analytics.py tests/test_analytics.py` with message `Add analytics.summarize`.

---

### Task 3: The analytics route

**Files:**
- Modify: `xss_detector/server.py` (`API_COSTS`, `PAGES`, `do_GET`, new `_analytics`)
- Test: `tests/test_analytics_api.py` (new)

**Interfaces:**
- Consumes: `ScanStore.rows_since` (Task 1); `analytics.summarize`, `window_start`, `RANGES` (Task 2); `catalog.rules_payload(threshold)["rules"]`; the running detector's `detector.rules.block_threshold` (the module-level `detector` in `server.py`, as `rules_payload()` there uses it).
- Produces: `GET /api/analytics?range=...` as in Global Constraints; `API_COSTS[("GET", "/api/analytics")] == 0.5`; `"/dashboard"` in `PAGES`.

- [ ] **Step 1: Write the failing tests** in `tests/test_analytics_api.py` (same style as `tests/test_history_api.py`: `ServerTestCase`, `call`, `Config`; seed with `call(base, "/api/scan", {"text": ...})` using non-prefix texts, including the attack `<img src=x onerror=alert(1)>`):
  - `test_analytics_summarises_seeded_scans`: default range; 200; `enabled` True, `range == "24h"`; `set(body)` equals `{"enabled", "range", "generated", "bucket", "totals", "timeline", "levels", "rules", "categories", "sources", "fields", "scores", "recent_critical"}`; `totals.scans` equals the number seeded, `totals.blocked` 1; a rule entry `XSS002` has the catalog name; `recent_critical[0]["text"]` equals the attack.
  - `test_each_range_is_accepted_with_its_bucket`: `1h`, `24h`, `7d`, `all` give 200 and buckets `5min`, `hour`, `day`, `day` and timeline lengths 12, 24, 7 and >= 1.
  - `test_a_bad_range_is_400`: `?range=2h` and `?range=` give 400 with an `"error"` key.
  - `test_analytics_when_storing_is_off`: public bind with default config; 200 and exactly `{"enabled": False}`.
  - `test_the_route_has_the_documented_cost_and_the_page_exists`: `API_COSTS[("GET", "/api/analytics")] == 0.5`; `GET /dashboard` returns 200 with the app shell (`b'<div id="root">'`).
- [ ] **Step 2: Run** `python -m unittest tests.test_analytics_api -v`. Expected: FAIL (404s).
- [ ] **Step 3: Implement `Handler._analytics(self) -> None`** following `_history`: off -> `{"enabled": False}`; read `range` from `self._query()` (default `"24h"`, not in `RANGES` -> 400 `{"error": "'range' must be 1h, 24h, 7d or all"}`); `now = datetime.now(timezone.utc)`; rows from `store.rows_since(window_start(range, now))`; respond with `summarize(..., rules=catalog.rules_payload(block_threshold)["rules"], block_threshold=detector.rules.block_threshold)`. Add the cost and `"/dashboard"` to `PAGES` (after `"/history"`), and the `do_GET` branch.
- [ ] **Step 4: Run** `python -m unittest discover -s tests -t .`. Expected: all PASS.
- [ ] **Step 5: Commit** `xss_detector/server.py tests/test_analytics_api.py` with message `Add /api/analytics`.

---

### Task 4: The polling hook

**Files:**
- Create: `frontend/src/lib/useAnalytics.js`
- Test: `frontend/src/lib/useAnalytics.test.js`

**Interfaces:**
- Consumes: `get` from `frontend/src/api.js`.
- Produces: `export const REFRESH_MS = 5000`; `useAnalytics({ range }) -> { status: "loading" | "ok" | "error", data, error, reload }` where `data` is the `/api/analytics` response. Model it on `frontend/src/lib/useEvents.js` (visibility pause, abort, last data kept on error) and its test `useEvents.test.js`.

- [ ] **Step 1: Write the failing tests** (fake timers, mock `../api.js` as `useEvents.test.js` does):
  - `test_loads_at_once_with_the_range_and_then_every_5_seconds`: first `get` path is `/analytics?range=24h`; after 5,000 ms a second call; after another 10,000 ms two more.
  - `test_returns_the_data`: status goes `loading` -> `ok` with the response as `data`.
  - `test_a_range_change_loads_the_new_range_and_ignores_the_old_answer`: render with `7d`, hold its response pending, rerender with `24h`, then resolve the old response: `data` is the `24h` answer, never the `7d` one.
  - `test_does_not_start_a_new_load_while_one_is_in_flight`: with a never-resolving first response, advancing 20,000 ms makes no further `get` call.
  - `test_pauses_while_hidden_and_loads_again_when_visible`: hidden for 20,000 ms makes no calls; becoming visible triggers one at once.
  - `test_keeps_the_last_data_after_a_failed_load_and_recovers`: a rejected later poll sets `status === "error"`, keeps `data`, sets `error`; the next good poll returns `status === "ok"`, `error === null`.
  - `test_reload_loads_now`: `reload()` makes an immediate call.
  - `test_stops_polling_on_unmount`.
- [ ] **Step 2: Run** `cd frontend; npx vitest run src/lib/useAnalytics.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `useAnalytics`** (effect keyed on `range` and an `attempt` counter, one in-flight `AbortController`, a timer that schedules the next poll only after the current one settles, visibility handling).
- [ ] **Step 4: Run** the same command. Expected: all PASS.
- [ ] **Step 5: Commit** the two files with message `Add the useAnalytics hook`.

---

### Task 5: The StackedColumns chart

**Files:**
- Create: `frontend/src/charts/StackedColumns.jsx`
- Modify: `frontend/src/styles/charts.js` (only if the chart needs rules the existing classes lack; use tokens)
- Test: `frontend/src/charts/StackedColumns.test.jsx`

**Interfaces:**
- Consumes: `frame.js` (`VIEW_WIDTH`, `isNum`, `r2`), `scale.js` (`linearScale`, `niceTicks`), `shapes.js` (`toneClass`), `useChartTooltip` from `Tooltip.jsx`. Read `BarChart.jsx` and `BarChart.test.jsx` first and match their conventions (viewBox 640 wide, `role="group"`, tooltip binding, "No data" paragraph).
- Produces: `export function StackedColumns({ columns, series, format = String, tickFormat = String, ariaLabel })` where `columns` is `[{ key, label, values: { [seriesKey]: number } }]` and `series` is `[{ key, label, slot | level }]` (stacked bottom to top in series order). Every column's tooltip lists all its series values; a few x labels are shown (never overlapping).

- [ ] **Step 1: Load the `dataviz` skill**, then write the failing tests:
  - `renders one stacked column per bucket with a segment per non-zero series`: 3 columns, 2 series -> the expected number of `rect` marks; zero values draw no segment.
  - `segment heights are proportional to the values on one shared scale`: a column with 10 + 30 has a lower-segment height one third of the column's total height; the tallest column reaches the top tick.
  - `uses the tone classes of the series`: a `level: "critical"` series gets `fill-t-critical`, a `slot: 1` series gets `fill-s1`.
  - `labels the axis sparsely`: with 24 columns not every label is drawn and none are drawn twice at the same x.
  - `shows the whole column in its tooltip`: hovering or focusing a segment shows each series label with its value.
  - `has an accessible name and a No data state`: `aria-label` applied; `columns=[]` renders `No data`.
- [ ] **Step 2: Run** `npx vitest run src/charts/StackedColumns.test.jsx`. Expected: FAIL.
- [ ] **Step 3: Implement `StackedColumns`** with the signature above, following `BarChart`'s structure; add only token-based styles if needed.
- [ ] **Step 4: Run** `npx vitest run src/charts src/styles.test.js`. Expected: all PASS.
- [ ] **Step 5: Commit** the new and changed files with message `Add the StackedColumns chart`.

---

### Task 6: The Dashboard page

**Files:**
- Create: `frontend/src/pages/Dashboard.jsx`
- Modify: `frontend/src/styles/pages.js` (small token-based rules for the range chips and panels)
- Test: `frontend/src/pages/Dashboard.test.jsx`

**Interfaces:**
- Consumes: `useAnalytics`, `REFRESH_MS` (Task 4); `StackedColumns` (Task 5); `useApi` from `lib/useApi.js` for `useApi("/benchmark")`; `StatTile`, `ChartCard`, `BarChart`, `StackedBar`, `GroupedBars` from `charts/`; `categorySlot` from `lib/categories.js`; `LEVEL_LABEL` from `format.js`; `formatCount`, `formatPercent` from `charts/scale.js`; `PageHeading`. Read `pages/Benchmarks.jsx` (benchmark data shape, shipped detector) and `pages/History.jsx` (state handling) as models.
- Produces: `export function DashboardPage()`.

Page content (in order, all verbatim titles): range chips `Last hour`, `Last 24 hours` (default), `Last 7 days`, `All` (`aria-pressed`); six `StatTile`s `Total scans`, `Blocked`, `Allowed`, `Block rate` (percentage), `Critical`, `ML escalations` (note: `rules scored under 25`); `ChartCard` "Threats over time" with `StackedColumns` (series Blocked `level: "critical"`, Allowed `level: "safe"`, bucket labels from `t` shortened by `bucket`); "Most triggered rules" (`BarChart`, label `${rule_id} ${name}`, slot from `categorySlot(category)`); "Rules by category" and "Risk levels" (`StackedBar`; levels use `level`); "Scans by source" and "Scans by field" (`GroupedBars`, series Scans `slot: 1` and Blocked `level: "critical"`); "Score distribution" (`BarChart`, slot 1); a "Recent critical attacks" table (reuse `live-table` and `table-wrap` classes: Time (UTC), Source, Field, Score, Rules, Input); a "Detector quality" panel (benchmark shipped detector's recall, precision, false-positive rate and `hard_fps/hard_total` as `StatTile`s, the live block rate, and the quality note). Each chart has its table alternative via `ChartCard`'s `table` prop.

- [ ] **Step 1: Write the failing tests** (mock `../lib/useAnalytics.js` with `{ useAnalytics: vi.fn(), REFRESH_MS: 5000 }` and `../lib/useApi.js` as other page tests do; a `summary()` fixture builder following the spec's API shape):
  - `has a single h1 called Dashboard`.
  - `shows loading, then the error with a Retry that reloads` (no data), and keeps showing the data with an error note when a reload fails.
  - `explains that saving is off` (`{ enabled: false }`) with the verbatim text, and shows no charts or tiles.
  - `shows the empty message verbatim when the range has no scans` (`totals.scans === 0`), with no charts, and `Block rate` never shows `NaN`.
  - `shows the six tiles with the right numbers` (counts, `Block rate` as `75.0%` for 0.75, `ML escalations`).
  - `draws the charts` : the headings `Threats over time`, `Most triggered rules`, `Rules by category`, `Risk levels`, `Scans by source`, `Scans by field`, `Score distribution` are present, and the rules chart lists `XSS002 Inline event handler (known)`.
  - `range chips change the requested range`: `useAnalytics` last called with `{ range: "7d" }` after clicking `Last 7 days`; default is `24h`; `aria-pressed` follows the choice; choosing `All` shows the footnote verbatim.
  - `recent critical shows markup as plain text`: text `<script id="pwn">window.pwned=1</script>` creates no `script` or `img` elements, `window.pwned` stays undefined, and the cell's `textContent` equals the text.
  - `empty source shows (none)` in the source chart's table view or labels.
  - `detector quality uses the benchmark and says it is not live accuracy`: shows the verbatim quality note and the shipped detector's recall and precision; when `useApi` reports an error or no data, shows `Benchmark numbers are not available yet.` and the rest of the page still renders.
- [ ] **Step 2: Run** `npx vitest run src/pages/Dashboard.test.jsx`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `DashboardPage`** as described above, with the verbatim state texts from Global Constraints, then the small style additions.
- [ ] **Step 4: Run** `npx vitest run src/pages/Dashboard.test.jsx src/styles.test.js`. Expected: all PASS.
- [ ] **Step 5: Commit** the three files with message `Add the Dashboard page`.

---

### Task 7: Wire up, document, verify

**Files:**
- Modify: `frontend/src/routes.js`, `frontend/src/data/apiDocs.js`, `frontend/src/routes.test.js`, `frontend/src/data/apiDocs.test.js`, any frontend test whose expectations count routes, nav items or endpoints (find them by running the suite), `README.md`, `xss_detector/static/app.js` (rebuilt)

**Interfaces:**
- Consumes: `DashboardPage` (Task 6).
- Produces: route `{ path: "/dashboard", title: "Dashboard", nav: "Dashboard", component: DashboardPage }` right after `/history` inside the same `backendPages ? [] : [...]` guard; a `builtinOnly` endpoint entry with id `analytics`, `method: "GET"`, `path: "/analytics?range=24h"`, a summary and a response example matching the spec's shape.

- [ ] **Step 1: Update the tests first.** `routes.test.js`: the built-in build's path list gains `"/dashboard"` after `"/history"`; add a test that `buildRoutes(true)` has no `/dashboard`, `buildRoutes(false).find(r => r.path === "/dashboard")` matches `{ title: "Dashboard", nav: "Dashboard" }`, and the nav order has `Dashboard` right after `History`. `apiDocs.test.js`: the full path list, the built-in-only id list and the `endpointsFor(false)` order include `analytics` after `history-clear`; add a test that `analytics` is `builtinOnly` and its response example has the keys `enabled, range, generated, bucket, totals, timeline, levels, rules, categories, sources, fields, scores, recent_critical`.
- [ ] **Step 2: Run** `cd frontend; npx vitest run`. Expected: the updated tests FAIL.
- [ ] **Step 3: Implement** the route and the docs entry (match the tone of the `history` entries).
- [ ] **Step 4: Run** `npx vitest run` and fix any other expectation that counts routes, nav links or endpoints. Expected: all PASS.
- [ ] **Step 5: README.** Add a "Dashboard" section: what it shows, the ranges and buckets, the 5-second refresh, that it reads the scan history (so it is off when storing is off), the `/api/analytics` endpoint, and the note that live traffic has no labels so it shows no live recall.
- [ ] **Step 6: Rebuild and run everything.** `cd frontend; npm run build`, then `npx vitest run` and, from the project root, `python -m unittest discover -s tests -t .`. Expected: both PASS, and no `scans.db` is created by the tests.
- [ ] **Step 7: Manual check of the spec's five success criteria** on a separate port with a temporary database (`$env:SCAN_DB`, `$env:PORT=8010`): (1) scan a few attacks and harmless inputs through the API and the Scanner, then open `/dashboard` and see non-zero tiles, columns, rules and recent critical; (2) switch ranges and see the panels change; (3) scan once more while the page is open and see it update within about 5 seconds; (4) `HOST=0.0.0.0` shows the off message, and a fresh empty database shows the empty message; (5) scan `<script>alert(1)</script>` and see it as text in recent critical. Delete the temporary database afterwards.
- [ ] **Step 8: Commit** the files from this task with message `Wire up the Dashboard, document it, rebuild the bundle`.
