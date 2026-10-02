# Scan History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every scan in a SQLite file and show it on a new History page with filter, paging, CSV/JSON export and clear.

**Architecture:** A new `xss_detector/store.py` (`ScanStore`, standard-library `sqlite3`, one locked connection) is created by `HardenedServer` when `store_enabled(config, host)` is true, mirroring how `live_feed` is gated. `Handler._scan` and `Handler._submit` write rows; three new routes read, export and clear them. A new React page `History.jsx` with a `useHistory` hook consumes the routes, and the route is left out of the FastAPI-backend build exactly like `/live`.

**Tech Stack:** Python 3.10+ standard library only (`sqlite3`, `csv`, `json`), React 19 + Vitest (existing), `unittest` (existing).

**Spec:** `docs/superpowers/specs/2026-10-01-scan-history-design.md`

## Global Constraints

- Python standard library only. No new Python or npm dependency.
- Row text cut to **1,000** characters. Row cap **10,000**, oldest dropped first. Typing collapse window **3 seconds**.
- `GET /api/history`: `filter` in `all|blocked|allowed` (default `all`), `limit` 1..100 (default 25), `offset` >= 0 (default 0). Bad value: 400 `{"error": ...}`. Rate-limit cost **0.25**. Export cost **1.0**.
- `GET /api/history/export?format=csv|json` (format required). Download names `scriptshield-history.csv` / `scriptshield-history.json`. CSV is UTF-8 **with a BOM**; cells in `source`, `field`, `text` starting with `=`, `+`, `-`, `@`, tab or CR get a leading `'`. Export when storing is off: 404 `{"error": "History is off"}`.
- `POST /api/history/clear` needs `Content-Type: application/json` (415 otherwise) and returns `{"cleared": n}` (0 when off).
- Settings: `STORE_SCANS` = `auto|1|0` (default `auto` = loopback binds only, like `live_feed_enabled`), `SCAN_DB` = file path (default `scans.db` in the project root, git-ignored).
- A storage failure (cannot open the file at start-up, or a write error mid-request) is logged as a warning and never fails a scan.
- All stored text is untrusted: the page renders it as text only. Nav label `History`, placed after `Live`, absent from the `backendPages` build.
- Page texts (verbatim): empty `No scans stored yet. Try the Scanner.`; off `Saving scans is off on this server. It is on by default only for local runs; set STORE_SCANS=1 to turn it on.`; clear confirm label `Click again to confirm` (reverts after 4 seconds).
- Styles use the existing `--space-*` tokens (the style tests enforce the spacing grid).
- The working tree already has unrelated uncommitted changes and the user has asked for commits only on request. **Commit steps: skip unless the user has told you to commit, and then `git add` only the files named in the step.** Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. CSV export of text containing commas, quotes, newlines and unicode must round-trip through `csv.reader` (Task 2).
2. Inputs at the boundaries: text of exactly 1,000 and 1,001 characters; a request body near the 256 KiB limit is stored cut, not rejected (Tasks 2, 3).
3. Many threads scanning at once must not raise `sqlite3` threading or "database is locked" errors (Task 2).
4. `offset` past the end returns no items with a correct `total`; `limit=0`, `limit=101`, `offset=-1`, non-numbers and unknown filters are 400 (Task 4).
5. An unusable `SCAN_DB` path (directory that does not exist) must not stop the server starting; History then reports `enabled: false` (Task 3).

---

### Task 1: Settings

**Files:**
- Modify: `xss_detector/config.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Produces: `Config.store_scans: str = "auto"`, `Config.scan_db: str = ""`, `store_enabled(config: Config, host: str) -> bool`, `resolve_scan_db(config: Config) -> Path`, `DEFAULT_SCAN_DB: Path` (project root / `scans.db`).

- [ ] **Step 1: Write the failing tests** in `tests/test_config.py` (match the existing live-feed tests):
  - `test_store_scans_defaults_to_auto_and_rejects_other_values`: `Config().store_scans == "auto"`; `Config.from_env({"STORE_SCANS": "1"}).store_scans == "1"`; `{"STORE_SCANS": "maybe"}` raises `ConfigError` whose text contains `STORE_SCANS`.
  - `test_store_enabled_rules`: true for hosts `127.0.0.1`, `localhost`, `::1` with `Config()`; false for `0.0.0.0` with `Config()`; true for `Config(store_scans="1")` on `0.0.0.0`; false for `Config(store_scans="0")` on `127.0.0.1`.
  - `test_scan_db_defaults_to_the_project_root_and_env_overrides`: `Config().scan_db == ""`; `resolve_scan_db(Config()) == DEFAULT_SCAN_DB` and `DEFAULT_SCAN_DB.name == "scans.db"`; `Config.from_env({"SCAN_DB": "x/y.db"}).scan_db == "x/y.db"`; `resolve_scan_db(Config(scan_db="x/y.db")) == Path("x/y.db")`.
- [ ] **Step 2: Run** `python -m unittest tests.test_config -v`. Expected: the three new tests FAIL (ImportError / AttributeError).
- [ ] **Step 3: Implement** the two fields, the two `from_env` reads (`STORE_SCANS` via `_choice(v, ("auto", "1", "0"))`, `SCAN_DB` via `_nonempty`), and the three functions above in `xss_detector/config.py`, following `live_feed_enabled`.
- [ ] **Step 4: Run** `python -m unittest tests.test_config -v`. Expected: all PASS.
- [ ] **Step 5: Commit** `xss_detector/config.py tests/test_config.py` with message `Add STORE_SCANS and SCAN_DB settings`.

---

### Task 2: ScanStore and CSV formatting

**Files:**
- Create: `xss_detector/store.py`
- Test: `tests/test_store.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (all in `xss_detector/store.py`):
  - `MAX_TEXT = 1000`, `MAX_ROWS = 10_000`, `COLLAPSE_SECONDS = 3.0`, `FILTERS = ("all", "blocked", "allowed")`, `CSV_COLUMNS = ["id","ts","source","field","text","blocked","score","level","rules","ml_probability","decode_layers"]`.
  - `class ScanStore(path: str | Path, max_rows: int = MAX_ROWS, clock: Callable[[], float] = time.time)`
  - `ScanStore.add(*, source: str | None, field: str, text: str, blocked: bool, score: int, level: str, rules: list[str], ml_probability: float | None, decode_layers: int) -> None`
  - `ScanStore.page(filter: str = "all", limit: int = 25, offset: int = 0) -> dict` returning `{"items": [row], "total": int, "counts": {"all": int, "blocked": int, "allowed": int}}`; raises `ValueError` for an unknown filter. A `row` is a dict with exactly the keys of `CSV_COLUMNS`: `blocked` a bool, `rules` a list of str, `source` `""` when none, `ts` UTC ISO with milliseconds.
  - `ScanStore.export_rows() -> list[dict]` (all rows, newest first, same row shape), `ScanStore.clear() -> int`, `ScanStore.close() -> None`.
  - `to_csv(rows: list[dict]) -> str` (BOM first, header row, `rules` joined by spaces, `blocked` as `true`/`false`, `ml_probability` empty when None, formula neutralisation on `source`, `field`, `text`).

- [ ] **Step 1: Write the failing tests** in `tests/test_store.py` (use a temp directory and a fake clock object whose `now` attribute the tests set; a helper `add(store, text, **over)` with defaults `source=None, field="text", blocked=False, score=0, level="safe", rules=[], ml_probability=None, decode_layers=0`):
  - `test_rows_come_back_newest_first_with_the_documented_shape`: three adds with clock +10 s apart and non-prefix texts; `page()["items"][0]["text"]` is the last added; `set(row) == set(CSV_COLUMNS)`; `row["blocked"] is True` for a blocked add; `row["rules"] == ["XSS002"]`; `row["source"] == ""` when added with `None`.
  - `test_filter_counts_and_unknown_filter`: 2 blocked + 3 allowed rows; `page("blocked")["total"] == 2`; `page("allowed")["total"] == 3`; `counts == {"all": 5, "blocked": 2, "allowed": 3}`; `page("bogus")` raises `ValueError`.
  - `test_paging_and_offset_past_the_end`: 30 rows; `limit=25, offset=25` gives 5 items; `offset=100` gives `items == []` and `total == 30`.
  - `test_text_is_cut_to_1000_characters`: 1,000 `"a"` stays 1,000 long; 1,001 `"a"` is stored as 1,000.
  - `test_typing_collapse`: with the same source and field: add `"<im"` at t=0, `"<img"` at t=2, `"<img s"` at t=4.5 (2.5 s after the replaced row, so still inside the window) and `total == 1` with the row's text `"<img s"`; then `"<img src"` at t=20 (outside the window) adds a second row; identical text (same source and field) is dropped; a different `field`, a different `source`, or text that is not an extension each add a new row.
  - `test_row_cap_drops_the_oldest`: `ScanStore(path, max_rows=5)`; add 8 non-prefix texts 10 s apart; `total == 5`; the 3 oldest texts are gone.
  - `test_clear_returns_the_count_and_empties`: `clear() == 3` then `page()["total"] == 0`.
  - `test_rows_survive_reopening_the_file`: add, `close()`, open a new `ScanStore` on the same path, `total` unchanged.
  - `test_many_threads_can_add_at_once`: 20 threads x 10 adds of zero-padded distinct texts (`f"{i:02d}-{j:02d}"`, same width so none is a prefix of another); no exception; `total == 200`.
  - `test_to_csv_neutralises_formulas`: for texts `"=1+1"`, `"+x"`, `"-x"`, `"@x"`, `"\tx"`, `"\rx"` the parsed cell starts with `'`; the same applies to `source` and `field`; `"hello"` is unchanged.
  - `test_to_csv_round_trips_awkward_text`: text `'a,b "q"\nline2 é☃'` parsed back with `csv.reader` equals the original; output starts with `"﻿"`; header row equals `",".join(CSV_COLUMNS)`; `rules` cell is `"XSS002 XSS033"`; `blocked` cell `"true"`; `ml_probability` cell empty for None.
- [ ] **Step 2: Run** `python -m unittest tests.test_store -v`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `ScanStore` and `to_csv` in `xss_detector/store.py`.** One `sqlite3.connect(path, check_same_thread=False)` guarded by a `threading.Lock`; table `scans(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, source TEXT, field TEXT, text TEXT, blocked INTEGER, score INTEGER, level TEXT, rules TEXT, ml_probability REAL, decode_layers INTEGER)` created if missing. In `add`: look at the newest row; if same `source` and `field` and `text` equal, return; if its `ts` (parse with `datetime.fromisoformat`; `ts` is built from `clock()`) is within `COLLAPSE_SECONDS` and the new text starts with the old text, `UPDATE` that row instead of inserting; otherwise insert, then delete rows older than the newest `max_rows` ids. `rules` is stored as a JSON string. Use the `csv` module for output.
- [ ] **Step 4: Run** `python -m unittest tests.test_store -v`. Expected: all PASS.
- [ ] **Step 5: Commit** `xss_detector/store.py tests/test_store.py` with message `Add ScanStore: SQLite scan history with typing collapse and CSV export`.

---

### Task 3: Write rows from the server

**Files:**
- Modify: `xss_detector/server.py` (`HardenedServer.__init__` near line 183, its `server_close`, `Handler._scan`, `Handler._submit`)
- Modify: `tests/helpers.py` (isolate the database per test server)
- Test: `tests/test_history_api.py` (new)

**Interfaces:**
- Consumes: `store_enabled`, `resolve_scan_db` (Task 1); `ScanStore` (Task 2).
- Produces: `HardenedServer.store: ScanStore | None` (`None` when storing is off or the file could not be opened); `Handler._store(source: str | None, scanned: Mapping[str, tuple[str, dict]]) -> None` (same shape as `_record`; swallows and logs any exception).

- [ ] **Step 1: Isolate test servers.** In `tests/helpers.py`, make `start(config, **kwargs)` replace an empty `config.scan_db` with a file inside a `tempfile.TemporaryDirectory(ignore_cleanup_errors=True)` (use `dataclasses.replace`), keep the directory on the server as `httpd.scan_tmpdir`, and have `ServerTestCase.serve` call `httpd.scan_tmpdir.cleanup()` after `server_close()`. Run `python -m unittest discover -s tests -t .` once to confirm nothing else changed and no `scans.db` appears in the project root.
- [ ] **Step 2: Write the failing tests** in `tests/test_history_api.py` (`ATTACK = "<img src=x onerror=alert(1)>"`; use `start(Config())` to get `httpd` and read `httpd.store.page()` directly):
  - `test_scan_stores_one_row_per_field_whatever_the_source`: scan `{"fields": {"name": "Ada", "comment": ATTACK}}` with no source, then again with `"source": "dummy-site"` and different text; rows have fields `name` and `comment`, the comment row `blocked` is True and `rules` contains `"XSS002"`, `source` is `""` then `"dummy-site"`.
  - `test_scan_text_row_records_field_text_decode_layers_and_ml`: scan `"%3Cscript%3Ealert(1)%3C/script%3E"`; the row has `field == "text"`, `decode_layers >= 1`, `"XSS001"` in `rules`, `ml_probability` a float.
  - `test_submit_stores_rows_with_an_empty_source`: POST `/api/submit` with fields `name`, `comment=ATTACK`; status 422; two rows, the comment row blocked, both `source == ""`.
  - `test_requests_that_fail_validation_store_nothing`: a 400 for a bad `source` and a 400 for a missing `text` leave `total == 0`.
  - `test_a_storage_failure_does_not_fail_the_scan`: replace `httpd.store.add` with a function that raises `RuntimeError`; the scan returns 200 with the normal body.
  - `test_long_input_is_stored_cut`: scan 200,000 `"a"`; response 200; the stored row's `text` has length 1,000.
  - `test_storing_is_off_by_default_on_a_public_bind`: `start(Config(), host="0.0.0.0")` gives `httpd.store is None` and a scan still returns 200; `Config(store_scans="1")` on `0.0.0.0` gives a store; `Config(store_scans="0")` on loopback gives `None`.
  - `test_an_unusable_database_path_leaves_storing_off`: `Config(scan_db=<tmp>/missing-dir/x.db)` starts fine, `httpd.store is None`, a scan returns 200.
  - `test_typing_in_the_scanner_collapses_to_one_row`: POST `"<img"` then `"<img src=x"` back to back; `total == 1` and the row's text is `"<img src=x"`.
- [ ] **Step 3: Run** `python -m unittest tests.test_history_api -v`. Expected: FAIL (no `store` attribute).
- [ ] **Step 4: Implement** in `xss_detector/server.py`: in `HardenedServer.__init__`, `self.store = None`, then if `store_enabled(config, address[0])` try `ScanStore(resolve_scan_db(config))` and on any exception `log.warning(...)`; close the store in `server_close`. Add `Handler._store` and call it from `_scan` (single text: field `"text"`; `fields`: one per field; pass the request's `source` or `None`) and from `_submit` using `payload["results"]` with `source=None`. Rows use `result["is_malicious"]`, `score`, `level`, `[f["rule_id"] for f in result["findings"]]`, `result.get("ml_probability")`, `result.get("decode_layers", 0)`.
- [ ] **Step 5: Run** `python -m unittest tests.test_history_api tests.test_events_api tests.test_server -v`. Expected: all PASS (existing live-feed behaviour unchanged).
- [ ] **Step 6: Commit** `xss_detector/server.py tests/helpers.py tests/test_history_api.py` with message `Store every scan from /api/scan and /api/submit`.

---

### Task 4: History routes

**Files:**
- Modify: `xss_detector/server.py` (`API_COSTS`, `PAGES`, `do_GET`, `do_POST`, new `_history`, `_history_export`, `_history_clear`)
- Modify: `tests/test_history_api.py` (append)
- Test: `tests/test_site.py` (loops `PAGES`; run, do not edit unless it asserts the list)

**Interfaces:**
- Consumes: `HardenedServer.store` and `ScanStore.page / export_rows / clear` and `to_csv` (Tasks 2, 3).
- Produces: `GET /api/history`, `GET /api/history/export`, `POST /api/history/clear` as in Global Constraints; `"/history"` added to `PAGES`; response of `/api/history`: `{"enabled": bool, "items": [...], "total": int, "counts": {"all": int, "blocked": int, "allowed": int}}`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_history_api.py`; seed rows through `call(base, "/api/scan", ...)` with non-prefix texts):
  - `test_history_lists_newest_first_with_totals`: 3 scans; 200; `enabled` True; `items[0]` is the last scan; `total == 3`; `counts` sums correctly.
  - `test_history_filter_limit_and_offset`: `?filter=blocked`, `?filter=allowed`, `?limit=2&offset=2`; `?offset=100` gives `items == []` and the real `total`.
  - `test_history_rejects_bad_parameters`: `filter=maybe`, `limit=0`, `limit=101`, `limit=x`, `offset=-1`, `offset=x` each give 400 with an `"error"` key.
  - `test_history_when_storing_is_off`: public bind with default config; 200 and exactly `{"enabled": False, "items": [], "total": 0, "counts": {"all": 0, "blocked": 0, "allowed": 0}}`.
  - `test_export_csv_and_json`: `?format=csv` gives 200, `Content-Type` starting `text/csv`, `Content-Disposition` equal to `attachment; filename="scriptshield-history.csv"`, body starting with `b"\xef\xbb\xbf"` and one data line per row; `?format=json` gives `application/json`, filename `scriptshield-history.json`, and a JSON list of rows; a missing or other `format` is 400.
  - `test_export_csv_neutralises_a_formula_payload`: scan `"=cmd|' /C calc'!A0"`; the exported cell starts with `'`.
  - `test_export_when_off_is_404`: public bind; 404 with `{"error": "History is off"}`.
  - `test_clear_empties_the_history`: POST `/api/history/clear` with `{}` returns `{"cleared": 3}`, then history `total == 0`.
  - `test_clear_requires_a_json_content_type`: a `text/plain` POST returns 415 and nothing is deleted; on a public bind a JSON clear returns `{"cleared": 0}`.
  - `test_history_routes_have_the_documented_costs_and_the_page_exists`: `API_COSTS[("GET", "/api/history")] == 0.25`, `API_COSTS[("GET", "/api/history/export")] == 1.0`; `GET /history` returns the app shell with 200.
- [ ] **Step 2: Run** `python -m unittest tests.test_history_api -v`. Expected: the new tests FAIL (404s).
- [ ] **Step 3: Implement the routes** in `xss_detector/server.py` with signatures `_history(self) -> None`, `_history_export(self) -> None`, `_history_clear(self) -> None`; parse the query with `urllib.parse.parse_qs(self.path.partition("?")[2])` (the existing `route` strips the query, so read it from `self.path`); raise `BadRequest(400, ...)` for invalid values; send downloads with `_send(..., extra_headers={"Content-Disposition": ...})`; copy the content-type check from `_clear_events`; add `"/api/history/clear"` to the POST allow-list and `"/history"` to `PAGES`.
- [ ] **Step 4: Run** `python -m unittest discover -s tests -t .`. Expected: all PASS.
- [ ] **Step 5: Commit** `xss_detector/server.py tests/test_history_api.py` with message `Add /api/history, export and clear`.

---

### Task 5: History page and hook

**Files:**
- Create: `frontend/src/lib/useHistory.js`, `frontend/src/pages/History.jsx`
- Modify: `frontend/src/styles/pages.js` (toolbar and pager styles only)
- Test: `frontend/src/lib/useHistory.test.js`, `frontend/src/pages/History.test.jsx`

**Interfaces:**
- Consumes: the three routes from Task 4 through `get`/`post` in `frontend/src/api.js` and `apiUrl`; `PageHeading`, `.table-wrap`, `.chip`, `.stat-grid`, `.card`, `.live-table` classes already in use by `Live.jsx` (read it as the model).
- Produces: `useHistory({ filter, page }) -> { status: "loading"|"ok"|"error", data, error, reload, clear }` where `data` is the `/api/history` response, page size `25` (exported as `PAGE_SIZE`), and `clear()` POSTs `/history/clear` with `{}` then reloads; `export function HistoryPage()`.

- [ ] **Step 1: Write the failing hook tests** in `useHistory.test.js` (mock `../api.js`):
  - `test_requests_the_filter_and_page`: `useHistory({ filter: "blocked", page: 1 })` calls `get` with `/history?filter=blocked&limit=25&offset=25`.
  - `test_reports_an_error_and_keeps_the_last_data`: a rejected second request sets `status === "error"` and keeps the first `data`.
  - `test_clear_posts_then_reloads`: `clear()` calls `post("/history/clear", {})` and then `get` again.
- [ ] **Step 2: Write the failing page tests** in `History.test.jsx` (mock `../lib/useHistory.js` as `Live.test.jsx` mocks `useEvents`; a row fixture `{id: 1, ts: "2026-10-01T04:10:53.123+00:00", source: "blog", field: "comment", text: ATTACK, blocked: true, score: 95, level: "critical", rules: ["XSS002", "XSS033"], ml_probability: 1, decode_layers: 0}`):
  - `has a single h1` with text `History`.
  - `shows loading`, `shows the error with a Retry button that calls reload`, `shows the off message verbatim` (`enabled: false`), `shows the empty message verbatim` (`items: []`, `counts.all` 0).
  - `shows the counters and a row`: counters read total/blocked/allowed from `counts`; the row shows `04:10:53`, `blog`, `comment`, a `Blocked` chip, `95 critical`, `XSS002 XSS033`, and the text.
  - `shows markup as text`: the input cell's `textContent` equals `<img src=x onerror=alert(1)>` and `document.querySelector("img")` is null.
  - `filter and paging`: clicking `Blocked` makes `useHistory` last be called with `{ filter: "blocked", page: 0 }`; with `total: 60`, `Next` moves to `{ page: 1 }`, `Previous` is disabled on page 0, and changing the filter resets to page 0.
  - `export links`: `Export CSV` href ends with `/history/export?format=csv`, `Export JSON` with `format=json`.
  - `Refresh calls reload`.
  - `clear needs two clicks`: first click changes the label to `Click again to confirm` and does not call `clear`; the second calls it once; with fake timers the label reverts after 4,000 ms; the button is disabled when `counts.all` is 0.
- [ ] **Step 3: Run** `cd frontend; npx vitest run src/lib/useHistory.test.js src/pages/History.test.jsx`. Expected: FAIL (modules not found).
- [ ] **Step 4: Implement `useHistory` and `HistoryPage`**, modelled on `useEvents.js` (state shape, abort on change) and `Live.jsx` (table, chips, `timeOf` as `ts.slice(11, 19)`); render every stored string as a React text child. Add only token-based rules (`var(--space-*)`) for the toolbar and pager to `styles/pages.js`.
- [ ] **Step 5: Run** the same command. Expected: all PASS. Then run `npx vitest run src/styles.test.js`. Expected: PASS.
- [ ] **Step 6: Commit** the five files above with message `Add the History page`.

---

### Task 6: Wire up, document, verify

**Files:**
- Modify: `frontend/src/routes.js`, `frontend/src/data/apiDocs.js`, `frontend/src/routes.test.js`, any frontend test whose expectations count routes, nav items or endpoints (find them by running the suite), `.gitignore`, `README.md`, `xss_detector/static/app.js` (rebuilt)

**Interfaces:**
- Consumes: `HistoryPage` (Task 5).
- Produces: route `{ path: "/history", title: "History", nav: "History", component: HistoryPage }` right after `/live`, inside the same `backendPages ? [] : [...]` guard (or an equivalent second guard); three `builtinOnly` endpoint entries with ids `history`, `history-export`, `history-clear`.

- [ ] **Step 1: Update the tests first.** In `routes.test.js` the built-in build's path list becomes `["/", "/scanner", "/live", "/history", "/how-it-works", "/rules", "/benchmarks", "/api-docs", "/about"]`; add a test that `buildRoutes(true)` has no `/history` and `buildRoutes(false).find(r => r.path === "/history")` matches `{ title: "History", nav: "History" }`. Add API docs tests: `endpointsFor(false)` includes the three ids and `endpointsFor(true)` includes none of them.
- [ ] **Step 2: Run** `cd frontend; npx vitest run`. Expected: the new/updated tests FAIL.
- [ ] **Step 3: Implement** the route and the three docs entries (copy the shape and tone of the `events` / `events-clear` entries; example responses use the row shape from the spec).
- [ ] **Step 4: Run** `npx vitest run` and fix any other expectation that counts routes, nav links or endpoints. Expected: all PASS.
- [ ] **Step 5: Docs and ignore.** Add `scans.db` and `scans.db-journal` to `.gitignore`. In `README.md` add a "Scan history" section: what is stored, `STORE_SCANS` and `SCAN_DB`, the local-only default and why, the three endpoints, the 1,000-character cut, the 10,000-row cap, and the typing-collapse behaviour (including that it can merge two real scans typed within 3 seconds).
- [ ] **Step 6: Rebuild and run everything.** `cd frontend; npm run build` (rewrites `xss_detector/static/app.js`), then `npx vitest run` and from the project root `python -m unittest discover -s tests -t .`. Expected: both PASS.
- [ ] **Step 7: Manual check of the spec's five success criteria.** Start `python -m xss_detector serve`; (1) scan an attack on the Scanner and see it on History; (2) stop and restart the server and see it still listed; (3) Export CSV after scanning `=1+1` and confirm the cell starts with `'`; (4) Clear history twice-click and see the empty state; (5) `$env:HOST="0.0.0.0"; python -m xss_detector serve` shows the "off" message. Delete `scans.db` afterwards and confirm `git status` does not list it.
- [ ] **Step 8: Commit** the files from this task with message `Wire up the History page, document scan history, rebuild the bundle`.
