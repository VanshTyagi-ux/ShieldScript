# React Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-written HTML/CSS/JS scanner page with a React (plain JavaScript) app whose styles live in JavaScript, served by the existing stdlib Python server.

**Architecture:** React source in `frontend/` is bundled by esbuild into the single committed file `xss_detector/static/app.js`. `server.py` generates a tiny HTML shell for `/` and serves only two static paths (`/` and `/app.js`). Styles are one JS string applied via a constructable stylesheet (verified to work under the strict CSP). The API and detector do not change.

**Tech Stack:** React 19.3.0, esbuild 0.28.2, Vitest 5.0.2 + jsdom 30.1.1 + @testing-library/react 16.3.3 / @testing-library/dom 10.4.2 (exact versions, plain JavaScript/JSX), Python `unittest` for the server.

**Spec:** `docs/superpowers/specs/2026-09-28-react-frontend-design.md`

## Global Constraints

- React + **plain JavaScript** (no TypeScript). Bundler is **esbuild** (no Vite). Runtime deps: `react`, `react-dom`. Dev deps: `esbuild`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`. Versions exact-pinned with `package-lock.json`; run `npm audit`.
- `xss_detector/static/` ends up containing **only** `app.js` (no `.html`, no `.css`).
- Styles are a JS string applied with `new CSSStyleSheet().replaceSync(css)` + `document.adoptedStyleSheets`. No `<style>` elements, no `style=` attributes in markup, no external stylesheet or fonts. `style={{ width }}` (CSSOM) is allowed.
- CSP stays `default-src 'self'; frame-ancestors 'none'` (`SECURITY_HEADERS` in `server.py` is not changed).
- No `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval(`, `new Function`, `document.write` in `frontend/src` non-test files (comments included - the guard test is a plain substring scan).
- Server serves exactly two static paths: `/` (generated shell) and `/app.js`. `/style.css` and everything else -> 404. No directory serving.
- Running the project needs only Python: the built `xss_detector/static/app.js` is committed; `node_modules/` is not.
- Browser baseline: Chrome 73+, Firefox 101+, Safari 16.4+; no fallback for older browsers.
- Keep the current element ids and class names (list in Task 4/5/6) so the existing headless-Chrome check and ported CSS keep working.
- The 35 existing backend tests must stay green (`python -m unittest discover -s tests -t .`).
- Spec section 11 defaults (user approved the spec without changing them): baseline accepted; ids kept; a missing bundle only logs a warning at start-up.
- This folder is **not a git repository**: there are no commit steps. Each task ends with a checkpoint step (tests pass).
- Environment: Windows, PowerShell 7 (`&&` works), Node 24, Python 3.12. Frontend commands are run as `npm --prefix frontend <script>`.

## Review Focus

Failure modes the spec implies but does not spell out (each has a test in the named task):

1. Pasting a huge input -> server answers 413 with `{"error": ...}`; the UI must show that error, not spin or crash (Task 2).
2. A proxy/server error with a non-JSON body (e.g. HTML 502) -> `api.post` yields `data: null` and the UI shows "unexpected response" (Tasks 1 and 2).
3. Emoji / astral characters before a match: Python `position` counts code points, JS counts UTF-16 units; the highlight must still land on the right text (Task 1).
4. Double-clicking Submit must send one request, not two (Task 5).
5. A browser without constructable stylesheets must not crash the page (Task 3).

---

## File map

```
frontend/
  package.json  package-lock.json  vitest.config.js  .gitignore
  scripts/browser-parity.mjs                     (Task 8)
  src/
    main.jsx  App.jsx  App.test.jsx  sourceGuard.test.js
    api.js  segments.js  format.js  samples.js  styles.js  applyStyles.js
    hooks/useScan.js
    components/ Scanner  ResultPanel  Verdict  Meter  Chips  Findings  DecodedView  ProtectedForm  (+ .test.jsx each)
xss_detector/server.py            modified (Task 7)
xss_detector/static/app.js        build output (Task 7); index.html + style.css deleted (Task 7)
tests/test_frontend.py            rewritten (Task 7)
README.md                         modified (Task 7)
```

---

### Task 1: Frontend scaffold and pure logic

**Files:**
- Create: `frontend/package.json`, `frontend/vitest.config.js`, `frontend/.gitignore` (`node_modules/`, `.tmp/`)
- Create: `frontend/src/api.js`, `segments.js`, `format.js`, `samples.js`
- Test: `frontend/src/api.test.js`, `segments.test.js`, `format.test.js`

**Interfaces:**
- Produces: `post(url: string, body: object, signal?: AbortSignal) -> Promise<{status: number, ok: boolean, data: object|null}>`
- Produces: `segments(decoded: string, findings: Finding[]) -> Array<{text: string, rules: string[]}>` where `Finding = {rule_id, category, match, position, ...}`
- Produces: `LEVEL_LABEL` (`{safe:"Safe", low:"Low risk", medium:"Medium risk", high:"High risk", critical:"Critical risk"}`), `verdictText(result) -> string`, `announcementFor(result) -> string`
- Produces: `SCANNER_SAMPLES` (`{Attacks: {label: payload}, Harmless: {label: payload}}`), `FORM_SAMPLES` (`{clean: fields, attack: fields}`), copied **verbatim** from `SAMPLES` / `FORM_SAMPLES` in the existing `xss_detector/static/app.js` (kept until Task 7)

- [x] **Step 1: Scaffold.** `package.json` (`"type": "module"`, exact-pinned deps from the header) with scripts: `test` = `vitest run`; `build` = `esbuild src/main.jsx --bundle --minify --jsx=automatic --outfile=../xss_detector/static/app.js`; `build:check` = same but `--outfile=.tmp/app.js`; `dev` = `esbuild src/main.jsx --bundle --jsx=automatic --sourcemap=inline --watch --outfile=../xss_detector/static/app.js`. (esbuild defines `process.env.NODE_ENV` as `"production"` when `--minify` is set.) `vitest.config.js`: `environment: "jsdom"`, `globals: true`, `esbuild: { jsx: "automatic" }`. Run `npm --prefix frontend install`; if a peer-dependency conflict appears, adjust the pinned versions minimally and record the change in the plan file.
- [x] **Step 2: Write failing tests.**
  - `segments.test.js` (all with `decoded` in the example): no findings -> `[{text: decoded, rules: []}]`; `""` -> `[]`; one match: decoded `"<img src=x onerror=alert(1)>"`, finding `{rule_id:"XSS002", category:"markup", match:"onerror=", position:11}` -> `[{text:"<img src=x ",rules:[]},{text:"onerror=",rules:["XSS002"]},{text:"alert(1)>",rules:[]}]`; overlap: `"abcdef"` with A `{match:"abcd",position:0}` and B `{match:"cdef",position:2}` -> `ab[A]`, `cd[A,B]`, `ef[B]`; match not in decoded -> ignored; `category:"evasion"` finding (match `"1 decoding layer(s)"`) ignored; duplicates: `"aa aa"`, match `"aa"`, position 3 -> second occurrence marked; **emoji before match** (Review Focus 3): decoded `"😀😀<img onerror=x>"` with Python-style `position` 2 (code points) and match `"onerror="` -> the `onerror=` text is marked.
  - `api.test.js` (mock `globalThis.fetch`): sends `POST` with `Content-Type: application/json` and the JSON body, forwards `signal`; JSON response -> `{status, ok, data}`; **non-JSON body** (Review Focus 2) with status 502 -> `{status:502, ok:false, data:null}`.
  - `format.test.js`: `verdictText({is_malicious:true})` = `"Potential XSS - would be blocked"`, false -> `"Looks acceptable"`; `announcementFor({level:"critical",score:95,is_malicious:true})` = `"Critical risk, score 95 of 100. Potential XSS - would be blocked."`.
- [x] **Step 3: Run to verify failure.** `npm --prefix frontend test` -> FAIL (modules missing).
- [x] **Step 4: Implement** the four modules with the signatures above. `segments`: for each finding skip `category === "evasion"` or empty `match`; `start = decoded.indexOf(match, position)` (skip if -1); split at every range edge (same algorithm as `renderDecoded` in the existing `app.js`); each segment lists the ids of all ranges covering it, in finding order.
- [x] **Step 5: Checkpoint.** `npm --prefix frontend test` -> all PASS.

---

### Task 2: `useScan` hook

**Files:**
- Create: `frontend/src/hooks/useScan.js`
- Test: `frontend/src/hooks/useScan.test.js` (uses `vi.mock("../api.js")`, `vi.useFakeTimers()`, `renderHook`)

**Interfaces:**
- Consumes: `post` from Task 1.
- Produces: `useScan(text: string, { delay = 200 } = {}) -> { status: "idle"|"loading"|"ok"|"error", result: object|null, error: string|null }`

Behavior to implement: empty `text` -> `{status:"idle", result:null, error:null}`, no request. Non-empty `text` -> status `"loading"` immediately (previous `result` is kept), and after `delay` ms with no further change it calls `post("/api/scan", { text }, signal)`. `ok && typeof data.score === "number"` -> `"ok"` + `result: data`. Otherwise `"error"` with `error = data?.error || "unexpected response"`; a non-abort rejection -> `error = err.message || "server unreachable"`. A newer `text` aborts the previous request (its `signal.aborted` becomes true) and a late response from it never changes state.

- [x] **Step 1: Write failing tests:** debounce (3 changes within 200 ms -> `post` called once, with the last text); empty text -> idle and `post` not called; success -> `status "ok"`, `result.score`; **413 oversized paste** (Review Focus 1): `post` resolves `{status:413, ok:false, data:{error:"Body must be at most 262144 bytes"}}` -> `error` equals that string; **non-JSON error** (Review Focus 2): `{status:502, ok:false, data:null}` -> `error === "unexpected response"`; rejection `new Error("network down")` -> `error === "network down"`; stale response: first request's promise resolves *after* text changed -> `result` still from the second; aborted first request has `signal.aborted === true`; text cleared after a result -> back to idle with `result === null`.
- [x] **Step 2: Run** `npm --prefix frontend test -- src/hooks/useScan.test.js` -> FAIL.
- [x] **Step 3: Implement** `useScan` with `useEffect` keyed on `text`: `setTimeout` + `AbortController` cleanup (cleanup clears the timer and aborts).
- [x] **Step 4: Checkpoint.** Same command -> PASS; then full `npm --prefix frontend test` -> PASS.

---

### Task 3: Styles as JavaScript

**Files:**
- Create: `frontend/src/styles.js`, `frontend/src/applyStyles.js`
- Test: `frontend/src/styles.test.js`

**Interfaces:**
- Produces: named export `STYLES: string`; named export `applyStyles(doc = document) -> boolean` (true if a stylesheet was applied, false if the browser lacks constructable stylesheets).

- [x] **Step 1: Write failing tests.**
  - `STYLES` **equals** the contents of `xss_detector/static/style.css` (read with `fs`, normalise `\r\n` -> `\n`, trim). This proves a verbatim port; **Task 7 deletes this one test together with `style.css`.**
  - `STYLES` contains `prefers-color-scheme: dark`, `@media (min-width: 900px)`, `mark.hit.on`, `prefers-reduced-motion: reduce`, and no `@import` or `url(http`.
  - `applyStyles` with a stubbed `CSSStyleSheet` class (spy `replaceSync`) and `document.adoptedStyleSheets = []`: returns `true`, `replaceSync` called once with `STYLES`, `document.adoptedStyleSheets.length === 1`, `document.querySelectorAll("style").length === 0`.
  - **No constructable stylesheets** (Review Focus 5): with `globalThis.CSSStyleSheet` undefined (and, separately, a stub without `replaceSync`) `applyStyles` returns `false` and does not throw.
- [x] **Step 2: Run** `npm --prefix frontend test -- src/styles.test.js` -> FAIL.
- [x] **Step 3: Implement.** `styles.js`: `export const STYLES = \`...\`` containing the current `style.css` verbatim (it has no backticks or `${`). `applyStyles.js`: feature-detect, build the sheet, `doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]`.
- [x] **Step 4: Checkpoint.** Full `npm --prefix frontend test` -> PASS.

---

### Task 4: Result view components

**Files:**
- Create: `frontend/src/components/Verdict.jsx`, `Meter.jsx`, `Chips.jsx`, `Findings.jsx`, `DecodedView.jsx`, `ResultPanel.jsx`
- Test: `frontend/src/components/ResultPanel.test.jsx`

**Interfaces:**
- Consumes: `segments`, `LEVEL_LABEL`, `verdictText` (Task 1); the `useScan` return shape (Task 2).
- Produces: `ResultPanel({ scan: {status, result, error} })` rendering `<section class="card result-card" aria-labelledby="result-title">` with `<h2 id="result-title">Result</h2>`. Ids and classes to keep from the existing `index.html`/`app.js`: `scan-empty` (`p.empty`), `scan-error` (`div.error-box`, `role="alert"`), `scan-result`, `verdict-box` (`class="verdict border-<level>"`), `level` (`badge level-<level>`), `verdict`, `score`, `meter-fill` (`level-<level>`, width via `style={{ width }}`), `chips`, `findings`, `decoded`, `decoded-note`; findings as `section.group > h4 + ul > li.finding[tabindex=0]` with `.finding-head` (`.rule`, `strong`, optional `.muted` `×N`, `.w` `+weight`), `.wbar > div`, description `.muted`, `code` match.
- Rendering rules (copy from `renderScan`/`renderFindings` in the existing `app.js`): `status==="error"` -> error box `"Could not scan: " + error`; else `result` present -> result view (`aria-busy` true while `status==="loading"`); else empty state text `Type or paste some input, or pick a sample, to see how it scores.` Chips: `encoded: N decoding layer(s)` (pluralise), `ML: 100.0% malicious` (`toFixed(1)`) or `ML model not trained (python -m xss_detector train)` when `ml_probability == null`, then `blocked`/`allowed` (`chip bad`/`chip ok`). Note: `decode_layers ? "N decoding layer(s) removed before scanning." : "Input needed no decoding."`. No findings -> `p.muted` "No indicators found.". `ResultPanel` owns `hoveredRule` state; a finding's mouseenter/focus sets it, mouseleave/blur clears it; `DecodedView` adds class `on` to marks whose rules include it.

- [x] **Step 1: Write failing tests** with this fixture (real API shape): `{score:95, level:"critical", is_malicious:true, decode_layers:0, ml_probability:1.0, decoded:"<img src=x onerror=alert(1)>", findings:[{rule_id:"XSS002",name:"Inline event handler (known)",category:"markup",weight:60,description:"...",match:"onerror=",position:11,count:1},{rule_id:"XSS007",...,category:"markup",weight:15,match:"<img",position:0},{rule_id:"XSS033",...,category:"javascript",weight:20,match:"alert(",position:19}]}`. Assert: text `Critical risk`, `Potential XSS - would be blocked`, `risk score 95/100`; `#meter-fill` has `style.width === "95%"` and class `level-critical`; chips `ML: 100.0% malicious` and `blocked`; 3 `.finding`s under 2 groups (`markup`, `javascript`); 3 `mark` elements with texts `<img`, `onerror=`, `alert(`; hover `XSS002` -> only the `onerror=` mark has class `on`, mouse leave clears, keyboard focus also sets it; `decode_layers:1` -> chip `encoded: 1 decoding layer` and the note; `ml_probability:null` -> "ML model not trained" chip; `findings:[]` -> "No indicators found."; `status:"error"` -> alert text `Could not scan: network down`; `status:"idle"`, `result:null` -> the empty-state text; **rendering safety:** `decoded` = `<img src=x onerror="window.__x=1"><b id=inj>x</b>` produces `container.querySelector("img, #inj, b")` === null and `window.__x` undefined.
- [x] **Step 2: Run** `npm --prefix frontend test -- src/components/ResultPanel.test.jsx` -> FAIL.
- [x] **Step 3: Implement** the six components (`Findings({ findings, onHover })`, `DecodedView({ decoded, findings, hoveredRule })` using `segments`, `Verdict({ result })`, `Meter({ score, level })` with ticks `i.tick.t25/.t50/.t75` and the `p.muted.meter-note` text from the existing HTML, `Chips({ result })`).
- [x] **Step 4: Checkpoint.** Full `npm --prefix frontend test` -> PASS.

---

### Task 5: Scanner input and protected form

**Files:**
- Create: `frontend/src/components/Scanner.jsx`, `ProtectedForm.jsx`
- Test: `frontend/src/components/Scanner.test.jsx`, `ProtectedForm.test.jsx` (the latter uses `vi.mock("../api.js")`)

**Interfaces:**
- Consumes: `SCANNER_SAMPLES`, `FORM_SAMPLES` (Task 1), `post` (Task 1).
- Produces: `Scanner({ text: string, onChange: (text: string) => void })` -> `<section class="card">` with `h2#scanner-title`, `textarea#probe` (rows 6, `spellcheck=false`, placeholder `e.g. <img src=x onerror=alert(1)>`), `button#clear.ghost` "Clear" (empties text and focuses `#probe`), `div#samples` with one `.sample-group` per group (`span.group-label` + `button.sample` per sample, click -> `onChange(payload)`).
- Produces: `ProtectedForm({ onAnnounce: (message: string) => void })` -> `<section class="card wide">`; `form#demo-form` with controlled inputs `#f-name`, `#f-email`, `#f-website`, `#f-comment` (names `name`,`email`,`website`,`comment`), a `span.chip[data-chip=<field>]` per label (hidden until results), `div.err[data-for=<field>]`, `button#submit-btn`, `span#form-samples` (`button.sample` "clean"/"attack" fill all four fields from `FORM_SAMPLES`), and after a submit `div#submit-result.outcome` with `strong#submit-status` (`role="status"`, class `ok`/`bad`) and `div#submit-body`.
- Submit behavior (port `renderOutcome` and the submit handler from the existing `app.js`): `post("/api/submit", {fields:{name,email,website,comment}})`; button disabled + text `Submitting...` while pending; accepted -> status `Accepted (HTTP 200)` and a table `Field | You typed | Stored (HTML-escaped)`; rejected -> `Rejected (HTTP 422)` and a `ul.errors` of `<strong>field: </strong>message`, or `data.error` / `The server rejected the request.` when there are no field errors; chips show `<level> <score>` with class `chip level-<level>`; a thrown error -> status `Could not submit` and body `Server unreachable: <message>`; the button always recovers; `onAnnounce` is called with the status text.

- [x] **Step 1: Write failing tests.**
  - Scanner: typing calls `onChange` with the typed value; clicking `Event handler` calls `onChange("<img src=x onerror=alert(1)>")`; group labels `Attacks` and `Harmless`, 9 sample buttons; Clear calls `onChange("")` and focuses `#probe`.
  - ProtectedForm, rejected (fixture: status 422, `errors:{email:"Invalid email address", website:"Potential XSS detected (high, score 70)", comment:"Potential XSS detected (critical, score 95)"}`, `results` levels safe 0/safe 0/high 70/critical 95): status `Rejected (HTTP 422)`, three inline `.err` texts, chips `critical 95` and `high 70`, list of three errors, `onAnnounce("Rejected (HTTP 422)")`.
  - Accepted (status 200, `sanitized.comment:"5 &lt; 10."` for typed `5 < 10.`): status `Accepted (HTTP 200)`, table cells show typed `5 < 10.` and stored `5 &lt; 10.` **as literal text**; typed `<b>&amp;</b>` renders no `b` element.
  - Pending state: button disabled with text `Submitting...`, then `Submit` after resolve. **Double submit** (Review Focus 4): two rapid `fireEvent.submit` calls before the first resolves -> `post` called exactly once.
  - Network error: `post` rejects `new Error("network down")` -> `Could not submit`, `Server unreachable: network down`, button re-enabled.
  - Sample buttons fill all four inputs (`attack` -> `#f-name` value `Mallory`).
- [x] **Step 2: Run** the two test files -> FAIL.
- [x] **Step 3: Implement** both components (controlled inputs via `useState`; guard double submit with the pending state and a ref).
- [x] **Step 4: Checkpoint.** Full `npm --prefix frontend test` -> PASS.

---

### Task 6: App, entry point, source guard, build check

**Files:**
- Create: `frontend/src/App.jsx`, `frontend/src/main.jsx`
- Test: `frontend/src/App.test.jsx`, `frontend/src/sourceGuard.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: `App()` rendering `<header><h1>XSS Detector</h1><p>Rule-based detection of malicious script injection in user input, with an ML second opinion.</p></header>`, `<div id="announce" class="sr-only" aria-live="polite">`, `<main>` with `Scanner`, `ResultPanel`, `ProtectedForm`. `App` owns `text` state, calls `useScan(text)`, and sets the announcement with `announcementFor(result)` when a scan reaches `ok`; `ProtectedForm`'s `onAnnounce` sets it too. `main.jsx`: `applyStyles()` then `createRoot(document.getElementById("root")).render(<App />)`.

- [x] **Step 1: Write failing tests.** `App.test.jsx` (`vi.mock("./api.js")` for `post`, fake timers): clicking sample `Event handler` then advancing 250 ms shows `Critical risk` and sets `#announce` to `Critical risk, score 95 of 100. Potential XSS - would be blocked.`; clearing input returns to the empty state; typing then quickly typing again renders only the latest result. `sourceGuard.test.js`: reads every non-test `.js`/`.jsx` under `frontend/src` and asserts none contains `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval(`, `new Function`, `document.write`.
- [x] **Step 2: Run** those two files -> FAIL.
- [x] **Step 3: Implement** `App.jsx` and `main.jsx`.
- [x] **Step 4: Verify the bundle builds without touching `static/`.** `npm --prefix frontend run build:check` -> exit 0, `frontend/.tmp/app.js` exists, `node --check frontend/.tmp/app.js` passes, size under 300 KB, and the file contains no `"development"` NODE_ENV branch messages (search for `Download the React DevTools` -> absent).
- [x] **Step 5: Checkpoint.** Full `npm --prefix frontend test` -> PASS.

---

### Task 7: Cutover - server shell, bundle, removals, docs

**Files:**
- Modify: `xss_detector/server.py` (replace `STATIC_FILES` and the `do_GET` static handling; add `SHELL_HTML`, `check_bundle`; call `check_bundle()` at the start of `serve()`)
- Rewrite: `tests/test_frontend.py`
- Delete: `xss_detector/static/index.html`, `xss_detector/static/style.css`; overwrite `xss_detector/static/app.js` with the build output
- Delete: the verbatim-port test in `frontend/src/styles.test.js` (it reads `style.css`)
- Modify: `README.md`

**Interfaces:**
- Produces: `SHELL_HTML: bytes` (UTF-8): `<!doctype html>`, `<html lang="en">`, `<meta charset="utf-8">`, viewport meta, `<title>XSS Detector</title>`, `<noscript>This page needs JavaScript.</noscript>`, `<div id="root"></div>`, `<script src="/app.js"></script>`. `check_bundle() -> bool`: `(STATIC / "app.js").is_file()`; logs `WARNING` (logger `xss_detector.server`) `frontend bundle missing: run "npm run build" in frontend/` when false.
- Routes (`do_GET`, path split at `?`): `/` -> `SHELL_HTML` as `text/html; charset=utf-8`; `/app.js` -> `STATIC / "app.js"` as `text/javascript; charset=utf-8`, or `404 {"error": "Frontend bundle not built; run npm run build in frontend/"}` if missing; anything else -> existing `404 {"error": "Not found"}`. `SECURITY_HEADERS` apply to all as today. First `grep -rn STATIC_FILES` to confirm nothing else uses the removed name.

- [x] **Step 1: Rewrite `tests/test_frontend.py`** (keep the `_Tags` HTML-parser helper and a per-class server fixture): `test_root_serves_generated_shell` (200, `text/html`, CSP header contains `default-src 'self'`, body contains `<title>XSS Detector</title>`, `<div id="root"></div>`, `<script src="/app.js"></script>`, `<noscript>`); `test_root_with_query_string_serves_shell` (`/?x=1`); `test_shell_is_csp_clean` (`_Tags`: no inline script, no `<style>`, no `style`/`on*` attributes); `test_app_js_is_served` (200, `text/javascript`, non-empty); `test_removed_and_unknown_paths_are_404` for `/style.css`, `/index.html`, `/assets/app.js`, `/static/app.js`, `/../server.py`, `/%2e%2e/server.py`; `test_missing_bundle_gives_json_404_but_shell_still_served` (`unittest.mock.patch("xss_detector.server.STATIC", <empty temp dir>)` -> `/app.js` is 404 with a JSON `error`, `/` still 200); `test_check_bundle_warns_when_missing` (`assertLogs("xss_detector.server", "WARNING")`, returns `False`; and `True` when present); `test_static_dir_contains_only_the_bundle` (`sorted(p.name for p in STATIC.iterdir() if p.is_file()) == ["app.js"]`).
- [x] **Step 2: Run** `python -m unittest tests.test_frontend` -> FAIL (old routes, old files still present).
- [x] **Step 3: Implement the `server.py` changes** as specified above.
- [x] **Step 4: Build the bundle and remove old files.** Delete the verbatim-port test from `styles.test.js` first, then `npm --prefix frontend run build` (writes `xss_detector/static/app.js`), then delete `static/index.html` and `static/style.css`.
- [x] **Step 5: README.** Replace the static-UI mentions: Quick start gains `cd frontend && npm install && npm run build` (only needed to change the UI), `npm run dev`, `npm test`; the Layout block shows `frontend/` (source) and `xss_detector/static/app.js` (built bundle, committed); add the browser baseline (Chrome 73+, Firefox 101+, Safari 16.4+) and a note to rebuild after editing `frontend/src`.
- [x] **Step 6: Checkpoint.** `python -m unittest discover -s tests -t .` -> all PASS (35 existing + rewritten frontend tests); `npm --prefix frontend test` -> PASS.

---

### Task 8: Real-browser parity and audit

**Files:**
- Create: `frontend/scripts/browser-parity.mjs` (adapted from the earlier headless-Chrome script: `C:\Users\VANSHT~1\AppData\Local\Temp\claude\C--Users-Vansh-Tyagi-HCL-Cyber\64494ae5-5369-4db1-8bf0-faf2a10d970b\scratchpad\drive.mjs`; if it is no longer there, rewrite it from the checks below)

**Interfaces:**
- Consumes: the running server (base URL from env `BASE_URL`, default `http://127.0.0.1:8010`), Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` (env `CHROME` overrides), the ids listed in Tasks 4-5.

Adaptations required for React: set input/textarea values with the native setter (`Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, v)`, and the `HTMLInputElement` equivalent) then `el.dispatchEvent(new Event("input", { bubbles: true }))`; submit via `#submit-btn` click (not `requestSubmit`); print `Log.entryAdded` entries and fail if any mentions `Content Security Policy`.

- [x] **Step 1: Stop any old server** (one may still be running on port 8000 from an earlier session, serving the old route table), then start a fresh `python -m xss_detector serve --port 8010`.
- [x] **Step 2: Run** `node frontend/scripts/browser-parity.mjs` (screenshots to a scratch directory) and confirm it reports the parity values previously observed: initial empty state, groups `Attacks`/`Harmless` with 9 sample buttons and 2 form-sample buttons; `Event handler` -> `Critical risk`, `95%` fill, chips `ML: 100.0% malicious` + `blocked`, marks `<img`, `onerror=`, `alert(`, hover highlights only `onerror=`; `URL-encoded` -> chip `encoded: 1 decoding layer` and decoded `<script>alert(1)</script>`; `Plain text` -> `Safe` / `Looks acceptable` / `No indicators found.`; markup typed into the input -> `pwned` false and 0 injected nodes; rapid retyping ends on the last result; Clear -> empty state; form `attack` -> `Rejected (HTTP 422)` with chips `website:high 70`, `comment:critical 95`; form `clean` -> `Accepted (HTTP 200)` and the typed/stored table; a failing `fetch` -> `Could not scan: network down` and `Could not submit` with the button re-enabled; no horizontal overflow at 390 px; **no CSP violations and no JS exceptions** (only the `favicon.ico` 404 and the intentional 422 are acceptable).
- [x] **Step 3: Review the light, dark and mobile screenshots** against the redesigned vanilla page (layout, chips readable, outcome beside the form at 1280 px). Fix any CSS-port defect in `styles.js`, rebuild, and re-run.
- [x] **Step 4: Audit.** `npm --prefix frontend audit` -> report the result (fix or document anything at moderate or higher); confirm `frontend/package-lock.json` exists and `xss_detector/static/` contains only `app.js`.
- [x] **Step 5: Final checkpoint.** `python -m unittest discover -s tests -t .` and `npm --prefix frontend test` both PASS; stop the server started in Step 1.
