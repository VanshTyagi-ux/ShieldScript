# Rich-text sanitization for HTML fields - design

Status: draft for review (2026-09-28)

## 1. Intent

The XSS detector will screen live user input in **rich-text / HTML fields** (CMS-style content with
`<b>`, `<a>`, `<img>`, lists). A pattern detector cannot be the gate for that traffic: legitimate HTML
looks like markup, so it either blocks real users or is tuned so loosely that it lets attacks through.

**Goal:** make HTML fields safe by *sanitizing* them (allow-list) with a maintained library, and keep the
existing detector as an **alert-only** signal for attack attempts. Plain-text fields are unchanged.

**Success criteria**
1. No output from the HTML path can execute script when rendered as HTML body content.
2. Legitimate rich text from the allow-list passes through with its formatting.
3. The detector never blocks an HTML field; it only records alerts.
4. If the sanitizer is unavailable, HTML fields are refused (fail closed), never passed through.
5. Everything outside the HTML path stays standard-library-only.

**Assumed, not confirmed by the user:** the output is rendered as normal HTML *body* content (not inside
an attribute, `<script>`, `<style>` or a URL context), and the consuming app applies its own CSP.

## 2. Scope

In scope: sanitizer module, server routing of HTML fields, alert logging, a rich-text editor page in
the existing UI, dependency declaration, tests, README.

Out of scope: rate limiting and auth (next spec), reducing prose false positives in detector rules
(becomes alert noise only), the consuming application's output encoding and CSP, Markdown input,
allowing `style`/`class` attributes, embedding video/iframes, per-user or per-field custom policies.

## 3. Architecture

```
raw HTML field ──► detector.scan(raw)  ──► alert record (log only)
      │                                        ▲
      └────────► sanitize_html(raw) ──► clean, changed ──┘  (changed=True is also an alert signal)
                        │
                        └──► returned to caller as the value to store/render
```

New module `xss_detector/richtext.py`:

```python
@dataclass(frozen=True)
class SanitizeResult:
    clean: str      # safe HTML
    changed: bool   # True if the sanitizer altered the input

class SanitizerUnavailable(RuntimeError): ...

def sanitize_html(raw: str) -> SanitizeResult
```

- `nh3` is imported lazily inside `richtext.py`. A missing import raises `SanitizerUnavailable`.
- `changed` is defined as `clean != raw`. `nh3` cannot tell us whether it removed something or merely
  re-serialised (`<br>` vs `<br/>`, entity forms), so this is a **noisy** signal. It is recorded in alerts
  but is never used to block or reject.
- Server config: `HTML_FIELDS = frozenset({"comment"})` in `server.py`. The client cannot choose which
  fields are HTML. Fields not listed keep today's behaviour (scan, block, `escape_html`).

## 4. Sanitizer policy

A single fixed policy, passed to `nh3.clean`:

| Setting | Value |
|---|---|
| `tags` | `a b i em strong p br ul ol li blockquote code pre h1 h2 h3 h4 img` |
| `attributes` | `{"a": {"href", "title"}, "img": {"src", "alt"}}` |
| `url_schemes` | `{"http", "https", "mailto"}` (applies to every URL attribute, see note) |
| `link_rel` | `"noopener noreferrer"` |
| `strip_comments` | `True` |
| `clean_content_tags` | `{"script", "style"}` (dropped together with their contents) |
| `generic_attribute_prefixes` | none (no `on*`, `data-*`, `style`, `class`) |

Notes:
- `url_schemes` is global in `nh3`, so `mailto:` is also accepted in `img src`. This is harmless (an image
  will not load from it) and `data:`, `javascript:` and `vbscript:` remain excluded everywhere.
- Relative URLs are allowed (library default). Remote images allow tracking pixels; this is accepted for
  now and can be tightened later.
- The policy lives in one constant so it can be reviewed in one place.

## 5. Detector role

- The detector scans the **raw** input and is never used to block an HTML field.
- Alert record (logged at WARNING when the detector is malicious or `changed` is true): field name, rule
  IDs, score, ML probability, `changed`. The raw value is **not** logged (same rule as today).
- Purpose: measure attack attempts and provide monitoring; its false positives on legitimate HTML only
  add alert noise, not user impact.

## 6. Server and API

`/api/submit` (existing) - for each field:
- in `HTML_FIELDS`: sanitize, record alert, include in the response `sanitized[field]` = clean HTML.
  Never contributes to a 422 (email/website validation still applies to their own fields).
- otherwise: unchanged.

Response additions (backward compatible): `html_fields: {field: {"changed": bool, "alert": bool}}`.

`/api/sanitize` (new, `POST {"html": "..."}`) - returns `{"clean": ..., "changed": ..., "alert": {...}}`
for the editor page. Same body limits and error shape as the other routes.

Failure behaviour: `SanitizerUnavailable` -> HTTP 503 `{"error": "HTML sanitizer unavailable"}` for any
request that includes an HTML field. Text-only requests keep working.

## 7. Frontend (rich-text editor page)

Built as a second view in the React app (see `2026-09-28-react-frontend-design.md`; it depends on that
work landing first, and needs no new static files or routes beyond `/api/sanitize`):
- Left: HTML source textarea and sample buttons (clean formatting, `<script>`, `onerror`, `javascript:` link,
  nested/mutation-style markup).
- Right: **sanitized preview** and a **diff view** of what the sanitizer removed.
- Detector alert shown as chips (score, level, ML) and clearly labelled "alert only - does not block".
- Preview safety: the sanitized HTML is rendered in a **sandboxed iframe with `srcdoc`** and no
  `allow-scripts`, so a sanitizer bug cannot execute in the page's origin. It is a React
  `<iframe sandbox srcDoc={clean}>`; the page itself never uses `dangerouslySetInnerHTML`, and the
  source-level sink ban in the React spec stays in force.
- If `/api/sanitize` returns 503, show an explicit error, never fall back to rendering the input.
- CSP: the server CSP currently sends `default-src 'self'`; `srcdoc` iframes inherit it, which blocks
  images from other origins in the preview. Decision needed in review (see Open questions).

## 8. Dependency handling

- Add `requirements.txt` with `nh3==0.3.7` (latest at time of writing; Python 3.12 wheels available).
- README: only the HTML path needs it; text scanning and the demo remain "nothing to install".
- The test suite must run without `nh3` installed: HTML-path tests are skipped with a clear reason when
  the import fails, and one test asserts the fail-closed behaviour with the import forced to fail.

## 9. Testing

1. **Passthrough**: representative legitimate rich text keeps its tags and allowed attributes; `<a>` gains
   `rel="noopener noreferrer"`.
2. **Removal**: `script`/`style` (with contents), `on*` handlers, `style`/`class`, `javascript:` and `data:`
   URLs, comments, `iframe/object/embed/svg/math` are removed.
3. **Structural safety over the corpus**: run all payloads in `data/payloads/` (~8,400) through
   `sanitize_html`; parse the output with `html.parser` and assert every tag and attribute is on the
   allow-list and every URL scheme is allowed. This replaces re-running the regex rules on the output, since
   harmless leftover text such as `alert(1)` would still match a rule.
4. **Idempotence (mutation-XSS guard)**: `clean(clean(x)) == clean(x)` across the same corpus. This is a
   necessary check, not a proof.
5. **Server**: HTML field sanitized and never blocked; text field still blocked; 503 when sanitizer is
   unavailable; text-only request unaffected; body-size limits and error shapes unchanged.
6. **Alerting**: an attack payload logs an alert containing rule IDs and no raw value.
7. **Frontend**: extend `tests/test_frontend.py` (ids used by JS exist, no injection sinks, preview iframe
   has a `sandbox` attribute without `allow-scripts`) and repeat the headless-Chrome check that a payload
   in the source never executes in the page or the preview.
8. **Existing suite stays green** (44 tests today).

## 10. Risks

- A sanitizer library can still have bugs; the sandboxed preview limits the demo page, but the consuming
  app should keep its own CSP and encoding. The idempotence test is a smoke check only.
- The allow-list is a product decision: every added tag or attribute widens the attack surface.
- `changed` is noisy (see section 3) and must not be used as a blocking signal.
- Remote images can be used for tracking; not addressed here.

## 11. Open questions for review

1. Is the tag/attribute allow-list in section 4 right for your content? (For example: tables, `h5-h6`,
   `hr`, `span`, or `class` are not included.)
2. Should the preview's CSP be relaxed to allow remote images (`img-src https:` on the iframe only), or
   keep the strict CSP and show images as broken in the preview?
3. Should `HTML_FIELDS` be hard-coded (proposed) or read from an environment variable / config file?
