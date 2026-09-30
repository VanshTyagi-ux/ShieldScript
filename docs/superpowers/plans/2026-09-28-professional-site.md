# Professional Multi-Page Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the React scanner UI into an eight-route professional site with real data charts, theming and a few delightful touches, backed by three small read-only API endpoints.

**Architecture:** Stage A (Tasks 1-8) builds the foundation: structured benchmark JSON, page routing and endpoints in the stdlib server, a History-API router, a themeable style system, layout, and the Scanner, About and API pages. Stage B (Tasks 9-17) adds hand-rolled SVG charts (pure-function scales/arcs, shared card/legend/tooltip/table frame) and the data pages (Rules, Benchmarks, How it works, Home) plus scanner upgrades, then verifies everything in a real browser.

**Tech Stack:** React 19.3.0 + esbuild (plain JS, existing), Vitest 5 + Testing Library, Python 3.12 stdlib (`unittest`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-professional-site-design.md` (builds on `2026-09-28-react-frontend-design.md`, already implemented)

## Global Constraints

- **Dependencies:** runtime stays `react` + `react-dom` only. Hand-rolled SVG charts; no charting, router or animation library.
- **CSP unchanged** (`default-src 'self'; frame-ancestors 'none'`): no inline scripts, no `<style>` elements, no `style=` attributes in markup. React `style={{ width }}` (CSSOM) is allowed. SVG geometry uses attributes; colours use CSS classes.
- **Banned in non-test `frontend/src` files (comments count):** `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval(`, `new Function`, `document.write`. All API-provided or user-provided text (payloads, rule names/descriptions, benchmark samples, response bodies) is rendered as React text only.
- **Static dir:** `xss_detector/static/` contains only `app.js`. The favicon is served from a Python string.
- **Server:** stdlib only; new endpoints are GET, JSON, with the existing `SECURITY_HEADERS`; existing routes, limits and behaviour unchanged.
- **Styles:** one constructable stylesheet built from JS modules. Enforced by `styles.test.js`: 4px spacing grid (`--space-*`), radius tokens only (`--radius-sm/--radius/--radius-lg/--radius-pill`), transitions only `var(--t-fast)`/`var(--t-base)` (150/200ms ease-out), hover/active/focus-visible/disabled states, soft shadows, WCAG AA text contrast in both themes, reduced motion disables all animation.
- **Chart rules (spec section 6):** form by job; no dual axis; part-to-whole = stacked bars (no donuts); bars <= 24px thick with a 4px rounded data end and square baseline; lines 2px; markers >= 8px with a 2px surface ring; 2px surface gaps between touching marks (no strokes); hairline solid gridlines; value labels only where they fit; tooltip on hover **and** keyboard focus, never the only route to a value; every chart has a "View as table" toggle; legend whenever >= 2 series; text never wears a series colour; colour follows the entity: detectors Hybrid(shipped)=1, Rules=2, ML alone=3, Naive hybrid=4; categories markup=1, uri=2, javascript=3, css=4, template=5, evasion=6; risk levels use the fixed level colours with text labels.
- **Palette validation:** series colours (light `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300`, dark `#3987e5 #d95926 #199e70 #c98500 #d55181 #008300`) must pass `validate_palette.js` against this site's surfaces `#ffffff` (light) and `#121a2b` (dark) - Task 9.
- **Spec section 10 defaults (approved):** stacked bars instead of donuts; session history in `sessionStorage`; hero demo calls the real API; routes `/`, `/scanner`, `/how-it-works`, `/rules`, `/benchmarks`, `/api-docs`, `/about`.
- **Existing tests stay green** (46 Python, 97 frontend at the start) except tests a task explicitly says to update.
- **Environment:** Windows, PowerShell 7. Frontend commands run from `frontend/` (`npm test`, `npm run build`); Python from the repo root (`python -m unittest discover -s tests -t .`). **Not a git repository: no commit steps;** each task ends with a checkpoint (suites green).
- **Test-writing gotchas learned:** `beforeEach(() => { mock.mockReset(); })` needs a block body (a returned mock is run as a teardown hook); with fake timers use `await act(async () => { await vi.advanceTimersByTimeAsync(ms); })`, not `findBy*`; vitest 5 uses `oxc` (config already set); the source guard scans comments too.

## Review Focus

1. Deep links and refresh: every page path returns the app (200), unknown paths return the app with HTTP 404 and render the 404 page; `/api/nope` and dotted unknowns stay JSON 404 (Tasks 2, 3, 17).
2. Blocked or corrupt browser storage (`localStorage`/`sessionStorage` that throw, or hold garbage JSON) must not crash theme or history (Tasks 5, 14).
3. Missing or malformed data (`/api/benchmark` 404/500, empty `detectors`, all-zero values, weight sums above 100) shows error/empty states, never `NaN` or a blank SVG (Tasks 10, 12, 13).
4. Hostile strings in API data or a share link (`<script>`, quotes, emoji in sample text and rule names; malformed, oversized or non-UTF-8 `?t=`) render as literal text and never crash (Tasks 6, 13, 14).
5. Reduced motion and no `IntersectionObserver`/`matchMedia`: animations skip to the final state and content stays visible (Tasks 6, 16).

## File map

```
xss_detector/evaluate.py   (build_report_data, JSON output)     reports/benchmark.json (generated)
xss_detector/server.py     (PAGES, favicon, 3 endpoints, meta)  tests/test_evaluate_json.py, tests/test_site.py
frontend/src/
  lib/     router.jsx theme.jsx toast.jsx announce.jsx clipboard.js share.js history.jsx
           useApi.js useReveal.js useCountUp.js useReducedMotion.js categories.js
  layout/  Header Footer StatusBadge ThemeToggle Shield PageHeading
  charts/  scale.js shapes.js arc.js ChartCard Legend Tooltip DataTable BarChart GroupedBars StackedBar Sparkline Gauge StatTile
  components/ CodeBlock TryIt ScoreBreakdown SessionInsights ResultActions HeroDemo FeatureGrid Reveal (+ existing)
  pages/   Home Scanner HowItWorks Rules Benchmarks ApiDocs About NotFound
  data/    apiDocs.js walkthrough.js
  styles/  tokens.js base.js layout.js components.js charts.js pages.js        routes.js  test/setup.js  test/fixtures.js
```

---

## STAGE A - Foundation

### Task 1: Structured benchmark JSON

**Files:**
- Modify: `xss_detector/evaluate.py` (add `SHIPPED`, `NOTES`, `build_report_data`; `render_report` uses `NOTES`; `main` also writes `out.with_suffix(".json")`)
- Create: `tests/test_evaluate_json.py`; generate `reports/benchmark.json`

**Interfaces:**
- Produces: `build_report_data(results: list[dict], data: dict, cross_rows: list[dict] | None, today: date | None = None) -> dict` with the schema in spec section 4. `results`/`data`/`cross_rows` have the shapes returned by `run()`, `load_dataset()` and `cross_source()`. `SHIPPED = "Hybrid (rules; ML escalates)"`. `NOTES: list[str]` (the three caveats, plain text without the `> - ` prefix).

- [x] **Step 1: Save the current report for comparison:** copy `reports/benchmark.md` to the scratchpad.
- [x] **Step 2: Write failing tests** in `tests/test_evaluate_json.py` using hand-built fixtures (`Metrics(tp=8, fn=2, fp=1, tn=9)`, two results named `SHIPPED` and `"Rules"`, `data = {"malicious": {"test": [...10]}, "benign": {"test": [...10]}, "hard": [...4]}`): `test_schema_and_dataset_counts`; `test_detector_metrics_are_fractions_matching_Metrics` (recall 0.8, precision 8/9, fpr 0.1, f1, accuracy, tp/fn/fp/tn, `hard_fps`/`hard_total`); `test_only_the_shipped_detector_is_flagged`; `test_samples_are_truncated` (30 misses of 300 chars -> at most 12 items, each at most 110 chars; hard FPs at most 40); `test_unseen_weighted_average` (rows `a` n=100 rules .5 ml 1.0 and `b` n=300 rules 1.0 ml .5 -> payloads 400, rules_recall .875, ml_recall .625, and row keys renamed to `payloads/rules_recall/ml_recall/ml_fpr`); `test_no_cross_rows` (`unseen_sources == []`, `unseen_weighted is None`); `test_notes_included`; `test_generated_date` (`today=date(2026,9,28)` -> `"2026-09-28"`); `test_main_writes_markdown_and_json` (`main(out=tmp/"b.md", cross=False)` writes both; JSON has 4 detectors, `json.loads` succeeds).
- [x] **Step 3: Run** `python -m unittest tests.test_evaluate_json` -> FAIL (`build_report_data` missing).
- [x] **Step 4: Implement** `build_report_data`, `NOTES` (render_report renders each as `> - {note}` so the markdown is unchanged), and the JSON write in `main` (`json.dumps(..., indent=2)`).
- [x] **Step 5: Run** the new tests -> PASS.
- [x] **Step 6: Generate the committed file:** `python -m xss_detector evaluate` (trains several models; allow up to 10 minutes). Verify: `reports/benchmark.md` is byte-identical to the saved copy; `reports/benchmark.json` has 4 detectors, 8 unseen sources, shipped recall about 0.952 and weighted unseen ML recall about 0.992.
- [x] **Step 7: Checkpoint:** `python -m unittest discover -s tests -t .` -> all PASS.

### Task 2: Page routes, favicon, meta tags and read-only endpoints

**Files:**
- Modify: `xss_detector/server.py`; `tests/test_frontend.py` (shell head tags)
- Create: `tests/test_site.py`

**Interfaces:**
- Produces in `server.py`: `PAGES = ("/", "/scanner", "/how-it-works", "/rules", "/benchmarks", "/api-docs", "/about")`; `FAVICON_SVG: bytes`; `BENCHMARK_PATH: Path` (`reports/benchmark.json`, patched by tests); `rules_payload() -> dict`; `health_payload() -> dict`.
- Routing in `do_GET` (path split at `?`, one trailing `/` stripped except root): `/app.js` (unchanged); `/favicon.svg` -> 200 `image/svg+xml`; `/api/health`, `/api/rules`, `/api/benchmark` -> JSON; path in `PAGES` -> shell 200; any other path that does **not** start with `/api/` and whose last segment has no `.` -> shell with **404**; everything else -> existing JSON 404.
- `/api/health` -> `{"status": "ok", "rules": len(detector.rules.rules), "ml_loaded": detector.ml is not None}`. `/api/rules` -> `{"rules": [{"id","name","category","weight","description","derived"}...], "levels": [{"name","min"}...] ascending (safe 0, low 1, medium 25, high 50, critical 75), "block_threshold": detector.rules.block_threshold}`: all `DEFAULT_RULES` (`derived: false`) then `OBFUSCATION_RULE` (`derived: true`). `/api/benchmark`: file contents; missing -> `404 {"error": "Benchmark not generated; run python -m xss_detector evaluate"}`; unreadable/invalid JSON -> `500 {"error": "Benchmark file is unreadable"}`.
- Shell head additions: `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`, `<meta name="description" ...>`, two `theme-color` metas (`#f8fafc` light, `#0b1220` dark, with `media`), `og:title`, `og:description`, `og:type` = `website`.

- [x] **Step 1: Write failing tests** in `tests/test_site.py` (server fixture as in `tests/test_frontend.py`): every path in `PAGES` -> 200 `text/html` containing `<div id="root">`; `/scanner/` and `/scanner?t=abc` -> 200; `/nope`, `/api`, `/rules/xyz` -> **404 status with the shell body**; `/nope.txt`, `/style.css`, `/api/nope` -> 404 JSON with `error`; `/favicon.svg` -> 200 `image/svg+xml`, starts with `<svg`, contains `xmlns`, no `<script`, no ` on...=` attribute; `/api/health` keys and types; `/api/rules`: 24 rules, last is `XSS099` with `derived` true, all others false, integer weights, levels `[safe 0, low 1, medium 25, high 50, critical 75]`, `block_threshold == 25`, ids match `DEFAULT_RULES`; `/api/benchmark` with `BENCHMARK_PATH` patched to a temp JSON (returns identical content), missing (404, message contains `python -m xss_detector evaluate`), corrupt (500); `Content-Security-Policy` and `X-Content-Type-Options: nosniff` on a page, on the favicon, and on all three endpoints. In `tests/test_frontend.py` add: shell contains `rel="icon"`, `name="description"`, both `theme-color` metas and `og:title`.
- [x] **Step 2: Run** `python -m unittest tests.test_site tests.test_frontend` -> FAIL.
- [x] **Step 3: Implement** the routing, payload functions, favicon (a 64x64 rounded shield in `#4f46e5` with a white check mark, no script or handlers) and shell head in `server.py`.
- [x] **Step 4: Checkpoint:** `python -m unittest discover -s tests -t .` -> all PASS (existing 46 plus the new tests).

### Task 3: History-API router

**Files:**
- Create: `frontend/src/lib/router.jsx`; Test: `frontend/src/lib/router.test.jsx`

**Interfaces:**
- Produces: `matchRoute(routes, pathname) -> route | null` (exact match after stripping one trailing slash); `RouterProvider({ routes, notFound, children })`; `useRoute() -> { path, search, route, navigate(to, { replace = false } = {}) }`; `Routes()` (renders the matched `route.component`, else `notFound.component`); `Link({ to, children, ...anchorProps })`. A route is `{ path, title, nav?, component }`; `notFound` is `{ title, component }`. Title rule: `document.title = route.title ? \`${route.title} · XSS Detector\` : "XSS Detector"`.
- `Link` renders `<a href={to}>`; a plain left-click calls `navigate` and `preventDefault`; it does **not** intercept modified clicks (meta/ctrl/shift/alt), non-zero buttons, `target`, `download`, or external hrefs (`/^[a-z][a-z0-9+.-]*:/i`, or starting `//`). It sets `aria-current="page"` when `to`'s pathname equals the current path.
- `navigate` uses `history.pushState`/`replaceState`, updates state, and calls `window.scrollTo(0, 0)`; a `popstate` listener keeps state in sync.

- [x] **Step 1: Write failing tests:** `matchRoute` exact, trailing slash, unknown -> null; clicking a `Link` changes `location.pathname`, swaps the rendered route, and the click event is `defaultPrevented`; meta-click, `target="_blank"` and `https://example.com` links are not prevented; `aria-current` only on the active link; `history.back()` (popstate) updates the route; `search` reflects `?t=1`; `navigate("/x", { replace: true })` calls `replaceState` not `pushState`; document title per route, default title for `""`, and `"Page not found · XSS Detector"` for the not-found route; unknown path renders `notFound.component`.
- [x] **Step 2: Run** `npm test -- src/lib/router.test.jsx` -> FAIL.
- [x] **Step 3: Implement** the router.
- [x] **Step 4: Checkpoint:** full `npm test` -> PASS.

### Task 4: Style modules with theme-ready tokens

**Files:**
- Create: `frontend/src/styles/tokens.js`, `base.js`, `layout.js`, `components.js`; Modify: `frontend/src/styles.js` (concatenates the modules in the order tokens, base, layout, components; same rule order as today so cascade is unchanged); Modify: `frontend/src/styles.test.js`

**Interfaces:**
- Produces: `tokens.js` exports `LIGHT` and `DARK` (plain objects: token name -> value, values identical to today's) and `TOKENS_CSS` (string) which emits `:root { color-scheme: light; <LIGHT + fixed tokens> }`, then `:root[data-theme="dark"] { color-scheme: dark; <DARK> }`, then `@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) { color-scheme: dark; <DARK> } }`, all generated from the same `DARK` object. The other modules export CSS strings; `STYLES` remains the single export used by `applyStyles`.

- [x] **Step 1: Update tests first** in `styles.test.js`: `DARK` tokens are now parsed from the `:root[data-theme="dark"]` block; add `test_dark_tokens_are_identical_in_both_scopes` (the `@media` scope contains exactly the same declarations as the explicit scope) and `test_explicit_light_override_scope_exists` (`:where(:not([data-theme="light"]))` present). Keep every other assertion.
- [x] **Step 2: Run** `npm test -- src/styles.test.js` -> FAIL (new assertions).
- [x] **Step 3: Restructure** the existing CSS into the modules (no visual change).
- [x] **Step 4: Checkpoint:** full `npm test` -> PASS; `npm run build:check` succeeds.

### Task 5: Theme provider and toggle

**Files:**
- Create: `frontend/src/lib/theme.jsx`, `frontend/src/layout/ThemeToggle.jsx`; Test: `frontend/src/lib/theme.test.jsx`

**Interfaces:**
- Produces: `THEME_KEY = "xssd-theme"`; `ThemeProvider({ children })`; `useTheme() -> { theme: "system" | "light" | "dark", setTheme(next), cycle() }` (`cycle`: system -> light -> dark -> system). The provider sets `document.documentElement.dataset.theme` to `"light"`/`"dark"` (attribute removed for `"system"`) in a layout effect and persists to `localStorage`, guarded.
- `ThemeToggle()`: a button with an inline-SVG icon per state and `aria-label` `Theme: <state>. Switch to <next>`.

- [x] **Step 1: Write failing tests:** default `"system"` with no attribute; stored `"dark"` applies `data-theme="dark"`; stored garbage (`"purple"`, invalid JSON) -> `"system"`; **storage that throws** on `getItem`/`setItem` does not crash and the toggle still works in memory; the persisted value is written on change; toggle cycles through the three states with the expected `aria-label`s and attribute values.
- [x] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Checkpoint:** full `npm test` -> PASS.

### Task 6: Toasts, clipboard, share links, announcer, motion hooks

**Files:**
- Create: `frontend/src/lib/toast.jsx`, `clipboard.js`, `share.js`, `announce.jsx`, `useReducedMotion.js`, `useReveal.js`, `useCountUp.js`, `frontend/src/test/setup.js`; Modify: `frontend/vitest.config.js` (`setupFiles: ["./src/test/setup.js"]`); Tests alongside.

**Interfaces:**
- Produces: `ToastProvider`, `useToast() -> { toast(message, { kind = "info" | "error", duration = 3000 } = {}) }` (a `role="status"` `aria-live="polite"` region, auto-dismiss); `copyText(text) -> Promise<boolean>` (`navigator.clipboard.writeText`, fallback hidden textarea + `execCommand("copy")`, `false` if both fail); `encodeShare(text) -> string | null` (base64url of UTF-8; `null` if empty or longer than 2000 chars); `decodeShare(param) -> string | null` (guarded: bad base64, invalid UTF-8, or result over 2000 chars -> `null`); `buildShareUrl(text, origin) -> string | null` (`${origin}/scanner?t=...`); `AnnounceProvider`, `useAnnounce() -> announce(message)` (renders `<div id="announce" class="sr-only" aria-live="polite">`); `useReducedMotion() -> boolean` (guarded `matchMedia("(prefers-reduced-motion: reduce)")`, `false` if unavailable); `useReveal() -> [ref, visible]` (`IntersectionObserver` feature-detected; visible immediately when unsupported or reduced motion); `useCountUp(target, { duration = 900, active = true }) -> number` (rAF tween to `target`; returns `target` immediately when reduced motion or `!active`).
- `test/setup.js`: stubs `window.matchMedia` (default `matches: false`, `addEventListener` no-ops) and does not define `IntersectionObserver`.

- [x] **Step 1: Write failing tests:** toasts appear, auto-dismiss at `duration` (fake timers), stack, error kind class; `copyText` uses the clipboard API, falls back, returns `false` when both fail; share round trip for `"😀 <script>é & \"q\""`, `null` for `""` and 2001 chars, malformed base64 (`"!!!"`), and a valid base64 of invalid UTF-8 -> `null`, URL builder shape; `useReducedMotion` true/false/missing `matchMedia`; `useReveal` visible immediately without `IntersectionObserver`, flips on an intersecting callback when present; `useCountUp` returns the target immediately under reduced motion and progresses monotonically to the target with fake rAF otherwise; announcer text updates.
- [x] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Checkpoint:** full `npm test` -> PASS.

### Task 7: Layout, data hook, app shell, Scanner page move, 404

**Files:**
- Create: `frontend/src/lib/useApi.js`, `frontend/src/routes.js`, `frontend/src/layout/{Header,Footer,StatusBadge,Shield,PageHeading}.jsx`, `frontend/src/pages/{Scanner,NotFound}.jsx`, `frontend/src/test/fixtures.js` (starts with `HEALTH_FIXTURE`), tests
- Modify: `frontend/src/api.js` (add `get`), `frontend/src/App.jsx` (providers + layout + `Routes`), `frontend/src/main.jsx`, `frontend/src/styles/{layout,components}.js` (header, nav, mobile menu, footer, skip link, toasts, theme toggle, status badge, page heading)
- Update tests: move `App.test.jsx`'s scanner flows to `pages/Scanner.test.jsx` (page heading is now `Scanner`); `App.test.jsx` becomes the shell/integration test.

**Interfaces:**
- Produces: `get(url, signal) -> { status, ok, data }` (same shape and non-JSON handling as `post`); `useApi(path) -> { status: "loading" | "ok" | "error", data, error, reload }` (fetch on mount/path change with `AbortController`; successful responses cached per path in a module `Map` and served instantly; `reload()` refetches keeping the previous `data`; `error` = `data.error` or `"unexpected response"` or the thrown message); `clearApiCache()`.
- `routes.js`: `ROUTES = [{ path: "/", title: "", component: ScannerPage }, { path: "/scanner", title: "Scanner", nav: "Scanner", component: ScannerPage }]` (**interim: `/` shows the Scanner until Task 16 replaces it with Home**); `NOT_FOUND = { title: "Page not found", component: NotFound }`. Later tasks append routes.
- `Header`: brand `Link` to `/` (Shield + "XSS Detector"), nav built from `ROUTES` entries that have `nav`, `ThemeToggle`, mobile menu button (`aria-expanded`, `aria-controls="site-nav"`; closes on navigation and on Escape), a skip link `<a class="skip-link" href="#main">Skip to content</a>`. `Footer`: nav links, `StatusBadge`, tagline "Detection is heuristic. Always encode output and use a CSP." `StatusBadge` from `useApi("/api/health")`: ok + `ml_loaded` -> "Operational · ML model loaded"; ok without ML -> "Operational · rules only"; error -> "Status unavailable"; loading -> "Checking status…" (a coloured dot plus text, never colour alone).
- `PageHeading({ children, description })` renders `<h1 tabIndex={-1}>` (the page's single h1). `App` wraps `ThemeProvider > ToastProvider > AnnounceProvider > RouterProvider`, renders `Header`, `<main id="main">` with `Routes`, `Footer`; on route change (not first render) it focuses `#main h1` (`preventScroll`) and announces `Navigated to <title>`.
- `pages/Scanner.jsx` holds today's `Scanner` + `ResultPanel` + `ProtectedForm` composition and uses `useAnnounce()` instead of local announce state.

- [x] **Step 1: Write failing tests:** `useApi` (loading -> ok, cache hit on second mount with no fetch, `data.error`/non-JSON/rejection -> `error`, `reload` keeps previous data while loading, aborts on unmount and path change); `Header` (brand + only routes with `nav`, `aria-current` on active, menu toggle `aria-expanded`, closes on link click and Escape, skip link target exists); `StatusBadge` four states with `HEALTH_FIXTURE` (`{status:"ok", rules:23, ml_loaded:true}`); `App` integration at `/scanner` (h1 `Scanner`), at `/nope` (h1 `Page not found`, `document.title`), header-link navigation moves focus to the new h1 and announces `Navigated to Scanner`; ported scanner flow tests still pass on the page.
- [x] **Step 2: Run** -> FAIL. **Step 3: Implement** all of the above plus the styles. **Step 4: Checkpoint:** full `npm test` -> PASS; `npm run build:check` succeeds.

### Task 8: API docs and About pages

**Files:**
- Create: `frontend/src/data/apiDocs.js`, `frontend/src/components/{CodeBlock,TryIt}.jsx`, `frontend/src/pages/{ApiDocs,About}.jsx`, tests; Modify: `routes.js` (`/api-docs` title `API docs` nav `API`; `/about` title `About` nav `About`), `styles/pages.js` (new module, added to `styles.js`)

**Interfaces:**
- Produces: `ENDPOINTS` (5 entries: `POST /api/scan`, `POST /api/submit`, `GET /api/rules`, `GET /api/benchmark`, `GET /api/health`, each `{ id, method, path, summary, requestExample?, responseExample }`); `curlFor(endpoint, origin, body?) -> string` (single-quoted body with embedded `'` escaped as `'\''`, includes `-X POST` and `-H 'Content-Type: application/json'` only for POST); `CodeBlock({ code, label })` (`<pre><code>` text plus a Copy button using `copyText` and toasts); `TryIt({ endpoint })` (POST: textarea prefilled with the example body; GET: just a button; shows status line and pretty-printed JSON as text; disabled while pending; body over the limit blocked with `tooLarge` and the 256 KiB message; network errors shown subtly).
- `About`: sections What it is, Limitations (heuristic; prose about XSS is flagged; `on...=` prose scores medium; DOM-based XSS never reaches the server), How it is built, Roadmap (rich-text sanitizer: "planned"), and the "always encode output" callout plus a note that the built-in server is not production-grade.

- [x] **Step 1: Write failing tests:** `curlFor` (POST vs GET, body containing `'`, origin); ApiDocs lists five endpoints with method badges and a curl block each; Try-it POST sends the edited body and shows `200` plus pretty JSON; GET sends no body; pending disables the button; error state; oversized body blocked without a request; copy button calls `copyText` and toasts; About headings, "planned" roadmap item, internal links resolve to `/scanner` and `/benchmarks`.
- [x] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Checkpoint:** full `npm test` -> PASS.

---

## STAGE B - Charts and data pages

### Task 9: Chart foundations and palette validation

**Files:**
- Create: `frontend/src/charts/{scale.js,shapes.js,arc.js,ChartCard.jsx,Legend.jsx,Tooltip.jsx,DataTable.jsx}`, `frontend/src/styles/charts.js` (added to `styles.js`), tests
- Modify: `frontend/src/styles/tokens.js` (`--series-1..6` per theme; classes `fill-s1..s6`, `stroke-s1..s6`, `fill-t-<level>`, `stroke-t-<level>` in `charts.js`)

**Interfaces:**
- `scale.js`: `niceTicks(min, max, count = 5) -> number[]` (smallest step from {1,2,5}x10^n that is >= range/count, ticks from `floor(min/step)*step` to `ceil(max/step)*step`, floating error rounded away); `linearScale([d0,d1],[r0,r1]) -> fn` (degenerate domain returns the range midpoint, never `NaN`); `bandScale(keys, [r0,r1], { padding = 0.2 }) -> { start(key), bandwidth }` (`step = (r1-r0)/n`, `bandwidth = step*(1-padding)`, `start = r0 + i*step + (step-bandwidth)/2`); `formatPercent(f, digits = 1)` (`"94.2%"`); `formatCount(n)` (`"1,284"`).
- `arc.js`: angles in degrees, 0 = 3 o'clock, counter-clockwise; `polar(cx, cy, r, deg) -> {x, y}` (`x = cx + r cos`, `y = cy - r sin`); `arcPath(cx, cy, r, a0, a1) -> string` (clockwise from `a0` down to `a1`, large-arc flag when the sweep exceeds 180, numbers rounded to 2 decimals with trailing zeros trimmed); `gaugeAngle(value) = 180 - 1.8 * clamp(value, 0, 100)`.
- `shapes.js`: `roundedEndBar(x, y, w, h, r = 4) -> string` (path: left corners square, right corners radius `r`, radius clamped to `min(r, w, h/2)`); `toneClass(item, kind)` -> `fill-s<slot>` / `stroke-s<slot>` when `item.slot`, `fill-t-<level>` / `stroke-t-<level>` when `item.level`.
- `ChartCard({ title, description, legend, table, footnote, children })`: `<figure>` with `<h3>`, muted description, `Legend` when `legend.length >= 2`, a **View as table / View as chart** toggle button (`aria-pressed`) swapping `children` for `DataTable`, footnote. `Legend({ items })` (`{ key, label, slot | level }`, swatch mark + text in text tokens). `DataTable({ columns, rows, caption })` (`<caption class="sr-only">`).
- `Tooltip.jsx`: `useChartTooltip() -> { layer, bindMark }`; `bindMark({ title, rows: [{ label, value, slot?, level? }] }) -> props` (`tabIndex: 0`, `onPointerEnter/Move/Leave`, `onFocus/onBlur`, `onKeyDown` Escape, all positioning from the mark's `getBoundingClientRect` relative to the chart wrapper); `layer` renders one tooltip: value first (strong), name second, line-key swatch, all as React text.

- [x] **Step 1: Write failing tests:** `niceTicks(0,97)` = `[0,20,40,60,80,100]`, `(0,1)` = `[0,.2,.4,.6,.8,1]`, `(0,2700)` = `[0,1000,2000,3000]`; `linearScale` mapping, inverted range, degenerate domain; `bandScale` 3 keys over `[0,300]` padding .2 -> bandwidth 80, starts 10/110/210; `formatPercent(.942)`, `formatCount(1284)`; `polar(50,50,40,0)` = `{x:90,y:50}` and `90` -> `{x:50,y:10}`; `arcPath(50,50,40,180,0)` = `"M 10 50 A 40 40 0 0 1 90 50"`; `gaugeAngle(0)` 180, `(50)` 90, `(150)` 0, `(-5)` 180; `roundedEndBar` exact path for a 100x20 bar and clamping for a 2px-wide bar; `toneClass`; ChartCard toggle swaps chart for table and back, legend hidden for one series and shown for two, description linked; Tooltip: hover shows value then name, focus shows, Escape hides, hostile label `<b>x</b>` rendered literally; `styles.test.js` extended: `--series-1..6` exist in both themes and are hex.
- [x] **Step 2: Run** -> FAIL. **Step 3: Implement.**
- [x] **Step 4: Validate the palette (mandatory):** run `node "C:\Users\VANSHT~1\AppData\Local\Temp\claude\bundled-skills\2.1.283\da8379bffda53cfc232671673ebc2d9b\dataviz\scripts\validate_palette.js" "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300" --mode light --surface "#ffffff"` and the dark set `"#3987e5,#d95926,#199e70,#c98500,#d55181,#008300" --mode dark --surface "#121a2b"` (if that path is gone, find `validate_palette.js` under the bundled dataviz skill). Fix every FAIL by re-stepping within the ramp as the validator suggests, update `tokens.js`, re-run; append the final reports to the ledger. WARN on contrast means visible labels/table view are required (already the design).
- [x] **Step 5: Checkpoint:** full `npm test` -> PASS.

### Task 10: Bar, grouped-bar and stacked-bar charts

**Files:**
- Create: `frontend/src/charts/{BarChart,GroupedBars,StackedBar}.jsx`, tests

**Interfaces:**
- Consumes: Task 9 scales/shapes/tooltip/frame.
- `BarChart({ data, format, domain, valueLabel, labelWidth = 220 })`: horizontal bars; `data` items `{ key, label, value, slot | level, detail? }`; SVG `viewBox` width 640; bar thickness `min(24, band)`; grid at `niceTicks`; value text after each bar tip (right margin reserved); hit area = full band; each item is a focusable group with `aria-label` `"<label>: <formatted value>"`; empty `data` -> "No data" text. Marks carry class `mark` plus `toneClass`.
- `GroupedBars({ groups, series, format, domain })`: `groups: [{ key, label, values: { [seriesKey]: number } }]`, `series: [{ key, label, slot | level }]`; one bar per series per group, 2px gap, group label left.
- `StackedBar({ segments, format, total, markers = [] })`: one horizontal bar; `segments: [{ key, label, value, slot | level }]`; 2px gaps; the domain is `max(total ?? sum, sum)`; inline label only if `label.length * 6.5 + 16 < segment width` else omitted (legend/tooltip/table carry it); `markers: [{ value, label }]` drawn as hairline ticks with a label above; all-zero or empty -> "No data".
- All three render inside their own `chart-wrap` with `useChartTooltip`, and are meant to be placed in a `ChartCard`.

- [x] **Step 1: Write failing tests:** BarChart (3 items -> 3 `.mark` bars; widths proportional for domain `[0,100]` over the plot width; thickness at most 24; tick labels from `niceTicks`; value labels present; slot vs level classes; each group focusable with the expected `aria-label`; hover and focus show a tooltip with the value first; Escape hides; zero value draws a zero-width bar without `NaN` in any attribute; `NaN`/`undefined` value skipped; empty data -> "No data"; label `<script>` shown literally); GroupedBars (2 series x 3 groups = 6 bars, series order/colour stable, 2px gap between a group's bars, tips labelled, tooltip lists the group's series values); StackedBar (segment widths proportional to values, 2px gaps, label only when it fits, marker x at the correct fraction, total larger than sum leaves free space, sum above 100 with domain 100 uses `max`, all-zero -> "No data", tooltip and focus per segment).
- [x] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Checkpoint:** full `npm test` -> PASS.

### Task 11: Sparkline, Gauge and StatTile

**Files:**
- Create: `frontend/src/charts/{Sparkline,Gauge,StatTile}.jsx`, tests

**Interfaces:**
- `Sparkline({ points, domain = [0, 100], reference, height = 120 })`: `points: [{ value, label }]`; 2px line (round joins), end marker r=4 with a 2px surface ring, hairline reference line `{ value, label }`; the container is one tab stop: ArrowLeft/ArrowRight/Home/End move an active point and show its tooltip; pointer hover snaps to the nearest point; fewer than 2 points draws only markers; empty -> "No data".
- `Gauge({ score, level })`: semicircle (`arcPath`) with a neutral track split into the level bands (0-25, 25-50, 50-75, 75-100 as low/medium/high/critical), a fill arc from 0 to `score` in the level tone, a marker dot at the score angle, hero number (>= 48px) centred, band labels 25/50/75 in muted text; `role="group"` with `aria-label` `"Risk score <n> of 100, <level>"`; score clamped to 0..100; score 0 draws no fill arc.
- `StatTile({ label, value, note, countUp, format })`: sentence-case label, value, muted note; when `countUp` is a number it uses `useReveal` + `useCountUp` and renders `format(counted)`.

- [x] **Step 1: Write failing tests:** Sparkline (path point count, y positions for domain, reference line y, end marker present with ring class, arrow-key navigation changes the tooltip text and `Home`/`End` jump, single point, empty state, hover nearest point); Gauge (score 50 fill ends at `(cx, cy - r)`, 0 has no fill arc, 100 sweeps 180, 150 and -5 clamp, level class on the fill, aria label, hero text, four band arcs); StatTile (static value; `countUp` shows the final value under reduced motion; progresses otherwise).
- [x] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Checkpoint:** full `npm test` -> PASS.

### Task 12: Rules page

**Files:**
- Create: `frontend/src/lib/categories.js`, `frontend/src/pages/Rules.jsx`, tests; Modify: `routes.js` (`/rules`, title `Rules`, nav `Rules`), `test/fixtures.js` (`RULES_FIXTURE`), `styles/pages.js`

**Interfaces:**
- `categories.js`: `CATEGORY_SLOTS = { markup: 1, uri: 2, javascript: 3, css: 4, template: 5, evasion: 6 }`; `categoryLabel(name)` (capitalised, `uri` -> "URI", `css` -> "CSS", `evasion` -> "Evasion").
- `Rules` page: `useApi("/api/rules")` with skeleton, and an error box with a Retry button (`reload`); controls row: search input (matches id, name, description, category, case-insensitive), category chips (`aria-pressed`, plus "All"); sortable table (click headers for id/name/category/weight; `aria-sort`; default weight descending) with inline weight bars; the `derived` rule shows a "derived" tag and the note that it is added when decoding changed the input; charts: `ChartCard` + `BarChart` of rule weights sorted descending coloured by category (legend = 6 categories), `ChartCard` + `StackedBar` "Rules by category" (value = count) and "Points by category" (value = summed weight), and a level-scale `StackedBar` (segments low/medium/high/critical by level tone, marker "Blocked from 25"). Every card supplies a `table`.

- [x] **Step 1: Write failing tests** with `RULES_FIXTURE` (8 rules across the 6 categories including `XSS099` derived, real API shape): row count; search narrows rows and shows an empty result message; category chip filters and `aria-pressed`; header click toggles sort order and `aria-sort`; bar chart has one bar per rule (24-rule fixture variant), colours by category slot consistently across charts; stacked segment values equal per-category counts and weight sums; derived tag; level scale marker at 25; loading skeleton; error + Retry calls reload; `weights` summing above 100 or a rule with weight 0 renders no `NaN`; rule name `<img onerror=x>` rendered literally.
- [x] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Checkpoint:** full `npm test` -> PASS.

### Task 13: Benchmarks page

**Files:**
- Create: `frontend/src/pages/Benchmarks.jsx`, tests; Modify: `routes.js` (`/benchmarks`, title `Benchmarks`, nav `Benchmarks`), `test/fixtures.js` (`BENCHMARK_FIXTURE` from the real numbers in `reports/benchmark.md`: 4 detectors, 8 unseen sources), `styles/pages.js`

**Interfaces:**
- `DETECTOR_SLOTS = { "Hybrid (rules; ML escalates)": 1, "Rules": 2, "ML alone": 3, "Naive hybrid (rules OR ML)": 4 }` (unknown names take slots 5, 6 in order). Page: `useApi("/api/benchmark")` (skeleton; on error show the API's message and that the report can be generated with `python -m xss_detector evaluate`).
- Sections: dataset line ("Held-out test split: N malicious, N benign, N hard negatives" and generated date); KPI `StatTile` row for the shipped detector (Recall, Precision, False-positive rate at 2 digits, F1, Hard-negative FPs as `1/49`); **small multiples**: three `ChartCard`s (Recall, Precision, False-positive rate - "lower is better") each a `BarChart` of the 4 detectors (recall/precision domain `[0,1]`, FPR domain `[0, max]` at 2 digits) with a shared `Legend` above; **unseen-source** `ChartCard` + `GroupedBars` (series Rules recall = slot 2, ML recall = slot 3; group labels without `.txt` plus `(n=<payloads>)`; sorted by ML recall descending; an extra "All lists (weighted)" group); **outcome table** with inline bars for FN and FP (width relative to the column max, CSSOM widths); `<details>` per detector with example misses, false positives and hard false positives as `<code>` text; a caveats callout from `notes`.

- [x] **Step 1: Write failing tests** with the fixture: KPI values (`95.2%`, `100.0%`, `0.00%`, `97.5%`, `1/49`); each small multiple has 4 bars and the same detector always has the same `fill-s<n>` class across the three charts; FPR value labels; grouped chart has 9 groups x 2 bars, sorted order, weighted group present; outcome table numbers and bar widths; example lists render `<` literally and are capped; notes shown; loading; error message includes the evaluate hint; **empty `detectors: []`**, all-zero metrics and `unseen_sources: []` render empty states without `NaN`.
- [x] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Checkpoint:** full `npm test` -> PASS.

### Task 14: Scanner upgrades - gauge, breakdown, history, insights, share

**Files:**
- Create: `frontend/src/lib/history.jsx`, `frontend/src/components/{ScoreBreakdown,SessionInsights,ResultActions}.jsx`, tests
- Modify: `frontend/src/components/ResultPanel.jsx` (`Gauge` replaces `Meter`; adds `ScoreBreakdown` after the chips; new optional `footer` prop rendered when a result exists), `frontend/src/pages/Scanner.jsx`, `styles/pages.js`, `ResultPanel.test.jsx` (replace the meter assertions with gauge assertions), delete `components/Meter.jsx`
- Update the browser script expectations later (Task 17).

**Interfaces:**
- `history.jsx`: `HISTORY_KEY = "xssd-history"`, `MAX_HISTORY = 50`; pure `addEntry(list, entry) -> list` (newest first; consecutive identical `text` replaces instead of duplicating; text truncated to 300 chars; capped at 50, oldest dropped); `HistoryProvider`, `useHistory() -> { entries, add(result, text), clear(), remove(id) }` persisting to `sessionStorage`, guarded; unparseable or non-array stored data -> `[]`. Entry: `{ id, ts, text, score, level, is_malicious }`.
- `ScoreBreakdown({ findings, score })`: `StackedBar` of `{ key: rule_id, label: rule_id, value: weight, slot: CATEGORY_SLOTS[category] }` with markers `Blocked from 25` and (when the weight sum exceeds 100) `Capped at 100`; title "Where the score comes from"; no findings -> "No rules fired." (no chart).
- `SessionInsights({ entries, onRerun(text), onClear })`: card with a `Sparkline` (chronological, last 30, reference at 25 "Blocked from 25"), a level-mix `StackedBar` (counts per level tone), and a history list (newest first, 8 shown, "Show all" expands) with level chip, score, code-styled truncated text, time, and a Re-run button; empty state "Your scans this session will appear here."
- `ResultActions({ result, text })`: buttons "Copy JSON" (`copyText(JSON.stringify(result, null, 2))`) and "Copy share link" (`buildShareUrl(text, location.origin)`; `null` -> error toast "Too long to share"); both toast the outcome; note that shared text appears in the URL.
- `Scanner.jsx`: initial text from `decodeShare(new URLSearchParams(search).get("t"))`; records each completed successful scan of text with `trim().length >= 3` via `useHistory().add`; layout grid: input | result, then insights, then the form. `App` gains `HistoryProvider`.

- [x] **Step 1: Write failing tests:** `addEntry` (newest first, consecutive-duplicate replace, non-consecutive duplicates kept, truncation, cap keeps newest 50, unique ids); provider persistence, **throwing storage**, **garbage stored JSON**, clear/remove; `ScoreBreakdown` (segment widths proportional, sum 95 shows only the 25 marker, sum 130 shows the cap marker and widths scale to 130, empty findings message, category colours); `SessionInsights` (empty state, sparkline points equal entries (max 30), level-mix counts, list order and "Show all", Re-run passes the full stored text, Clear); `ResultActions` (copy JSON content, share link URL, over-long text toast); `ResultPanel` (gauge present with aria label, meter removed, footer slot); `Scanner` page (`?t=` preload fills the input and triggers a scan; **malformed and oversized `?t=` ignored**; a scan is recorded once; Re-run refills and rescans).
- [x] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Checkpoint:** full `npm test` -> PASS.

### Task 15: How it works page

**Files:**
- Create: `frontend/src/data/walkthrough.js`, `frontend/src/pages/HowItWorks.jsx`, tests; Modify: `routes.js` (`/how-it-works`, title `How it works`, nav `How it works`), `styles/pages.js`

**Interfaces:**
- `EXAMPLES` (4): a plain script tag, a URL-encoded script, an HTML-entity-encoded `javascript:` link, and a harmless sentence, each `{ id, label, text }`. Page: example picker (buttons, `aria-pressed`) plus a custom input; uses `useScan(text)`. Three connected steps in a `role="tablist"` (ArrowLeft/ArrowRight/Home/End move selection, `aria-selected`, roving `tabIndex`, each with a `tabpanel`): **1 Normalize** (original text, decoded text, decoding-layers chip, or "no decoding needed"); **2 Match** (`DecodedView` highlights + `Findings` list with hover linking, reused components); **3 Score** (`Gauge`, `ScoreBreakdown`, block/allow verdict, and the level scale). Explanatory copy per step and links to `/rules` and `/benchmarks`. Loading skeleton, error box, empty state before a scan.

- [x] **Step 1: Write failing tests** (mock `post`): choosing an example scans it and fills step 1 with original vs decoded (`%3Cscript%3E...` -> `<script>...`) and the layer chip; step 2 shows marks and findings; step 3 shows the gauge and breakdown; tab keyboard navigation and `aria-selected`; custom input scans; harmless example shows no findings and "allowed"; error and loading states; links present.
- [x] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Checkpoint:** full `npm test` -> PASS.

### Task 16: Home page

**Files:**
- Create: `frontend/src/components/{HeroDemo,FeatureGrid,Reveal}.jsx`, `frontend/src/pages/Home.jsx`, tests; Modify: `routes.js` (`/` now `Home`; the scanner keeps `/scanner`), `styles/pages.js`

**Interfaces:**
- `HeroDemo({ payloads = DEMO_PAYLOADS, typeMs = 35, holdMs = 2500 })`: state machine typing -> scanning -> showing -> next payload. Types char by char; then one `post("/api/scan")` per payload (cached in a `Map`, `AbortController` on unmount); shows level badge, score and the first two finding names; a visible **Pause/Play demo** button (`aria-pressed`) and pause on hover or focus-within; under reduced motion it shows the first payload fully with its result and starts no timers; API failure shows the quiet line "Live results unavailable - is the server running?"; unmount clears timers.
- `Reveal({ children })` wraps content with `useReveal` (class toggle for the fade/slide, visible at once when reduced motion or unsupported). `FeatureGrid`: 6 feature cards (Decoding-aware, 23 weighted rules, ML second opinion, Explainable findings, Honest benchmarks, Zero dependencies) with small inline-SVG icons.
- `Home`: hero (headline, subhead, `HeroDemo`, CTAs to `/scanner` and `/how-it-works`); stat-tile row from `useApi("/api/benchmark")` (shipped Recall, Precision, False-positive rate) and `useApi("/api/health")` (Rules) plus "Payloads tested" (`malicious_test + benign_test + hard_negatives`) with `countUp`; tiles show skeletons while loading and a single muted line if the benchmark is unavailable; feature grid; "Use it in your app" with two `CodeBlock`s (Python library from the README, `curl` for `/api/scan`); closing CTA band.

- [x] **Step 1: Write failing tests:** HeroDemo (fake timers: typing advances one char per `typeMs`; after the last char it posts the full payload once; result shown; after `holdMs` it moves to the next payload; pause stops all progress and Play resumes; hover pauses; reduced motion shows the payload and result at once with no timers; API failure fallback line; unmount clears timers and aborts); Home (stat tiles from fixtures reach final values `95.2%`, `100.0%`, `0.00%`, `23`, `5,405`; skeleton while loading; benchmark 404 hides tiles with the muted line; 6 features; two code blocks with copy; CTA links navigate); Reveal visible without `IntersectionObserver`.
- [x] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Checkpoint:** full `npm test` -> PASS.

### Task 17: Real-browser verification, docs, final checks

**Files:**
- Modify: `frontend/scripts/browser-parity.mjs`, `README.md`; regenerate `xss_detector/static/app.js`

- [x] **Step 1: Extend `browser-parity.mjs`** (keep existing scanner checks, updated: `#score`/gauge instead of `#meter-fill`, the `Scanner` heading): server responses (`fetch` each `PAGES` path = 200, `/nope` = 404 with shell, `/api/rules` 24 rules, `/api/benchmark` 4 detectors); visit every route (`h1` text, no horizontal overflow at 320, 390 and 1280 widths, `aria-current` on the nav link); reload each deep link; the 404 page; theme toggle cycles `system -> light -> dark` setting `data-theme` and survives a reload (and body background matches each theme's token); Rules page: search filters rows, chart bar count equals rule count, real mouse hover over a bar shows a tooltip and moving away hides it, "View as table" swaps content; Benchmarks: 3 x 4 small-multiple bars, 9 x 2 grouped bars, a given detector keeps its colour class in all charts; Scanner: gauge and breakdown after a scan, history count after two scans, `Re-run`, `/scanner?t=<encoded>` preloads the input; How it works: example click fills all three steps and tab keys move selection; Home: hero types then shows a result, Pause stops the typed text changing, stat tiles show final values; no CSP violations, JS exceptions or unexpected console errors; screenshots of every page in light, dark and mobile.
- [x] **Step 2: Build and verify:** `npm run build`; `npm run build:check` output identical to `static/app.js`; record the bundle size (expect roughly 300-350 KB) in the ledger; `npm audit` -> 0 vulnerabilities; `static/` contains only `app.js`.
- [x] **Step 3: Restart the server** (a running one has the old routes) on port 8010 and run `node scripts/browser-parity.mjs` -> all checks PASS. Review every screenshot for layout, chart legibility, label collisions, overflow and both themes; fix and rebuild until clean.
- [x] **Step 4: README:** document the site's pages, the three new endpoints, `reports/benchmark.json` (regenerated by `python -m xss_detector evaluate`), the theme toggle, and that shared scan links put text in the URL.
- [x] **Step 5: Final checkpoint:** `python -m unittest discover -s tests -t .` and `npm test` both PASS; stop the server started in Step 3.
