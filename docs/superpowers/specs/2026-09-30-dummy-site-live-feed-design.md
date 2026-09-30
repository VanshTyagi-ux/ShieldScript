# Dummy site connected to the detector, with a live detections feed

Date: 2026-09-30. Status: awaiting review.

## Goal

Show the detector protecting a separate web app, and let an evaluator watch it work. A dummy blog (port 8001)
sends every input to the main site's detector (port 8000) over HTTP. The main site shows what was scanned and
blocked, live, on a new `/live` page.

Success: an attack typed into the dummy site's protected mode is rejected there, and appears on the main site's
`/live` page within about 2 seconds, with its score and the rules that fired.

Audience: an evaluator watching a demo on one machine. Everything is local.

## Non-goals

Authentication, saving events across restarts, WebSockets or server-sent events (polling is enough), Burp Suite or
DVWA integration, changes to the detector's rules or scoring, and any change to the Docker/Render deployment shape.

## Architecture

```
 browser --> dummy site :8001  --POST /api/scan {fields, source}-->  main site :8000
              vulnerable | protected                                   detector.scan()
              (comments, search)   <-- scan results --------------     records events (ring buffer)
                                                                        GET /api/events
 browser --> main site :8000/live  (polls /api/events every 2 s)  <-----
```

The dummy site is a client of the main site, like any other application. It no longer imports the detector.

## Components

### 1. Dummy site (`xss_detector/demo.py`)

- Keeps `/vulnerable` and `/protected`. Each page now has two inputs:
  - the existing **comment board** (name, comment): stored XSS;
  - a new **search box** (`q`): reflected XSS. The page echoes `You searched for: <q>`.
- **Vulnerable mode** is unchanged in spirit: raw interpolation, fake script-readable cookie, no detector call.
  The search echo is raw too. It stays deliberately insecure and clearly labelled.
- **Protected mode** sends the submitted fields to the main site in one `POST /api/scan` with
  `{"fields": {...}, "source": "dummy-site"}`. If any field is malicious, the input is rejected (comment: HTTP 422
  with the existing "Rejected" card; search: the results page shows the rejection instead of echoing). Otherwise
  output is HTML-escaped as today. The existing CSP on protected pages stays.
- Main site address: env `DETECTOR_URL`, default `http://127.0.0.1:8000`. A `--detector-url` flag on
  `python -m xss_detector demo` overrides it. Requests use `urllib` with a 3 s timeout (standard library only).
- **Fail closed.** If the main site is unreachable, times out, or returns a non-200/invalid answer, protected mode
  rejects the input and shows "Detector unavailable, input not accepted" (HTTP 503). It never lets input through
  unscanned and never falls back to a local detector.
- The demo home page shows whether the main site is reachable (one health check on page load) and links to `/live`.
- The dummy site's own `HybridDetector` import and the local `detector.scan` call are removed.

### 2. Recording events (`xss_detector/events.py`, new; wired in `server.py`)

- `EventLog`: a thread-safe ring buffer (`collections.deque(maxlen=100)`) with `add(event)` and `snapshot()`
  (newest first) and a monotonically increasing `id` per event.
- Event shape (JSON):
  `{"id": int, "ts": ISO-8601 UTC, "source": str, "field": str, "blocked": bool, "score": int, "level": str,
  "rules": [rule ids], "text": str (first 200 characters)}`.
- `POST /api/scan` accepts an optional top-level `source` string, in both `text` and `fields` modes:
  - validated as 1 to 40 characters of `[a-z0-9-]`; anything else is HTTP 400 `"'source' must be 1-40 lowercase
    letters, digits or hyphens"`;
  - when present (and the feed is enabled), one event is recorded per scanned field (`field` is the key in
    `fields` mode, `"text"` in `text` mode);
  - when absent, behaviour and response are exactly as today. The Scanner page sends no `source`, so its
    scan-as-you-type calls never appear in the feed.
  - The scan response body is unchanged.
- `GET /api/events` returns `{"events": [...], "enabled": true}`, newest first, at most 100. It is a cheap read
  (rate-limit cost 0.25, like `/api/rules`).

### 3. Feed switch (`config.py`)

- New setting `LIVE_FEED` with values `auto` (default), `1`, `0`. `auto` means on only when the server's host is a
  loopback address (`127.0.0.1`, `localhost`, `::1`).
- Why: on Render or in Docker the host is `0.0.0.0` and the site is public. There, anyone could read what others
  submitted with a `source`. So the feed is off by default outside loopback and must be turned on deliberately.
- When off: `source` is accepted and ignored, nothing is recorded, and `GET /api/events` returns
  `{"events": [], "enabled": false}`.

### 4. `/live` page (React, `frontend/src/pages/Live.jsx`, route in `routes.js`, nav link)

- Polls `GET /api/events` every 2 s while the tab is visible and stops when it is hidden. A failed poll shows an
  inline "Can't reach the server" note and keeps the last table.
- Top: counters (scanned, blocked, allowed) and the most-triggered rules, computed from the events in view.
- Below: a table, newest first: time, source, field, verdict (blocked or allowed), score and level, rules, input
  text. There is a "View as table" pattern consistent with the other charts, and keyboard-reachable rows.
- Empty state: "Nothing yet. Start the dummy site with `python -m xss_detector demo` and use its protected pages."
  Disabled state (`enabled: false`): "The live feed is off on this server (it is on by default only for local
  runs; set `LIVE_FEED=1` to enable)."
- All event text is rendered as plain text. `dangerouslySetInnerHTML` stays banned (an existing test enforces it).
- The Render bundle (`VITE_BACKEND_PAGES=false`) includes `/live`, since it only needs the main server's own API.

## Data flow (protected comment)

1. Visitor posts a comment on the dummy site's `/protected`.
2. The dummy site calls `POST :8000/api/scan {"fields":{"name":..,"comment":..},"source":"dummy-site"}`.
3. The main site scans both fields and records two events, then returns the results.
4. The dummy site rejects (422 + reasons) or stores and escapes the comment.
5. `/live` polls, and both events appear, blocked ones highlighted.

## Errors and edge cases

- Main site down or slow: dummy protected mode fails closed (503 message); vulnerable mode is unaffected.
- Main site rate limit (60 per minute sustained, burst 20): a rejected call (HTTP 429) is treated as "detector
  unavailable" and fails closed. One comment costs one call.
- Very long input: the dummy site already caps fields at 2,000 characters; events keep only 200.
- Concurrent use: `EventLog` is guarded by a lock.
- Feed disabled: everything else works, and `/live` explains why it is empty.

## Security notes

- The feed deliberately stores user input text (200 characters) in memory. The README says request bodies are
  never logged. The feed is an explicit exception, limited to calls that pass `source`, kept in memory only, and
  off by default on non-loopback hosts. The README will say so.
- The dummy site stays bound to `127.0.0.1` and labelled "demo only". The vulnerable mode is intentional.
- The main site's CSP (`default-src 'self'`) is unchanged: the dummy site talks to it server-to-server, so no CORS
  is needed and none is added.

## Testing (test-first)

- `tests/test_events.py`: buffer size cap, ordering, thread safety, event shape, 200-character truncation.
- `tests/test_server.py` additions: `/api/scan` with and without `source` (response unchanged, events recorded only
  when present), `source` validation errors, `/api/events`, `LIVE_FEED` auto/1/0 and the disabled response.
- `tests/test_config.py`: `LIVE_FEED` parsing and the loopback rule.
- `tests/test_demo.py`: start a real main-site server and a real dummy site on free ports. Assert that a benign
  and a malicious comment and search behave correctly in protected mode, that events appear on the main site,
  that vulnerable mode is untouched, and that stopping the main site makes protected mode return 503.
- `frontend/src/pages/Live.test.jsx`: polling, counters, empty, disabled and error states, plain-text rendering
  of hostile event text, and paused polling when hidden. Existing route and nav tests updated.
- Full suites (Python, backend, frontend), `npm audit`, and a fresh `npm run build` with the committed bundle
  matching, before finishing.

## Documentation

README: a new "Dummy site and live feed" section (how to start both servers, the `LIVE_FEED` and `DETECTOR_URL`
settings, the privacy note), the API table gains `/api/events` and the `source` field, and the layout list gains
`events.py`. The About page and the API docs page (`apiDocs.js`) get matching entries. The benchmark is unaffected.

## Out of scope for this spec, possible later

Persisting events, a clear-feed button, WebSockets, and a script that replays DVWA or Burp traffic through the
scanner.
