# Dummy Site and Live Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dummy blog (port 8001) that sends every protected-mode input to the main site's detector over HTTP, and a `/live` page on the main site (port 8000) that shows those scans as they happen.

**Architecture:** The dummy site (`demo.py`) becomes a client of `POST /api/scan` and stops importing the detector. The main server records an event per scanned field into an in-memory ring buffer when the request carries a `source`, and serves it at `GET /api/events`. A new React page polls that endpoint every 2 s. The feed is on by default only on loopback hosts.

**Tech Stack:** Python 3.12 standard library only (`http.server`, `urllib`), React 19 with plain JavaScript, Vitest, unittest, esbuild (committed bundle).

**Spec:** `docs/superpowers/specs/2026-09-30-dummy-site-live-feed-design.md`

## Global Constraints

- Python core stays standard-library only; no new dependencies in `requirements.txt` or `package.json`.
- `source` is 1 to 40 characters of `[a-z0-9-]`; otherwise HTTP 400 `'source' must be 1-40 lowercase letters, digits or hyphens`.
- Ring buffer holds 100 events; event `text` is the first 200 characters; events are newest first.
- Event shape: `{"id": int, "ts": ISO-8601 UTC, "source": str, "field": str, "blocked": bool, "score": int, "level": str, "rules": [str], "text": str}`.
- `GET /api/events` returns `{"events": [...], "enabled": bool}` with rate-limit cost 0.25.
- `LIVE_FEED` is `auto` (default: on only when the bind host is `127.0.0.1`, `localhost` or `::1`), `1` or `0`. When off, `source` is accepted and ignored and nothing is recorded.
- Dummy site: env `DETECTOR_URL` default `http://127.0.0.1:8000`; flag `--detector-url`; 3 s timeout; **fails closed** (HTTP 503, "Detector unavailable, input not accepted") on any error including a 429; never falls back to a local detector; stays bound to `127.0.0.1`.
- The main site's CSP and CORS are unchanged. The UI renders event text as plain text; `dangerouslySetInnerHTML` stays banned.
- The frontend bundle `xss_detector/static/app.js` is committed and must match `npm --prefix frontend run build`.

## Review Focus

- `source` that is empty, too long, not a string, or has uppercase/space: 400, the input is not scanned, no event recorded (Task 2).
- Event text with `<script>` and with more than 200 multi-byte characters: truncated by characters, shown as plain text (Tasks 1 and 4).
- Main site answers 200 but with malformed JSON or a missing field result: the dummy site fails closed (Task 3).
- Empty search query `q=`: no scan call, no event; attack in `q`: blocked and never echoed unescaped (Task 3).
- `LIVE_FEED=0`: `/api/scan` with `source` still returns the same body, `/api/events` says `enabled: false`; `/live` shows the disabled note (Tasks 2 and 4).

---

### Task 1: EventLog and the `LIVE_FEED` setting

**Files:**
- Create: `xss_detector/events.py`, `tests/test_events.py`
- Modify: `xss_detector/config.py`, `tests/test_config.py`

**Interfaces:**
- Produces: `MAX_TEXT = 200`; `class EventLog(maxlen: int = 100)` with `add(*, source: str, field: str, blocked: bool, score: int, level: str, rules: list[str], text: str) -> dict` (assigns `id` from 1 upward and `ts` as UTC ISO-8601 with milliseconds, truncates `text` to 200 characters, returns the stored event) and `snapshot() -> list[dict]` (newest first, a copy).
- Produces: `Config.live_feed: str = "auto"` read from env `LIVE_FEED` (choices `auto`, `1`, `0`, else `ConfigError`); `LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})`; `live_feed_enabled(config: Config, host: str) -> bool`.

- [ ] **Step 1: Write failing tests** in `tests/test_events.py`: `test_add_assigns_increasing_ids_starting_at_one`, `test_snapshot_is_newest_first_and_a_copy`, `test_buffer_keeps_only_the_last_100`, `test_text_is_cut_to_200_characters_not_bytes` (250 × `"é"` gives a 200-character text), `test_event_has_exactly_the_documented_keys`, `test_concurrent_adds_lose_nothing` (8 threads × 50 adds into `EventLog(maxlen=1000)` gives 400 unique ids). In `tests/test_config.py`: `test_live_feed_defaults_to_auto`, `test_live_feed_rejects_other_values` (`LIVE_FEED=maybe` raises `ConfigError` naming `LIVE_FEED`), `test_live_feed_enabled_rules` (`auto` is true for each loopback host and false for `0.0.0.0`; `1` is true for `0.0.0.0`; `0` is false for `127.0.0.1`).
- [ ] **Step 2: Run** `python -m unittest tests.test_events tests.test_config` -> FAIL (module and setting missing).
- [ ] **Step 3: Implement** `EventLog` with a `deque(maxlen)` guarded by a `threading.Lock`, and the config field, parsing (reuse `_choice`) and `live_feed_enabled`.
- [ ] **Step 4: Run** the same command -> PASS.
- [ ] **Step 5: Commit** `git add xss_detector/events.py xss_detector/config.py tests && git commit -m "Add EventLog and LIVE_FEED setting"`.

### Task 2: Server records events and serves `/api/events`

**Files:**
- Modify: `xss_detector/server.py` (`PAGES`, `API_COSTS`, `HardenedServer.__init__`, `Handler.do_GET`, `Handler._scan`)
- Create: `tests/test_events_api.py`
- Test: `tests/test_site.py` (existing test that walks `PAGES` must still pass)

**Interfaces:**
- Consumes: `EventLog`, `live_feed_enabled` from Task 1.
- Produces: `HardenedServer.events: EventLog` and `HardenedServer.live_feed: bool` (computed from `config` and the actual bound host, `address[0]`); `"/live"` in `PAGES`; `("GET", "/api/events"): 0.25` in `API_COSTS`; `Handler._source(data: dict) -> str | None` raising `BadRequest(400, ...)`.

- [ ] **Step 1: Write failing tests** in `tests/test_events_api.py` using `tests.helpers.start(Config())` and `call`: `test_scan_without_source_records_nothing_and_body_is_unchanged`, `test_scan_fields_with_source_records_one_event_per_field` (fields `name`, `comment`; assert keys, `blocked`, `rules`, `source`), `test_scan_text_with_source_records_field_text`, `test_events_are_newest_first_and_capped_at_100`, `test_invalid_source_is_400_and_nothing_is_scanned_or_recorded` (subtests: `""`, 41 characters, `"Dummy"`, `"a b"`, `5`, `["x"]`), `test_events_text_is_cut_to_200_characters`, `test_live_feed_off_ignores_source_and_reports_disabled` (`Config(live_feed="0")`; scan body equals the no-source body; `/api/events` gives `{"events": [], "enabled": false}`), `test_server_live_feed_follows_the_setting_on_a_loopback_bind` (`httpd.live_feed` is true for `auto` and `1`, false for `0`; the non-loopback rule itself is covered in Task 1, so no test binds `0.0.0.0`), `test_live_page_serves_the_app_shell`. Rate limit: `test_events_endpoint_costs_a_quarter_token`.
- [ ] **Step 2: Run** `python -m unittest tests.test_events_api` -> FAIL.
- [ ] **Step 3: Implement.** Validate `source` first (before scanning) with `re.fullmatch(r"[a-z0-9-]{1,40}", value)`; after scanning, when `self.server.live_feed` and `source` is set, add one event per field from the scan result (`rules` = each finding's `rule_id`, `blocked` = `is_malicious`). Add `/api/events` to `do_GET`. Response bodies of `/api/scan` must not change.
- [ ] **Step 4: Run** `python -m unittest tests.test_events_api tests.test_site tests.test_hardening` -> PASS.
- [ ] **Step 5: Commit** `git add xss_detector/server.py tests && git commit -m "Record scan events and serve /api/events"`.

### Task 3: Dummy site uses the main site's detector

**Files:**
- Modify: `xss_detector/demo.py`, `xss_detector/cli.py` (demo subcommand), `tests/test_demo.py`

**Interfaces:**
- Consumes: `POST /api/scan` with `{"fields": {...}, "source": "dummy-site"}` and `GET /api/health` from Task 2.
- Produces: `DEFAULT_DETECTOR_URL = "http://127.0.0.1:8000"`; `class DetectorUnavailable(Exception)`; `scan_via_api(base_url: str, fields: dict[str, str], *, source: str = "dummy-site", timeout: float = 3.0) -> dict[str, dict]` (raises `DetectorUnavailable` on connection error, timeout, any non-200 status, invalid JSON, or a `results` object missing a requested field or lacking a boolean `is_malicious`); `detector_status(base_url: str, timeout: float = 1.0) -> bool`; `serve(host="127.0.0.1", port=8001, detector_url: str | None = None)` (argument, else env `DETECTOR_URL`, else default; stored as `httpd.detector_url`, which `Handler` reads with `getattr(self.server, "detector_url", DEFAULT_DETECTOR_URL)`); CLI `demo --detector-url URL`.

- [ ] **Step 1: Rewrite the fixture in `tests/test_demo.py`:** `setUpClass` starts a real main site with `tests.helpers.start(Config())` and the demo `ThreadingHTTPServer` with `httpd.detector_url = main_base`. Keep the existing tests (they must still pass unchanged). Add: `test_protected_comment_scan_goes_through_the_main_site` (an attack shows up in `GET main/api/events` with `source == "dummy-site"` and `blocked` true), `test_benign_protected_comment_is_recorded_as_allowed`, `test_search_vulnerable_echoes_raw_query`, `test_search_protected_blocks_attack_and_never_echoes_it_raw` (422, contains "Rejected", no raw payload, CSP header present), `test_search_protected_escapes_benign_query` (`5 < 10` becomes `5 &lt; 10`), `test_empty_search_makes_no_scan_and_no_event`, `test_protected_fails_closed_when_the_main_site_is_down` (demo pointed at a closed port: comment and search both return 503 with "Detector unavailable, input not accepted", and nothing is stored), `test_protected_fails_closed_on_malformed_detector_answer` (a tiny stub `ThreadingHTTPServer` returns 200 `{"results": {}}` and then 200 `not json`; both give 503), `test_scan_via_api_rejects_429_as_unavailable` (stub returns 429), `test_home_shows_detector_status_and_link_to_live` (reachable and unreachable). Assert vulnerable mode makes no scan call (no new events after posting to `/vulnerable/comment`).
- [ ] **Step 2: Run** `python -m unittest tests.test_demo` -> FAIL.
- [ ] **Step 3: Implement** `scan_via_api` and `detector_status` with `urllib.request`; remove the `HybridDetector` import and module-level `detector`. Add `GET /{mode}/search?q=` (vulnerable echoes raw, protected scans `{"q": q}` only when non-empty, blocks with the existing "Rejected" card, otherwise echoes escaped) and a search form on each board page. A `DetectorUnavailable` in protected mode renders the 503 card. Keep the vulnerable-mode HTML unsafe on purpose.
- [ ] **Step 4: Wire the CLI flag** and pass it to `serve`.
- [ ] **Step 5: Run** `python -m unittest tests.test_demo` then the full Python suite `python -m unittest discover -s tests -t .` -> PASS.
- [ ] **Step 6: Commit** `git add xss_detector/demo.py xss_detector/cli.py tests/test_demo.py && git commit -m "Dummy site scans through the main site's API, adds search, fails closed"`.

### Task 4: `/live` page

**Files:**
- Create: `frontend/src/lib/useEvents.js`, `frontend/src/lib/liveSummary.js`, `frontend/src/pages/Live.jsx`, and tests `useEvents.test.js`, `liveSummary.test.js`, `Live.test.jsx` beside them
- Modify: `frontend/src/routes.js`, `frontend/src/routes.test.js`, `frontend/src/data/apiDocs.js` (and its test), the existing styles module for the table (follow the Rules table classes)

**Interfaces:**
- Consumes: `GET /events` via `get(path, signal)` from `api.js` (base `/api`, so `/api/events`).
- Produces: `useEvents({ interval = 2000 }) -> { status: "loading" | "ok" | "error", events: Event[], enabled: boolean, error: string | null }` (polls with `AbortController`, pauses while `document.hidden`, keeps the last events after a failed poll); `summarize(events) -> { scanned, blocked, allowed, topRules: { rule: string, count: number }[] }` (top 5, ties by rule id); `LivePage`; route `{ path: "/live", title: "Live feed", nav: "Live", component: LivePage }` placed after `/scanner`.

- [ ] **Step 1: Write failing tests.** `liveSummary.test.js`: counts, top-5 cap, tie order, empty input. `useEvents.test.js` (fake timers): polls every 2000 ms, stops on unmount, pauses while hidden and polls again on becoming visible, keeps the last events after a failed poll and sets `error`, a 404 (FastAPI dev backend) gives `status: "error"`. `Live.test.jsx` (mock `useEvents`): empty state text mentions `python -m xss_detector demo`; disabled state text mentions `LIVE_FEED=1`; error note "Can't reach the server" keeps the table; rows show time, source, field, verdict, score and level, rules and text; **event text `<script>alert(1)</script>` renders as text and creates no `script` element**; counters and top rules; single `h1`. `routes.test.js`: `/live` in every build, nav label `Live`. `apiDocs` test: `/events` documented.
- [ ] **Step 2: Run** `npm --prefix frontend test` -> the new tests FAIL.
- [ ] **Step 3: Implement** the hook, `summarize` and the page (verdict shown as text plus a tag, not colour alone; rows reachable by keyboard); add the route, the API docs entry for `GET /events` (with a `source` note on `POST /scan`), and styles.
- [ ] **Step 4: Run** `npm --prefix frontend test` -> all PASS, then `npm --prefix frontend run build`.
- [ ] **Step 5: Run** `python -m unittest discover -s tests -t .` (the bundle and site tests) -> PASS.
- [ ] **Step 6: Commit** `git add frontend xss_detector/static/app.js && git commit -m "Add the /live page"`.

### Task 5: Docs and end-to-end check

**Files:**
- Modify: `README.md`, `frontend/src/pages/About.jsx` (privacy note), rebuilt `xss_detector/static/app.js`

- [ ] **Step 1: README:** a "Dummy site and live feed" section (start both servers, `DETECTOR_URL`, `--detector-url`, `LIVE_FEED`, the privacy note that the feed keeps 200 characters of input in memory only for calls that pass `source`, and is off by default outside loopback); add `/live` to the site table, `GET /api/events` and the `source` field to the API table, `events.py` to the layout list. About page: one limitation/privacy line. Rebuild the bundle.
- [ ] **Step 2: Full verification:** `python -m unittest discover -s tests -t .`, `backend/.venv/Scripts/python -m unittest discover -s backend/tests -t backend`, `npm --prefix frontend test`, `npm --prefix frontend audit`, then `npm --prefix frontend run build` followed by `git diff --exit-code xss_detector/static/app.js`. Expected: all pass, audit 0 vulnerabilities, no diff.
- [ ] **Step 3: End-to-end run:** start `python -m xss_detector serve` and `python -m xss_detector demo`; post the "Steal cookie" sample to `/protected/comment` and a benign comment; `curl http://127.0.0.1:8000/api/events` shows both with the right `blocked` values; open `/live` in a browser and confirm they appear within 2 s; stop the main site and confirm a protected post returns the 503 message; stop both servers.
- [ ] **Step 4: Commit** `git add -A && git commit -m "Document the dummy site and live feed"`.
