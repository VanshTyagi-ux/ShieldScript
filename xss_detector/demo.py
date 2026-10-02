"""Vulnerable vs protected dummy blog - a local, educational XSS demo (stored and reflected).

  /vulnerable  renders comments and the search query as raw HTML (deliberately insecure; do NOT copy this)
  /protected   sends input to the main site's detector (POST /api/scan) AND HTML-escapes on output

The protected pages are a client of the main site, like any other application: they do not import the detector.
If the main site cannot be reached they reject the input (fail closed) rather than let it through unscanned.
The attack payload only reveals a fake demo cookie in a banner. The server binds to 127.0.0.1 and keeps
comments in memory only.
"""

from __future__ import annotations

import http.client
import json
import logging
import os
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .sanitizer import escape_html

log = logging.getLogger("xss_detector.demo")
STATIC = Path(__file__).parent / "static"
MAX_BODY = 32 * 1024
MAX_FIELD = 2000
MAX_COMMENTS = 50
DEFAULT_DETECTOR_URL = "http://127.0.0.1:8000"
SOURCE = "dummy-site"  # how the main site labels scans from here on its /live page
UNAVAILABLE = "Detector unavailable, input not accepted"


class DetectorUnavailable(Exception):
    """The main site could not give a usable verdict; protected pages must reject the input."""


def scan_via_api(base_url: str, fields: dict[str, str], *, source: str = SOURCE, timeout: float = 3.0) -> dict[str, dict]:
    """Scan `fields` with the main site (one POST /api/scan); -> {field: result}. Raises DetectorUnavailable on
    a connection error, timeout, any non-200 answer (a 429 included), invalid JSON, or a missing verdict."""
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/scan", data=json.dumps({"fields": fields, "source": source}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if response.status != 200:
                raise DetectorUnavailable(f"detector answered HTTP {response.status}")
            results = json.loads(response.read())["results"]
    except DetectorUnavailable:
        raise
    except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException) as exc:
        raise DetectorUnavailable(str(exc) or type(exc).__name__) from None
    for name in fields:
        result = results.get(name) if isinstance(results, dict) else None
        if not isinstance(result, dict) or not isinstance(result.get("is_malicious"), bool):
            raise DetectorUnavailable(f"detector gave no verdict for {name!r}")
    return results


def detector_status(base_url: str, timeout: float = 1.0) -> bool:
    """Whether the main site answers its health check."""
    try:
        with urllib.request.urlopen(f"{base_url.rstrip('/')}/api/health", timeout=timeout) as response:
            return response.status == 200
    except (OSError, http.client.HTTPException):
        return False


def _blocked(field: str, result: dict) -> dict:
    return {"field": field, "level": result.get("level", "unknown"), "score": result.get("score", 0),
            "ml_probability": result.get("ml_probability"), "findings": result.get("findings") or []}

SAMPLES = {
    "Harmless comment": "Great post, thanks for sharing!",
    "Steal cookie (stored XSS)": "<img src=x onerror=\"pwned.hidden=false;pwned.textContent="
                                 "'XSS executed! An attacker could now read: '+document.cookie\">",
    "Script tag": "<script>document.getElementById('pwned').hidden=false</script>",
    "Encoded evasion": "%3Cimg src=x onerror=alert(1)%3E",
}

MODES = {
    "vulnerable": {
        "title": "Vulnerable board",
        "blurb": "Comments are inserted into the page as raw HTML. Submit the 'Steal cookie' sample, "
                 "then reload: the script runs in every visitor's browser.",
    },
    "protected": {
        "title": "Protected board",
        "blurb": "Input is scanned by ScriptShield (rules + ML) and HTML-escaped on output, and the page "
                 "sends a CSP that forbids inline scripts. The same samples are rejected or shown as plain text.",
    },
}

_lock = threading.Lock()
_comments: dict[str, list[tuple[str, str]]] = {
    mode: [("Ada", "Welcome to the comment board!")] for mode in MODES
}

CSS = """
:root{--bg:#f4f5f8;--surface:#fff;--text:#1c2330;--muted:#667085;--border:#d8dce3;--accent:#3b5bdb;--on-accent:#fff;
--danger:#c81e3a;--danger-soft:#fdecef;--ok:#1f7a44;--ok-soft:#e6f4ea;--chip:#eef1f6;--radius:10px}
@media (prefers-color-scheme: dark){:root{--bg:#0f141b;--surface:#171e28;--text:#e6e9ef;--muted:#9aa4b2;--border:#2b3544;
--accent:#7c9cff;--on-accent:#0f141b;--danger:#ff6b81;--danger-soft:#3a1a22;--ok:#5fd08a;--ok-soft:#14301f;--chip:#212b39}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.wrap{max-width:980px;margin:0 auto;padding:0 16px}
.site-header{position:sticky;top:0;z-index:5;background:var(--surface);border-bottom:1px solid var(--border)}
.site-header .wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 24px;min-height:60px}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:700;font-size:18px;color:var(--text);text-decoration:none}
.brand::before{content:"";width:18px;height:18px;border-radius:50%;background:var(--accent)}
nav a{display:inline-block;padding:6px 12px;margin-left:4px;border-radius:99px;color:var(--muted);text-decoration:none;font-weight:600}
nav a:hover{background:var(--chip);color:var(--text)}
nav a[aria-current="page"]{background:var(--accent);color:var(--on-accent)}
.banner{padding:10px 0;font-size:14px;border-bottom:1px solid var(--border)}
.banner .wrap{display:flex;flex-wrap:wrap;gap:4px 12px}
.banner.insecure{background:var(--danger-soft);color:var(--danger)}
.banner.protected{background:var(--ok-soft);color:var(--ok)}
main.wrap{padding-top:24px;padding-bottom:48px}
.layout{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:20px;align-items:start}
.card,.alert{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin:0 0 16px;box-shadow:0 1px 2px rgba(16,24,40,.05)}
.card h1{margin:0 0 4px;font-size:26px;line-height:1.25}
.card h2,.comments h2{margin:0 0 10px;font-size:18px}
.card h3{margin:16px 0 4px;font-size:17px}
.lede{color:var(--muted);margin:4px 0 12px}
label{display:block;font-weight:600;font-size:14px;margin-bottom:10px}
input,textarea{display:block;width:100%;margin-top:4px;padding:9px 11px;font:inherit;color:var(--text);background:var(--bg);
border:1px solid var(--border);border-radius:8px;transition:border-color .15s}
input:hover,textarea:hover{border-color:var(--muted)}
input:focus,textarea:focus{border-color:var(--accent)}
button{padding:8px 16px;font:inherit;font-weight:600;color:var(--on-accent);background:var(--accent);border:0;border-radius:8px;cursor:pointer;transition:filter .15s,transform .15s}
button:active{transform:translateY(1px)}
button:hover{filter:brightness(1.08)}
button.ghost{color:var(--text);background:var(--chip)}
.samples{margin-top:12px;font-size:13px}
.samples button{margin:6px 6px 0 0;padding:4px 10px;font-size:12px;font-weight:500;color:var(--text);background:var(--chip);border-radius:99px}
.alert{border-left:5px solid var(--danger);background:var(--danger-soft)}
.alert ul{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0;padding:0;list-style:none}
.alert li{padding:2px 10px;background:var(--surface);border:1px solid var(--border);border-radius:99px;font-size:13px}
.comment{display:flex;gap:12px;align-items:flex-start}
.comment>div{min-width:0;overflow-wrap:anywhere}
.avatar{flex:none;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;
background:var(--accent);color:var(--on-accent);font-weight:700}
#pwned{background:var(--danger);color:#fff;padding:14px 16px;border-radius:var(--radius);font-weight:700;word-break:break-all;margin-bottom:16px}
.ok{color:var(--ok)}.muted{color:var(--muted);font-size:13px}
.tag{display:inline-block;padding:1px 10px;border-radius:99px;color:#fff;font-size:12px;font-weight:600;vertical-align:middle;background:var(--danger)}
.tag.p{background:var(--ok)}
code{padding:1px 5px;background:var(--chip);border-radius:5px;font-size:.9em}
.clear{margin-top:8px}
@media (max-width: 760px){.layout{grid-template-columns:1fr}nav{width:100%;overflow-x:auto;white-space:nowrap;padding-bottom:6px}nav a{margin:0 4px 0 0}
input,textarea{font-size:16px}button{min-height:44px}.samples button{min-height:36px}.card h1{font-size:22px}
.card,.alert{padding:14px}main.wrap{padding-top:16px}}
@media (prefers-reduced-motion: reduce){*{transition:none!important}}
"""

DOC_TITLE = "Bean & Byte"


def _nav(current: str | None) -> str:
    marks = {"home": "", "vulnerable": "", "protected": ""}
    if current in marks:
        marks[current] = ' aria-current="page"'
    links = "".join(f'<a href="{href}"{marks[key]}>{label}</a>'
                    for key, href, label in (("home", "/", "Home"), ("vulnerable", "/vulnerable", "Vulnerable"),
                                             ("protected", "/protected", "Protected")))
    return f'<nav aria-label="Main">{links}</nav>'


def _header(current: str | None) -> str:
    return (f'<header class="site-header"><div class="wrap"><a class="brand" href="/">{escape_html(DOC_TITLE)}</a>'
            f'{_nav(current)}</div></header>')


def _avatar(name: str) -> str:
    initial = escape_html((name.strip()[:1] or "?").upper())
    return f'<span class="avatar" aria-hidden="true">{initial}</span>'


def render_page(mode: str, values: dict | None = None, blocked: dict | None = None,
                query: str | None = None, unavailable: bool = False) -> str:
    """`query` is the search text to echo (raw on the vulnerable board, escaped on the protected one)."""
    info = MODES[mode]
    values = values or {}
    with _lock:
        comments = list(_comments[mode])
    if mode == "vulnerable":  # DELIBERATELY UNSAFE: raw interpolation
        items = "".join(f'<div class="card comment">{_avatar(name)}<div><b>{name}</b><br>{text}</div></div>'
                        for name, text in comments)
    else:
        items = "".join(f'<div class="card comment">{_avatar(name)}<div><b>{escape_html(name)}</b><br>'
                        f'{escape_html(text)}</div></div>' for name, text in comments)

    samples = "".join(
        f'<button type="button" data-payload="{escape_html(payload)}">{escape_html(label)}</button>'
        for label, payload in SAMPLES.items())

    alert = ""
    if unavailable:
        alert = (f'<div class="alert bad" role="alert"><b>{UNAVAILABLE}.</b> The protected board asks the main site '
                 f'to scan every input and will not accept anything it cannot scan. Start it with '
                 f'<code>python -m xss_detector serve</code>.</div>')
    if blocked:
        rows = "".join(f"<li><code>{escape_html(f.get('rule_id', ''))}</code> {escape_html(f.get('name', ''))} "
                       f"<span class='muted'>({escape_html(f.get('match', ''))})</span></li>"
                       for f in blocked["findings"])
        alert = (f'<div class="alert bad" role="alert"><b>Rejected:</b> field "{escape_html(blocked["field"])}" looks '
                 f'like XSS ({escape_html(blocked["level"])}, score {blocked["score"]}, '
                 f'ML {escape_html(str(blocked["ml_probability"]))}).<ul>{rows}</ul></div>')

    if query:
        shown = query if mode == "vulnerable" else escape_html(query)  # DELIBERATELY UNSAFE on the vulnerable board
        result = f'<div class="card">You searched for: <b>{shown}</b><br><span class="muted">No results.</span></div>'
    else:
        result = ""

    if mode == "vulnerable":
        tag = '<span class="tag">insecure</span>'
        banner = '<div class="banner insecure"><div class="wrap"><strong>Insecure board</strong><span>No scanning, raw HTML output.</span></div></div>'
    else:
        tag = '<span class="tag p">protected</span>'
        banner = '<div class="banner protected"><div class="wrap"><strong>Protected board</strong><span>Scanned by the main site, escaped on output, CSP on.</span></div></div>'
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{info['title']} - {escape_html(DOC_TITLE)}</title>
<style>{CSS}</style></head><body>
{_header(mode)}
{banner}
<main class="wrap">
<div id="pwned" hidden></div>
{alert}
<div class="layout">
<article class="card">
<h1>{info['title']} {tag}</h1>
<p class="lede">{info['blurb']}</p>
<h3>Welcome to the blog</h3>
<p>This is a made-up post so the page looks like a real blog. Below it are a search box and a comment form: two
places where user input reaches the page, one stored and one reflected.</p>
</article>
<aside>
<div class="card"><h2>Search</h2>
<form method="get" action="/{mode}/search">
<label>Search the blog<input name="q" value="{escape_html(query or '')}" autocomplete="off"></label>
<button type="submit">Search</button></form></div>
{result}
<div class="card"><h2>Comment</h2>
<form method="post" action="/{mode}/comment">
<label>Name<input name="name" value="{escape_html(values.get('name', ''))}" autocomplete="off"></label>
<label>Comment<textarea name="comment" rows="3">{escape_html(values.get('comment', ''))}</textarea></label>
<button type="submit">Post comment</button>
<div class="samples muted">Try a sample: {samples}</div></form></div>
</aside>
</div>
<section class="comments">
<h2>Comments</h2>{items}
<form method="post" action="/reset" class="clear"><input type="hidden" name="mode" value="{mode}">
<button class="ghost">Clear comments</button></form>
</section>
</main>
<script src="/demo.js"></script></body></html>"""


def render_home(detector_url: str) -> str:
    up = detector_status(detector_url)
    status = (f'<span class="ok">Detector reachable</span> at {escape_html(detector_url)}' if up else
              f'<b>Detector not reachable</b> at {escape_html(detector_url)}: the protected pages will reject input '
              f'until you start it with <code>python -m xss_detector serve</code>.')
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>XSS demo - {escape_html(DOC_TITLE)}</title>
<style>{CSS}</style></head><body>
{_header("home")}
<main class="wrap">
<div class="card"><h1>Dummy blog: stored and reflected XSS</h1>
<p class="lede">Two identical boards, each with a comment form (stored XSS) and a search box (reflected XSS). Send the
same attack to both and compare.</p></div>
<div class="layout">
<div class="card"><h2><a href="/vulnerable">Vulnerable board</a> <span class="tag">insecure</span></h2>
<p>Raw HTML output, no filtering. The attack runs.</p></div>
<div class="card"><h2><a href="/protected">Protected board</a> <span class="tag p">protected</span></h2>
<p>Scanned by the main site's detector, escaped on output, with a CSP.</p></div>
</div>
<div class="card">{status}<br><a href="{escape_html(detector_url)}/live">Watch the live feed</a> on the main site.</div>
<p class="muted">Local demo only. Comments live in memory and the cookie is a fake value.</p>
</main></body></html>"""


DEMO_JS = """document.querySelectorAll('[data-payload]').forEach(function (b) {
  b.addEventListener('click', function () {
    document.querySelector('[name=comment]').value = b.dataset.payload;
    var n = document.querySelector('[name=name]'); if (!n.value) n.value = 'Mallory';
  });
});
"""


class Handler(BaseHTTPRequestHandler):
    server_version = "XSSDemo/1.0"

    @property
    def detector_url(self) -> str:
        return getattr(self.server, "detector_url", DEFAULT_DETECTOR_URL)

    def _send(self, status, body, ctype="text/html; charset=utf-8", headers=None):
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _page(self, mode, status=200, **kw):
        headers = {"Cache-Control": "no-store"}
        if mode == "protected":
            headers["Content-Security-Policy"] = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; form-action 'self'"
        else:
            # Fake, script-readable cookie so the demo attack has something to "steal".
            headers["Set-Cookie"] = "session=demo-secret-not-real; Path=/"
        self._send(status, render_page(mode, **kw), headers=headers)

    def do_GET(self):
        parts = urlsplit(self.path)
        path = parts.path
        if path == "/":
            return self._send(200, render_home(self.detector_url))
        if path == "/demo.js":
            return self._send(200, DEMO_JS, "text/javascript; charset=utf-8")
        if path.strip("/") in MODES:
            return self._page(path.strip("/"))
        segments = path.strip("/").split("/")
        if len(segments) == 2 and segments[0] in MODES and segments[1] == "search":
            query = parse_qs(parts.query).get("q", [""])[0][:MAX_FIELD]
            return self._search(segments[0], query)
        self._send(404, "Not found", "text/plain")

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self._send(411, "Content-Length required", "text/plain")
        if not 0 <= length <= MAX_BODY:
            return self._send(413, "Body too large", "text/plain")
        form = {k: v[0][:MAX_FIELD] for k, v in parse_qs(self.rfile.read(length).decode("utf-8", "replace")).items()}

        path = self.path.split("?", 1)[0]
        if path == "/reset":
            mode = form.get("mode")
            if mode in MODES:
                with _lock:
                    _comments[mode] = []
            return self._redirect(f"/{mode}" if mode in MODES else "/")
        parts = path.strip("/").split("/")
        if len(parts) == 2 and parts[0] in MODES and parts[1] == "comment":
            return self._comment(parts[0], form.get("name", "").strip() or "Anonymous", form.get("comment", ""))
        self._send(404, "Not found", "text/plain")

    def _scan(self, fields: dict[str, str]):
        """-> (results, None), or (None, reason) when the main site cannot give a verdict."""
        try:
            return scan_via_api(self.detector_url, fields), None
        except DetectorUnavailable as exc:
            log.warning("demo: detector unavailable, rejecting input: %s", exc)
            return None, str(exc)

    def _search(self, mode, query):
        if mode == "protected" and query:
            results, problem = self._scan({"q": query})
            if problem:
                return self._page(mode, 503, unavailable=True)
            if results["q"]["is_malicious"]:
                log.warning("demo: blocked field='q' score=%s", results["q"].get("score"))
                return self._page(mode, 422, blocked=_blocked("q", results["q"]))
        self._page(mode, query=query)

    def _comment(self, mode, name, text):
        if mode == "protected":
            results, problem = self._scan({"name": name, "comment": text})
            if problem:
                return self._page(mode, 503, values={"name": name, "comment": text}, unavailable=True)
            for field in ("name", "comment"):
                if results[field]["is_malicious"]:
                    log.warning("demo: blocked field=%r score=%s", field, results[field].get("score"))
                    return self._page(mode, 422, values={"name": name, "comment": text},
                                      blocked=_blocked(field, results[field]))
        with _lock:
            _comments[mode].append((name, text))
            del _comments[mode][:-MAX_COMMENTS]
        self._redirect(f"/{mode}")

    def _redirect(self, location):
        self.send_response(303)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):
        log.info("%s - %s", self.address_string(), fmt % args)


def serve(host: str = "127.0.0.1", port: int = 8001, detector_url: str | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.detector_url = (detector_url or os.environ.get("DETECTOR_URL") or DEFAULT_DETECTOR_URL).rstrip("/")
    log.info("XSS demo on http://%s:%d  (vulnerable + protected boards; Ctrl+C to stop)", host, port)
    log.info("Protected pages scan through %s (start it with: python -m xss_detector serve)", httpd.detector_url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
