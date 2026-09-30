# Professional multi-page site with charts - design

Status: draft for review (2026-09-28). Builds on `2026-09-28-react-frontend-design.md` (already implemented).

## 1. Intent

Turn the React scanner UI into a **complete, professional, multi-page site** for the XSS detector, with real
data visualisations and a few delightful touches. Audience: anyone evaluating the tool (developers, security
reviewers) - a public showcase/documentation site with a live demo. The detector, its API and the strict
CSP do not change.

**Success criteria**
1. Eight routes render and survive refresh/bookmark: Home, Scanner, How it works, Rules, Benchmarks,
   API docs, About, and a real 404 page (HTTP 404).
2. Every chart is drawn from real data (the benchmark, the rule catalog, or the user's own scans), follows
   the dataviz method (form chosen by the data's job, validated palette, mark specs, tooltips, legend,
   table view), and works with keyboard and screen reader.
3. Light/dark/system theme works on every page; both themes pass the contrast and palette validation.
4. No CSP violations, no `innerHTML`-style sinks, no new runtime dependency (only `react`, `react-dom`).
5. Animation is decorative and never required: `prefers-reduced-motion` turns all of it off, and moving
   content can be paused.
6. All existing behaviour, APIs and tests keep working.

**Decisions already made with the user:** option 1 (public showcase/documentation site, not an operational
dashboard); charts, graphs and "other pleasing features"; branding is the name "XSS Detector" with a simple
inline shield mark; local-first (no Docker/hosting work).

## 2. Scope

In scope: new pages, router, layout (header, footer, theme toggle, toasts), SVG chart library, data hooks,
three read-only GET endpoints (`/api/health`, `/api/rules`, `/api/benchmark`), structured benchmark output,
page-route serving with a real 404, favicon, page metadata, styles restructure for theming, tests, README.

Out of scope: login, stored alert history, a team dashboard; Docker/hosting/production server; the `nh3`
rich-text sanitizer; i18n; analytics; a charting library; any change to detector rules or the ML model.

## 3. Pages

| Route | Content |
|---|---|
| `/` Home | Hero with an auto-cycling **live demo** (types a payload, shows the real verdict; pause control). Stat-tile row: recall, precision, false-positive rate, rule count, payloads tested (count-up on reveal). Feature grid (6). "Use it in your app" code sample with copy button. CTA to the scanner. |
| `/scanner` | Existing input, result and protected form, plus: **score gauge** (hero number + banded meter), **score-breakdown** stacked bar, **session insights** (score sparkline + level-mix stacked bar + history list), "Copy JSON" and "Copy share link". |
| `/how-it-works` | Interactive three-step walkthrough on the real API: pick an example payload, then Normalize (decoded text and layers) -> Match (highlighted matches and rules) -> Score (breakdown bar and level). |
| `/rules` | Rule explorer: search box, category filter chips, sortable table with inline weight bars and descriptions; **rule-weights** bar chart; **rules-by-category** stacked bar; level-threshold scale (0/1/25/50/75). |
| `/benchmarks` | KPI tiles for the shipped detector; **detector comparison** small multiples (recall, precision, false-positive rate); **unseen-source** grouped bars; **outcome table** with inline bars (TP/FN/FP/TN); example misses and false positives; caveats. |
| `/api-docs` | Reference for every endpoint with request/response examples, `curl` snippets with copy, and a **Try it** box for each. |
| `/about` | Limitations, how it is built, roadmap (rich-text sanitizer listed as planned), the reminder to always encode output. |
| anything else | 404 page with navigation back; the server answers HTTP 404. |

Shared chrome: sticky header (shield mark, nav links, theme toggle, mobile menu with `aria-expanded`,
`aria-current="page"` on the active link), skip-to-content link, footer (links, live **status badge** from
`/api/health`: "Operational - ML model loaded" / "Operational - rules only" / "Unavailable"), per-page
`document.title`, focus moved to the page heading on navigation with a polite route announcement.

## 4. Backend additions (stdlib only)

**Routing (`server.py`)**
- Page routes (`/`, `/scanner`, `/how-it-works`, `/rules`, `/benchmarks`, `/api-docs`, `/about`) return the
  generated shell with 200.
- Any other GET whose last path segment has no `.` and that does not start with `/api/` returns the shell
  with **404** (React shows the 404 page). Everything else stays a JSON 404.
- `GET /favicon.svg` is served from a Python string (`image/svg+xml`); `static/` still contains only
  `app.js`. The shell gains `<link rel="icon">`, `description`, `theme-color` (light and dark) and Open Graph
  tags. The CSP, security headers, body limits and all existing routes are unchanged.

**New read-only endpoints (JSON, same security headers)**
- `GET /api/health` -> `{"status": "ok", "rules": <int>, "ml_loaded": <bool>}`.
- `GET /api/rules` -> `{"rules": [{"id","name","category","weight","description"}...], "levels":
  [{"name","min"}...], "block_threshold": 25}`. Rules come from `DEFAULT_RULES` plus the obfuscation rule
  `XSS099` (category `evasion`); levels from `LEVELS`.
- `GET /api/benchmark` -> the contents of `reports/benchmark.json`, or `404 {"error": "Benchmark not
  generated; run python -m xss_detector evaluate"}`.

**Structured benchmark (`evaluate.py`)** - `build_report_data(results, data, cross_rows) -> dict`, written
to `reports/benchmark.json` next to the markdown by `main()`, and generated once and committed:

```
{ "generated": "YYYY-MM-DD",
  "dataset": {"malicious_test": int, "benign_test": int, "hard_negatives": int},
  "detectors": [{"name", "shipped": bool, "recall", "precision", "f1", "fpr", "accuracy",   // fractions 0..1
                 "tp", "fn", "fp", "tn", "hard_fps", "hard_total",
                 "samples": {"misses": [str], "false_positives": [str], "hard_false_positives": [str]}}],
  "unseen_sources": [{"source", "payloads", "rules_recall", "ml_recall", "ml_fpr"}],
  "unseen_weighted": {"payloads", "rules_recall", "ml_recall"},
  "notes": [str] }
```
`shipped` is true only for "Hybrid (rules; ML escalates)". Samples are truncated exactly as in the markdown.

## 5. Front-end architecture (plain JavaScript, React)

```
frontend/src/
  lib/       router.jsx (Router, Link, useRoute)  api.js (+get)  useApi.js  theme.jsx  history.jsx
             toast.jsx  useReveal.js  useCountUp.js  share.js  clipboard.js
  layout/    Header  Footer  ThemeToggle  StatusBadge  Shield (SVG)  PageHeading
  charts/    scale.js  arc.js  Chart frame components: BarChart  GroupedBars  StackedBar  Sparkline  Gauge
             Legend  Tooltip  DataTable  ChartCard (title, description, legend, table toggle)
  pages/     Home  Scanner  HowItWorks  Rules  Benchmarks  ApiDocs  About  NotFound
  styles/    tokens.js  base.js  layout.js  components.js  charts.js  pages.js   (joined into STYLES)
```

- **Router:** History API, no dependency. `Link` is a real `<a href>`; plain left-clicks navigate without a
  reload, modified clicks and external links behave normally. Route table defines path, title and element.
- **Data:** `useApi(path)` -> `{status: "loading" | "ok" | "error", data, error, reload}` for GET endpoints,
  cached per path in memory; pages show skeletons, and keep the previous render at reduced opacity on
  reload; errors are subtle and retryable.
- **Theme:** `"system" | "light" | "dark"` stored in `localStorage` (guarded; falls back silently). Tokens are
  defined once and applied under `:root[data-theme="dark"]` and under `@media (prefers-color-scheme: dark)
  { :root:where(:not([data-theme="light"])) }` (built from one JS token object, not duplicated by hand).
- **Session history:** last 50 scans `{id, ts, text (<= 300 chars), score, level, is_malicious}` in
  `sessionStorage` (guarded), deduplicated, with "Clear history". Feeds Session insights.
- **Share link:** `/scanner?t=<base64url(UTF-8 text)>`, only for text <= 2000 chars; read on load with
  guarded decoding; the copy button warns that the text will be in the URL.
- **Toasts:** `role="status"` region; copy actions confirm; auto-dismiss.
- **Reveal and count-up:** `IntersectionObserver` (feature-detected) and `requestAnimationFrame`; both skip
  straight to the final state under reduced motion or when unsupported.
- **Hero demo:** cycles 4 fixed payloads with a typing effect, calls the real `/api/scan` for each, shows
  level and score; has a visible pause/play button (moving content); pauses on hover/focus; static under
  reduced motion; shows a quiet fallback line if the API is unreachable.
- All untrusted or API-provided text (payloads, rule descriptions, samples, response bodies) is rendered as
  React text. `dangerouslySetInnerHTML` and the other banned sinks stay banned in `frontend/src`.

## 6. Chart design (dataviz method)

**Form is chosen by the data's job:**

| Chart | Data | Form |
|---|---|---|
| Detector comparison | recall, precision, FPR x 4 detectors (different scales: FPR ~0% vs recall ~95%) | **small multiples**: one horizontal bar chart per metric (never a dual axis), shared legend, value labels at bar tips |
| Unseen-source recall | 8 lists x {rules, ML} + weighted average | horizontal **grouped bars**, sorted by ML recall, weighted average emphasised, payload counts in labels |
| Outcome counts | TP/FN/FP/TN per detector | **table with inline bars** (magnitudes span 0..2700, so a chart would hide the errors) |
| Rule weights | 23 rules, weight, category | sorted horizontal **bars**, coloured by category, top rule labelled directly |
| Rules by category | count and total weight per category | horizontal **stacked bar** (part-to-whole), not a donut |
| Score breakdown | rule weights that produced one score (cap 100) | horizontal **stacked bar** in category colours with a marker at the block threshold (25) and the cap |
| Score gauge | one score 0..100 | **hero figure + meter**: banded semicircular track, level colour on the fill |
| Score history | last N scores | **line** (2px, end marker) with a hairline reference at the block threshold |
| Level mix | count per level | horizontal **stacked bar** in level colours (status palette, always with labels) |
| Headline stats | 5 numbers | **stat tiles** (no chart); at most one hero-size figure per view |

**Colour.** Categorical series use the reference palette in the fixed order: blue `#2a78d6`, orange `#eb6834`,
aqua `#1baf7a`, yellow `#eda100`, magenta `#e87ba4`, green `#008300` (dark: `#3987e5`, `#d95926`, `#199e70`,
`#c98500`, `#d55181`, `#008300`), never cycled. **Colour follows the entity, never its rank:**
- detectors: Hybrid (shipped) = slot 1, Rules = slot 2, ML alone = slot 3, Naive hybrid = slot 4
  (4 series -> direct labels are mandatory as well as the legend);
- rule categories: markup = 1, uri = 2, javascript = 3, css = 4, template = 5, evasion = 6;
- risk levels use the fixed status colours already in the design system (safe, low, medium, high, critical),
  always paired with a text label.
The palette **must be validated with `scripts/validate_palette.js`** (dataviz skill) against this site's own
chart surfaces (`--surface`: `#ffffff` light, `#121a2b` dark) for the series actually used, in both modes; any
FAIL is fixed by re-stepping within the ramp before shipping, and the results are recorded in the ledger.
Text never wears a series colour (values and labels use text tokens; a colour mark sits beside them).

**Marks and anatomy.** Bars <= 24px thick, 4px rounded data-end, square baseline; lines 2px; markers >= 8px
with a 2px surface ring; 2px surface gap between touching marks (no strokes); hairline solid recessive
gridlines; labels only where they fit, otherwise the value lives in the tooltip and the table; axis ticks
rounded to clean numbers. Chart chrome tokens: gridline, baseline, muted ink for both themes.

**Interaction.** Every bar/segment/marker is a hover and keyboard-focus target larger than the mark, showing
one tooltip (value first, name second, line-key swatch) built with React text nodes; the hovered mark lifts.
Tooltips never gate information: every value is also in the chart's **"View as table"** toggle. Charts have
`role="img"` with a title and description, and a legend whenever there are >= 2 series.

## 7. Theming and styles

The style tokens become one JS object per theme, emitted for `system`-dark and explicit-dark scopes. Existing
design-system guarantees stay enforced by `styles.test.js`: 4px spacing grid, radius scale, 150/200ms
ease-out only, hover/active/focus-visible/disabled states, soft shadows, WCAG AA text contrast in both
themes. New tokens (`--series-1..6`, `--chart-grid`, `--chart-axis`, `--chart-muted`) join the contrast and
palette checks. Reduced motion disables every animation and transition.

## 8. Testing

1. **Pure logic (Vitest):** `scale.js` (linear/band scales, ticks), `arc.js` (arc paths, angle mapping),
   router matching, share-link encode/decode (unicode, length cap, malformed input), history reducer
   (dedupe, cap, truncation), count-up and reveal fallbacks.
2. **Components/pages (Testing Library, mocked `fetch`):** each page renders from fixture data (real API
   shapes, including a benchmark fixture); charts render the expected mark counts, legends, direct labels,
   table toggle, tooltip on hover and focus; loading skeleton, error and empty states; Rules search/filter/
   sort; API "Try it"; theme toggle persistence; router navigation and 404; hero demo pause; toasts.
3. **Guards:** contrast and palette tests for chart tokens in both themes; source guard (no banned sinks);
   `frontend/src` has no `style=`-attribute reliance beyond CSSOM widths/heights.
4. **Python (`unittest`):** page routes 200 shell, unknown page 404 shell, asset-like unknown 404 JSON,
   `/favicon.svg`, `/api/health`, `/api/rules` (contents match `DEFAULT_RULES` and `LEVELS`),
   `/api/benchmark` present and missing cases, `build_report_data` schema and numbers from a small fixture,
   security headers on every new response, existing tests unchanged.
5. **Real browser (extend `browser-parity.mjs`):** visit every route and a deep link, reload each, hit a 404
   path, toggle the theme, confirm charts contain the expected marks, tooltip appears on hover, table toggle
   works, hero pauses, 320px/390px/1280px have no horizontal overflow, no CSP violations or JS exceptions;
   review light, dark and mobile screenshots of every page.
6. **Palette validation:** `validate_palette.js` run for both modes on the series actually used.
7. Final whole-branch review by a fresh reviewer, as before.

## 9. Risks

- **Scope and bundle size:** many pages and charts. Mitigation: pure-function chart maths, shared chart
  frame, hand-rolled SVG (no library); expected bundle ~300-350 KB minified (currently 245 KB); recorded in
  the ledger.
- **Chart correctness:** wrong scales mislead. Mitigation: unit-tested scales, every value in a table view,
  tooltips checked against the data in tests.
- **Privacy of history/share links:** payloads are stored in `sessionStorage` (cleared with the tab; a clear
  button; text truncated) and shared links put text in the URL (warned; length-capped).
- **Benchmark drift:** JSON and markdown must agree. Mitigation: both come from the same `results`/`cross`
  data in one `main()` run; the JSON is regenerated whenever the report is.
- **Stdlib server is not production-grade:** unchanged; documented on the About page.

## 10. Open questions for review

1. Part-to-whole charts (rules by category, score breakdown, level mix) are **stacked bars**, not donuts,
   following the dataviz guidance. Acceptable?
2. Session history in `sessionStorage` (per tab, cleared with it) - or in-memory only (lost on refresh)?
3. The hero demo calls the real API - acceptable, or should it use canned results?
4. Route names (`/scanner`, `/how-it-works`, `/rules`, `/benchmarks`, `/api-docs`, `/about`) - any changes?
