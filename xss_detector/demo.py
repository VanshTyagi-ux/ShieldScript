"""Vulnerable vs protected comment board - a local, educational stored-XSS demo.

  /vulnerable  renders comments as raw HTML (deliberately insecure; do NOT copy this)
  /protected   scans input with the detector AND HTML-escapes on output

The attack payload only reveals a fake demo cookie in a banner. The server binds to
127.0.0.1 and keeps comments in memory only.
"""

from __future__ import annotations

import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

from .ml import HybridDetector
from .sanitizer import escape_html

log = logging.getLogger("xss_detector.demo")
STATIC = Path(__file__).parent / "static"
MAX_BODY = 32 * 1024
MAX_FIELD = 2000
MAX_COMMENTS = 50

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
        "blurb": "Input is scanned by the XSS detector (rules + ML) and HTML-escaped on output, and the page "
                 "sends a CSP that forbids inline scripts. The same samples are rejected or shown as plain text.",
    },
}

detector = HybridDetector()
_lock = threading.Lock()
_comments: dict[str, list[tuple[str, str]]] = {
    mode: [("Ada", "Welcome to the comment board!")] for mode in MODES
}

CSS = ("body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#1c2330}"
       "nav a{margin-right:14px}.card{border:1px solid #d8dce3;border-radius:8px;padding:12px 14px;margin:10px 0}"
       "input,textarea{width:100%;padding:7px;margin:4px 0 10px;font:inherit;box-sizing:border-box}"
       "button{padding:6px 12px;margin-right:6px;cursor:pointer}.samples button{font-size:12px}"
       ".bad{background:#fdecef;border-color:#c81e3a}.ok{color:#1f7a44}.muted{color:#667085;font-size:13px}"
       "#pwned{background:#c81e3a;color:#fff;padding:12px;border-radius:8px;font-weight:600;word-break:break-all}"
       ".tag{display:inline-block;padding:1px 8px;border-radius:99px;color:#fff;font-size:12px;background:#c81e3a}"
       ".tag.p{background:#1f7a44}")


def render_page(mode: str, values: dict | None = None, blocked: dict | None = None) -> str:
    info = MODES[mode]
    values = values or {}
    with _lock:
        comments = list(_comments[mode])
    if mode == "vulnerable":  # DELIBERATELY UNSAFE: raw interpolation
        items = "".join(f'<div class="card"><b>{name}</b><br>{text}</div>' for name, text in comments)
    else:
        items = "".join(f'<div class="card"><b>{escape_html(name)}</b><br>{escape_html(text)}</div>'
                        for name, text in comments)

    samples = "".join(
        f'<button type="button" data-payload="{escape_html(payload)}">{escape_html(label)}</button>'
        for label, payload in SAMPLES.items())

    alert = ""
    if blocked:
        rows = "".join(f"<li><code>{escape_html(f['rule_id'])}</code> {escape_html(f['name'])} "
                       f"<span class='muted'>({escape_html(f['match'])})</span></li>" for f in blocked["findings"])
        alert = (f'<div class="card bad"><b>Rejected:</b> field "{escape_html(blocked["field"])}" looks like XSS '
                 f'({escape_html(blocked["level"])}, score {blocked["score"]}, '
                 f'ML {escape_html(str(blocked["ml_probability"]))}).<ul>{rows}</ul></div>')

    tag = '<span class="tag">insecure</span>' if mode == "vulnerable" else '<span class="tag p">protected</span>'
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{info['title']}</title>
<style>{CSS}</style></head><body>
<nav><a href="/">Home</a><a href="/vulnerable">Vulnerable</a><a href="/protected">Protected</a></nav>
<h1>{info['title']} {tag}</h1><p>{info['blurb']}</p>
<div id="pwned" hidden></div>
{alert}
<form method="post" action="/{mode}/comment">
<label>Name<input name="name" value="{escape_html(values.get('name', ''))}" autocomplete="off"></label>
<label>Comment<textarea name="comment" rows="3">{escape_html(values.get('comment', ''))}</textarea></label>
<button type="submit">Post comment</button>
<div class="samples muted">Try a sample: {samples}</div></form>
<form method="post" action="/reset"><input type="hidden" name="mode" value="{mode}">
<button>Clear comments</button></form>
<h2>Comments</h2>{items}
<script src="/demo.js"></script></body></html>"""


HOME = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>XSS demo</title>
<style>%s</style></head><body><h1>Stored XSS demo</h1>
<p>Two identical comment boards. Post the same attack to both and compare.</p>
<div class="card"><a href="/vulnerable">Vulnerable board</a> - raw HTML output, no filtering.</div>
<div class="card"><a href="/protected">Protected board</a> - detector + output escaping + CSP.</div>
<p class="muted">Local demo only. Comments live in memory and the cookie is a fake value.</p>
</body></html>""" % CSS

DEMO_JS = """document.querySelectorAll('[data-payload]').forEach(function (b) {
  b.addEventListener('click', function () {
    document.querySelector('[name=comment]').value = b.dataset.payload;
    var n = document.querySelector('[name=name]'); if (!n.value) n.value = 'Mallory';
  });
});
"""


class Handler(BaseHTTPRequestHandler):
    server_version = "XSSDemo/1.0"

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
        path = self.path.split("?", 1)[0]
        if path == "/":
            return self._send(200, HOME)
        if path == "/demo.js":
            return self._send(200, DEMO_JS, "text/javascript; charset=utf-8")
        if path.strip("/") in MODES:
            return self._page(path.strip("/"))
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

    def _comment(self, mode, name, text):
        if mode == "protected":
            for field, value in (("name", name), ("comment", text)):
                result = detector.scan(value)
                if result["is_malicious"]:
                    log.warning("demo: blocked field=%r score=%d", field, result["score"])
                    blocked = {"field": field, "level": result["level"], "score": result["score"],
                               "ml_probability": result["ml_probability"], "findings": result["findings"]}
                    return self._page(mode, 422, values={"name": name, "comment": text}, blocked=blocked)
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


def serve(host: str = "127.0.0.1", port: int = 8001) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    httpd = ThreadingHTTPServer((host, port), Handler)
    log.info("XSS demo on http://%s:%d  (vulnerable + protected boards; Ctrl+C to stop)", host, port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
