# Scan history: store every tested payload and show it on a History page

Date: 2026-10-01. Status: awaiting review.

## Goal

Keep the result of every scan permanently, so a demo can show "everything that was tested" with its verdict, score
and rules, and the list is still there after the server restarts.

Success, checked by hand on one machine:

1. Scan an attack on the Scanner page. It appears on the new History page with its verdict, score and rules.
2. Restart the server. The scan is still listed.
3. Export CSV. The attack text is neutralised so a spreadsheet cannot run it as a formula.
4. Clear history. The list is empty.
5. Start the server on a public address (`HOST=0.0.0.0`). Storing is off by default and the page says so.

Audience: an evaluator or the author running a demo on one machine.

## Non-goals

Accounts or per-user history, editing stored rows, free-text search, charts, retention beyond a row cap, changes to
the FastAPI backend in `backend/`, and any change to the Live feed or the Scanner page's per-tab history (both stay
as they are). No change to detector rules or scoring.

## What is stored

One row per scanned field, for every scan, whatever sent it: the Scanner page, the protected form, the dummy
blog, or a direct API call. Fields, matching what the detector already returns:

| Column | Meaning |
|---|---|
| `id` | auto-increment, newest has the highest id |
| `ts` | UTC ISO time, millisecond precision |
| `source` | the request's optional `source` name, or empty |
| `field` | `text` for a single-text scan, otherwise the field name |
| `text` | the input, cut to 1,000 characters |
| `blocked` | 1 or 0 (`is_malicious`) |
| `score`, `level` | rule score 0-100 and its level |
| `rules` | rule ids that fired, as a JSON list |
| `ml_probability` | 0-1, or null when no model is loaded |
| `decode_layers` | number of decoding layers removed |

**Typing collapse.** The Scanner scans again each time the user pauses while typing. To keep the history readable,
a new scan replaces the previous row instead of adding one when it has the same `source` and `field`, arrives
within 3 seconds, and its text starts with the previous row's text (the user is still typing). A scan with the same
`source`, `field` and text as the previous row is dropped. Anything else is a new row.

**Opting out.** `POST /api/scan` takes an optional boolean `store` (default true; any other value is a 400). `false` keeps
that scan out of the history. The Home page's auto-playing demo sends it, so History shows only what a person tested.
(Added after review.)

**Row cap.** At most 10,000 rows. After each insert the oldest rows beyond the cap are deleted.

## Where and when it runs

- Storage is a SQLite file using Python's built-in `sqlite3`, so the project stays "standard library only".
  Default path: `scans.db` in the project root, added to `.gitignore`. Override with `SCAN_DB`.
- **Privacy.** Stored input is real user data. Like the live feed, storing is on by default only when the server
  binds a loopback address. `STORE_SCANS=1` forces it on, `STORE_SCANS=0` forces it off, `auto` is the default.
  Implemented as `store_enabled(config, host)` next to `live_feed_enabled`.
- **Failure never breaks a scan.** If the database cannot be opened at start-up, the server logs a warning and runs
  with storing off. If a write fails during a request, it logs a warning and the scan still returns normally.

## API (built-in server only)

All three routes are served only by `xss_detector/server.py`, like `/api/events`.

- `GET /api/history?filter=all|blocked|allowed&limit=1..100&offset=0`
  Defaults: `filter=all`, `limit=25`, `offset=0`. Newest first. Response:
  `{"enabled": true, "items": [row, ...], "total": <rows matching filter>, "counts": {"all": n, "blocked": n, "allowed": n}}`.
  `rules` is a list in the response. When storing is off: `{"enabled": false, "items": [], "total": 0, "counts": {all/blocked/allowed: 0}}`.
  A bad parameter is a 400 with `{"error": ...}`. Rate-limit cost 0.25.
- `GET /api/history/export?format=csv|json`
  Returns every stored row as a download (`Content-Disposition: attachment`, file name `scriptshield-history.csv` or
  `.json`). CSV is UTF-8 with a byte-order mark, header row first, `rules` joined by spaces. **Formula safety:** any
  `source`, `field` or `text` cell that starts with `=`, `+`, `-`, `@`, tab or carriage return gets a leading `'`.
  When storing is off: 404 `{"error": "History is off"}`. Rate-limit cost 1.0.
- `POST /api/history/clear`
  Deletes all rows and returns `{"cleared": n}` (0 when storing is off). Requires `Content-Type: application/json`,
  for the same reason as `/api/events/clear`: a cross-site form cannot send it without a preflight, and this server
  sends no CORS headers.

Rows are written from `_scan` (single text and `fields`) and `_submit`. `_submit` has no `source`, so its rows have an
empty one. The live feed keeps its own in-memory log and its "only when a source is named" rule.

## New "History" page (frontend)

- Route `/history`, nav label "History", placed after "Live" and, like Live, left out of the build that targets
  the FastAPI backend (`backendPages`), because the API exists only on the built-in server.
- Header counters: total, blocked, allowed (from `counts`).
- A filter (All, Blocked, Allowed), then a table: time (UTC), source, field, verdict chip, score and level, rules,
  input. Page size 25 with Previous and Next.
- Buttons: Refresh, Export CSV, Export JSON (links to the export route), and Clear history. Clear is two steps: the
  first click changes the label to "Click again to confirm", a second click within 4 seconds clears.
- Loads on open and on filter, page and Refresh. No polling; the Live page already covers real time.
- States: loading, error (message plus Retry), empty ("No scans stored yet. Try the Scanner."), and off ("Saving
  scans is off on this server. It is on by default only for local runs; set `STORE_SCANS=1` to turn it on.").
- **All stored text is untrusted attack input, so it is only ever rendered as text, never as HTML.**
- The API docs page lists the three new endpoints, marked as built-in-server only like `/events`.

## Components and files

| File | Change |
|---|---|
| `xss_detector/store.py` (new) | `ScanStore`: `add(...)` with typing collapse and cap, `page(filter, limit, offset)`, `counts()`, `export_rows()`, `clear()`. One connection with a lock, so the threaded server can share it. |
| `xss_detector/config.py` | `store_scans` and `scan_db` settings, `STORE_SCANS` and `SCAN_DB` env vars, `store_enabled(...)` |
| `xss_detector/server.py` | create the store at start-up, `_store(...)` called from `_scan` and `_submit`, three routes, rate-limit costs, `/history` in `PAGES` |
| `frontend/src/pages/History.jsx` (new), `frontend/src/lib/useHistory.js` (new) | the page and its data hook |
| `frontend/src/routes.js`, `frontend/src/data/apiDocs.js`, `frontend/src/styles/*` | route and nav entry, API docs entries, small style additions |
| `.gitignore`, `README.md` | ignore `scans.db`; document the setting, the privacy default and the endpoints |

## Testing

- `tests/test_store.py`: insert and read back, newest-first order, filter and counts, paging, text cut to 1,000
  characters, typing collapse (prefix within 3 s replaces; different text or later than 3 s adds; identical is
  dropped), row cap, clear, export formula neutralisation, survives re-opening the file.
- `tests/test_server.py` additions: `/api/scan` and `/api/submit` store rows; history, export and clear routes;
  `enabled: false` shape and the 404 on export when off; clear needs a JSON content type; a failing store does not
  fail a scan; `store_enabled` is true on loopback and false on `0.0.0.0` by default; `STORE_SCANS` overrides it.
- Frontend tests: History page for loading, error, empty, off and populated states; filter and paging requests;
  two-step clear; text with markup is shown as text; route and nav entry present, and absent in the backend build.
- Update existing tests that count routes or nav items. All existing suites must still pass.

## Risks and decisions

- **Stored input is sensitive.** Mitigated by the local-only default, the 1,000-character cut, the row cap, and a
  Clear button. This is the main reason storing is not on by default for public servers.
- **Concurrency.** The server is threaded; one SQLite connection guarded by a lock is enough at this scale.
- **Formula injection** in CSV opened in a spreadsheet is handled by the leading `'` rule above.
- **Typing collapse is a heuristic.** It can occasionally merge two real scans that are within 3 seconds and one is a
  prefix of the other. That is acceptable for a demo history and is documented in the README.
