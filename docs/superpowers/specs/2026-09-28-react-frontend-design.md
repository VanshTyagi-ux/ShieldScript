# React frontend (JavaScript, no HTML/CSS files) - design

Status: draft for review (2026-09-28)

## 1. Intent

Rewrite the scanner UI as a **React application in plain JavaScript**. The hand-written `index.html`,
`style.css` and `app.js` in `xss_detector/static/` are removed: React components render all markup, and
styling is written in JavaScript. The rewrite keeps today's behaviour and look (the redesigned vanilla page
is the parity reference) and leaves the API and detector untouched.

**Success criteria**
1. Everything the current page does still works (parity checklist, section 8).
2. `xss_detector/static/` contains no `.html` or `.css` file.
3. The server's strict CSP (`default-src 'self'; frame-ancestors 'none'`) is not weakened.
4. Running the project still needs only Python: the built bundle is committed.
5. No untrusted text is ever parsed as HTML (`dangerouslySetInnerHTML` is banned).

**Decisions already made with the user:** React + plain JavaScript (not TypeScript); no HTML or CSS
files; styles as a JS string applied through a constructable stylesheet ("option 1"); Node is required to
*develop* the frontend but not to run the project.

## 2. Scope

In scope: `frontend/` source project, esbuild bundling into one file, server change to serve a generated
page shell plus that bundle, JS-based styles, component and server tests, README section, browser check.

Out of scope: TypeScript, routing library, state library, SSR, CSS framework, Vite, the rich-text editor
tab (a later second view, see `2026-09-28-richtext-sanitizer-design.md` section 7), backend/API changes.

## 3. Verified facts that shape the design

Probed in headless Chrome against a throwaway page sent with `Content-Security-Policy: default-src 'self'`
(2026-09-28):

| Technique | Result under that CSP |
|---|---|
| `new CSSStyleSheet().replaceSync(css)` + `document.adoptedStyleSheets` | **Applied**, including `@media (prefers-color-scheme: dark)` |
| `<style>` element injected by script | **Blocked** (CSP violation logged) - rules out emotion / styled-components |
| `element.style.width = "50%"` (CSSOM; what React's `style={{...}}` does) | **Applied** |

Browser baseline that follows: constructable stylesheets need Chrome 73+, Firefox 101+, Safari 16.4+.
There is deliberately no fallback (a `<style>` fallback would be blocked by the CSP); on older browsers the
page would render unstyled but usable, and the README states the baseline.

## 4. Structure

```
frontend/
  package.json  package-lock.json   scripts: build, dev, test
  src/
    main.jsx            mount <App/>, apply styles
    App.jsx             layout, announcer (aria-live), tab-free single view
    api.js              post(url, body) -> {status, ok, data}
    samples.js          scanner + form sample data
    styles.js           the stylesheet as an exported CSS string (ported from today's style.css)
    applyStyles.js      builds a CSSStyleSheet, replaceSync, adds to document.adoptedStyleSheets
    segments.js         pure highlight-range splitting (unit tested)
    components/         Scanner, ResultPanel, Verdict, Meter, Chips, Findings, DecodedView, ProtectedForm
    hooks/useScan.js
    **/*.test.jsx
xss_detector/static/
  app.js                build output only (committed); no other files
```

- Bundler: **esbuild** (one dev dependency): `esbuild src/main.jsx --bundle --minify --jsx=automatic
  --outfile=../xss_detector/static/app.js`. `npm run dev` is the same command with `--watch`.
- Runtime dependencies (bundled, not installed by Python users): `react`, `react-dom`.
- Dev dependencies: `esbuild`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`.
  Exact versions are chosen and pinned (with the lockfile) when the plan is written; `npm audit` is run.
- `node_modules/` is not committed; the built `app.js` is.

## 5. Server change (only backend edit)

`server.py`:
- `GET /` returns a **generated page shell** built from a Python string: doctype, `<meta charset>`,
  viewport, `<title>XSS Detector</title>`, `<div id="root"></div>`, `<script src="/app.js"></script>`, and
  a `<noscript>` message ("This page needs JavaScript."). No `.html` file exists.
- `GET /app.js` serves `static/app.js` (`text/javascript; charset=utf-8`).
- `/style.css` is removed (404). The route table stays a fixed whitelist of two paths, so there is **no
  directory serving and no path-traversal surface**.
- Security headers, API routes, body limits and error shapes are unchanged. If `static/app.js` is missing
  (frontend never built), `GET /` still works but the page shows the `<noscript>`-style message and
  `GET /app.js` returns 404 with a JSON error; the server logs a warning at start-up.

## 6. Components and state

- **`useScan(text)`**: debounces 200 ms; uses `AbortController` so a newer input cancels the older
  request and stale responses can never render; returns `{status: "idle"|"loading"|"ok"|"error", result,
  error}`. Empty text -> `idle`.
- **`Scanner`**: textarea (`id="probe"`), Clear button, grouped sample buttons (Attacks / Harmless).
- **`ResultPanel`**: shows the empty state (`idle`), an error alert (`error`), or Verdict + Meter + Chips +
  Findings + DecodedView (`ok`). Holds `hoveredRule` state shared by Findings and DecodedView.
- **`Findings`**: grouped by category; each item is focusable, with weight bar; hover/focus sets
  `hoveredRule`.
- **`DecodedView`**: `segments(decoded, findings)` (pure) returns `{text, rules[]}[]`, rendered as text and
  `<mark>` elements; the mark for `hoveredRule` gets the "on" class. React escapes all text.
- **`ProtectedForm`**: controlled inputs (`name`, `email`, `website`, `comment`), per-field level chips
  from `results`, sample buttons, submit state (disabled + "Submitting..."), outcome as a table (typed vs
  stored) or an errors list, network-error state.
- **Announcer**: an `aria-live="polite"` region updated with the verdict / submit status.
- Ids from the current page (`probe`, `clear`, `samples`, `scan-result`, `findings`, `decoded`, `demo-form`,
  `submit-result`, ...) are preserved so the existing headless-Chrome script can be reused.
- Meter and weight-bar widths use `style={{ width }}` (CSSOM, allowed by the CSP).

## 7. Styling

- `styles.js` holds the whole stylesheet as one template-literal string (ported from `style.css`: theme
  variables, dark mode, responsive grid, focus rings, reduced-motion).
- `applyStyles()` runs once before the first render: `const s = new CSSStyleSheet(); s.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, s]`.
- No `<style>` elements, no `style=` attributes in markup, no external stylesheet, no web fonts.

## 8. Parity checklist (must all pass)

Two-column layout that stacks on phones (no horizontal overflow at 390 px); empty / loading / error /
result states; verdict banner + score + meter with 25/50/75 ticks; chips (decode layers, ML probability or
"not trained", blocked/allowed); findings grouped by category with weight bars and hover/focus
highlighting of the matching text in the decoded view; "encoded, N layers" note; sample buttons (Attacks /
Harmless) and Clear; fast typing shows only the latest result; API-unreachable shows an error, not an
exception; protected form: per-field chips, inline errors, rejected list, accepted table (typed vs
HTML-escaped stored), submit button recovers after errors; light and dark themes; screen-reader
announcements; markup typed into inputs never becomes live DOM or executes.

## 9. Testing

1. **Vitest (jsdom, Testing Library)**:
   - `segments()`: no findings, one match, overlapping matches, match not found in decoded text, evasion
     finding (no text match), empty string.
   - `useScan`: debounce, cancels/ignores stale responses, error state, empty input -> idle.
   - `Scanner`/`ResultPanel` flows with mocked `fetch`: sample click renders verdict and findings; hover
     highlights the matching `<mark>`; error and empty states.
   - `ProtectedForm`: rejected (chips, inline errors, list), accepted (table), network error, button state.
   - Payload rendering: an input containing `<img src=x onerror=...>` produces no `img` element and no
     handler in the DOM.
   - Source guard: `frontend/src` contains no `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`,
     `eval`, `new Function`, `document.write`. (The guard scans **source**, not the bundle, because React
     itself contains those words.)
   - `applyStyles` adds exactly one adopted stylesheet and creates no `<style>` element.
2. **Python (`unittest`)**: `GET /` returns the shell (200, CSP headers, contains `XSS Detector`, a
   `#root` div, `/app.js` script, no inline script/style/`on*=`/`style=`); `GET /app.js` returns
   `text/javascript`; `GET /style.css` and other paths return 404; `tests/test_frontend.py` is rewritten
   accordingly (the id-contract tests for the old `app.js` are removed); the static dir has no `.html` /
   `.css` file; all 35 existing backend tests stay green.
3. **Real browser**: build, then rerun the headless-Chrome script (same ids) against the built app and
   review light, dark and mobile screenshots; confirm no CSP violations are logged.

## 10. Risks

- **Bundle drift:** the committed `app.js` can fall out of date with `frontend/src`. Mitigation: README
  says to run `npm run build` after any change; consider a CI check later (out of scope now).
- **Supply chain:** npm dependencies are new for this project. Mitigation: few, exact-pinned, lockfile,
  `npm audit`, dev tools not shipped.
- **Old browsers:** no constructable stylesheets -> unstyled but usable (baseline stated in the README).
- **Regression:** rewrite could lose behaviour; the parity checklist plus the browser script is the guard.

## 11. Open questions for review

1. Is the browser baseline in section 3 acceptable?
2. Keep the current element ids for the browser script, or is there a reason to change them?
3. Should the missing-bundle case (section 5) fail the server start-up instead of only warning?
