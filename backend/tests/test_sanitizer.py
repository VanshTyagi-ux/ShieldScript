"""Sanitizer service and POST /api/v1/sanitize.  Run from backend/:  python -m unittest discover -s tests -t ."""

import sys
import time
import unittest
from html.parser import HTMLParser
from unittest import mock
from urllib.parse import urlsplit

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.repo import PAYLOAD_DIR
from app.main import app
from app.services import payloads as payload_svc
from app.services import sanitizer as svc

URL = f"{settings.API_V1_PREFIX}/sanitize"
client = TestClient(app)


def removed(report):
    tags = {t["name"]: (t["count"], t["content_removed"]) for t in report.removed_tags}
    attrs = {(a["tag"], a["name"]): (a["count"], a["reason"]) for a in report.removed_attributes}
    return tags, attrs


class SanitizeTests(unittest.TestCase):
    def test_allowed_markup_passes_and_links_get_rel(self):
        out = svc.sanitize('<p>Hello <b>world</b> <a href="https://example.com" title="t">link</a></p>')
        self.assertEqual(out.clean, '<p>Hello <b>world</b> <a href="https://example.com" title="t" '
                                    'rel="noopener noreferrer">link</a></p>')
        self.assertEqual(removed(out.report), ({}, {}))
        self.assertTrue(out.changed)  # only because rel= was added: `changed` is noisy, the report is not

    def test_script_and_style_go_with_their_contents(self):
        out = svc.sanitize("<p>hi</p><script>alert(1)</script><SCRIPT SRC=//x.y></SCRIPT><style>p{}</style>")
        self.assertEqual(out.clean, "<p>hi</p>")
        tags, attrs = removed(out.report)
        self.assertEqual(tags, {"script": (2, True), "style": (1, True)})  # tag names are lower-cased
        self.assertEqual(attrs, {("script", "src"): (1, "tag_not_allowed")})

    def test_other_tags_are_dropped_but_their_text_stays(self):
        out = svc.sanitize('<div class="z" onclick=x>hello</div><span>s</span>')
        self.assertEqual(out.clean, "hellos")
        tags, attrs = removed(out.report)
        self.assertEqual(tags, {"div": (1, False), "span": (1, False)})
        self.assertEqual(attrs, {("div", "class"): (1, "tag_not_allowed"), ("div", "onclick"): (1, "event_handler")})

    def test_event_handlers_and_other_attributes(self):
        out = svc.sanitize('<img src="https://e.com/a.png" onerror="alert(1)" alt="a" style="x:y" class="c" id="i">')
        self.assertEqual(out.clean, '<img src="https://e.com/a.png" alt="a">')
        self.assertEqual(removed(out.report)[1], {("img", "onerror"): (1, "event_handler"),
                                                  ("img", "style"): (1, "attribute_not_allowed"),
                                                  ("img", "class"): (1, "attribute_not_allowed"),
                                                  ("img", "id"): (1, "attribute_not_allowed")})

    def test_title_and_lang_are_only_kept_where_the_policy_says(self):
        # nh3 would keep title= and lang= on every tag by default; the policy allows title on <a> only.
        out = svc.sanitize('<p lang="en" title="t">p</p><a title="t" lang="en" href="/x">a</a>')
        self.assertEqual(out.clean, '<p>p</p><a title="t" href="/x" rel="noopener noreferrer">a</a>')

    def test_dangerous_url_schemes_are_dropped_from_allowed_attributes(self):
        raw = ('<a href="javascript:alert(1)">1</a><a href=" JaVa\tScRiPt:alert(1)">2</a>'
               '<a href="vbscript:x">3</a><img src="data:image/png;base64,AAAA">')
        out = svc.sanitize(raw)
        self.assertNotIn("javascript", out.clean.lower())
        self.assertNotIn("data:", out.clean)
        self.assertEqual(removed(out.report)[1], {("a", "href"): (3, "unsafe_url"), ("img", "src"): (1, "unsafe_url")})

    def test_safe_urls_survive(self):
        raw = '<a href="http://a.com">1</a><a href="mailto:a@b.co">2</a><a href="/rel?x=1#y">3</a><img src="/i.png">'
        self.assertEqual(removed(svc.sanitize(raw).report), ({}, {}))

    def test_comments_are_stripped_and_counted(self):
        out = svc.sanitize("<!-- c1 --><p>x</p><!--c2-->")
        self.assertEqual((out.clean, out.report.comments_removed), ("<p>x</p>", 2))

    def test_embedding_and_foreign_content_tags_are_removed(self):
        out = svc.sanitize('<iframe src="//e.com"></iframe><object data=x></object><embed src=x>'
                           '<svg onload=alert(1)><math></math></svg>')
        self.assertEqual(out.clean, "")
        self.assertEqual(set(removed(out.report)[0]), {"iframe", "object", "embed", "svg", "math"})
        self.assertEqual(removed(out.report)[1][("svg", "onload")], (1, "event_handler"))

    def test_quoted_gt_does_not_hide_an_event_handler(self):
        for raw in ('<a title=">" onclick=x href="/r">t</a>', "<a title='>' onclick=x>t</a>"):
            with self.subTest(raw):
                self.assertNotIn("onclick", svc.sanitize(raw).clean)
                self.assertEqual(removed(svc.sanitize(raw).report)[1], {("a", "onclick"): (1, "event_handler")})

    def test_tags_inside_script_and_textarea_text_are_not_counted(self):
        out = svc.sanitize('<script>if (a<b) {x = "<i onclick=y>"}</script><p>after</p><textarea><b>t</b></textarea>')
        self.assertEqual(set(removed(out.report)[0]), {"script", "textarea"})
        self.assertEqual(removed(out.report)[1], {})

    def test_event_handler_label_needs_more_than_a_bare_on_prefix(self):
        attrs = removed(svc.sanitize("<p one=1 onfoo=2 on=3>x</p>").report)[1]
        self.assertEqual(attrs[("p", "one")][1], "attribute_not_allowed")
        self.assertEqual(attrs[("p", "on")][1], "attribute_not_allowed")
        self.assertEqual(attrs[("p", "onfoo")][1], "event_handler")

    def test_attribute_values_are_never_echoed_and_names_are_capped(self):
        out = svc.sanitize(f'<p {"x" * 500}="SECRET-VALUE">t</p>')
        dumped = repr(out.report)
        self.assertNotIn("SECRET-VALUE", dumped)
        self.assertLessEqual(len(out.report.removed_attributes[0]["name"]), 65)

    def test_report_lists_are_capped_but_totals_are_exact(self):
        many = "".join(f"<t{i} a{i}=1>" for i in range(150))
        out = svc.sanitize(many)
        self.assertEqual((len(out.report.removed_tags), len(out.report.removed_attributes)), (100, 100))
        self.assertEqual((out.report.total_tags_removed, out.report.total_attributes_removed), (150, 150))
        self.assertTrue(out.report.truncated)
        self.assertFalse(svc.sanitize("<script></script>").report.truncated)

    def test_empty_and_plain_input(self):
        self.assertEqual(svc.sanitize("").clean, "")
        plain = svc.sanitize("just text 😀 & more")
        self.assertEqual(plain.clean, "just text 😀 &amp; more")

    def test_fails_closed_when_nh3_is_missing(self):
        with mock.patch.dict(sys.modules, {"nh3": None}):  # makes `import nh3` raise ImportError
            with self.assertRaises(svc.SanitizerUnavailable):
                svc.sanitize("<b>x</b>")


class ScannerTests(unittest.TestCase):
    def test_counts(self):
        m = svc.scan_markup('<A HREF="x" title=t disabled><br/><img src=x alt=\'a b\'/></a>text<!--c--><!DOCTYPE html>')
        self.assertEqual(dict(m.tags), {"a": 1, "br": 1, "img": 1})
        self.assertEqual(dict(m.attrs), {("a", "href"): 1, ("a", "title"): 1, ("a", "disabled"): 1,
                                         ("img", "src"): 1, ("img", "alt"): 1})
        self.assertEqual(m.comments, 1)

    def test_odd_input_never_raises(self):
        for text in ("", "<", "<<<", "<a", '<a b="', "<a b='x", "<!--", "<!", "<?", "</", "<a =>", "<a b= c>", "&lt;a&gt;",
                     "<a\x00b>", "<a \ud800>", "<script>", "<plaintext><b>", "<a b=\"x\"c='y'd=z>", " <b >"):
            with self.subTest(text=text):
                svc.scan_markup(text)

    def test_unterminated_constructs_run_to_the_end(self):
        self.assertEqual(svc.scan_markup("<!-- <b> <i>").comments, 1)
        self.assertEqual(dict(svc.scan_markup("<script> <b> <i>").tags), {"script": 1})
        self.assertEqual(dict(svc.scan_markup("<plaintext> <b>").tags), {"plaintext": 1})

    def test_a_lone_lt_is_text(self):
        self.assertEqual(dict(svc.scan_markup("5 < 10 and 3<4 <3 <b>x</b>").tags), {"b": 1})


class PerformanceTests(unittest.TestCase):
    """Guards against quadratic behaviour on hostile input (Python's html.parser takes >20 s on several of these)."""

    N = 256 * 1024
    BUDGET = 1.5  # seconds; the measured worst case is about 0.1 s

    def test_scanner_is_linear_on_adversarial_input(self):
        n = self.N
        cases = {
            "lt run": "<" * n, "a run": "<a " * (n // 3), "comment opens": "<!--" * (n // 4),
            "nested div": "<div>" * (n // 5), "attr openers": "<p x=" * (n // 5), "entities": "&amp;" * (n // 5),
            "cdata": "<![CDATA[" * (n // 9), "pi": "<?" * (n // 2), "open quotes": '<a b="' * (n // 6),
            "single quotes": "<a b='" * (n // 6), "distinct tags": "".join(f"<t{i} a{i}=1>" for i in range(n // 16)),
            "script opens": "<script>" * (n // 8), "textarea opens": "<textarea>" * (n // 10),
            "end tags": "</a " * (n // 4), "spaces in tag": "<a" + " " * (n - 3), "long name": "<" + "a" * (n - 1),
            "many attrs": "<a " + "x " * (n // 2), "equals run": "<a " + "=" * (n - 3), "alternating quotes": "<a b=\"'" * (n // 7),
        }
        for name, text in cases.items():
            with self.subTest(name):
                t0 = time.perf_counter()
                svc.scan_markup(text)
                self.assertLess(time.perf_counter() - t0, self.BUDGET)

    def test_sanitizing_at_the_length_limit_stays_fast_for_deep_nesting(self):
        # nh3 is quadratic in nesting depth: ~0.4 s worst case at 64 000 characters (8 s at 256 000).
        for unit in ("<div>", "<ul><li>", "<b></i>", "<blockquote>"):
            with self.subTest(unit):
                text = unit * (settings.MAX_HTML_LENGTH // len(unit))
                t0 = time.perf_counter()
                svc.sanitize(text)
                self.assertLess(time.perf_counter() - t0, 3.0)


class _Structure(HTMLParser):
    """Independent check (stdlib parser) that sanitized output only contains what the policy allows."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.problems = []

    def handle_starttag(self, tag, attrs):
        if tag not in svc.ALLOWED_TAGS:
            self.problems.append(f"tag <{tag}>")
        for name, value in attrs:
            if tag == "a" and name == "rel" and value == svc.LINK_REL:
                continue  # added by the sanitizer itself
            if name not in svc.ALLOWED_ATTRIBUTES.get(tag, ()):
                self.problems.append(f"attribute {tag}.{name}")
            elif name in ("href", "src") and urlsplit((value or "").strip()).scheme.lower() not in ("", *svc.URL_SCHEMES):
                self.problems.append(f"url {tag}.{name}={value!r}")

    def handle_comment(self, data):
        self.problems.append("comment")


class CorpusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payloads = [p for items in payload_svc.collect_payloads(PAYLOAD_DIR).sources.values() for p in items]

    def test_the_output_for_every_shipped_payload_contains_only_allowed_markup(self):
        self.assertGreater(len(self.payloads), 8000)
        bad = []
        for payload in self.payloads:
            parser = _Structure()
            parser.feed(svc.sanitize(payload).clean)
            parser.close()
            if parser.problems:
                bad.append((payload[:80], parser.problems))
        self.assertEqual(bad[:5], [], f"{len(bad)} payloads left disallowed markup in the output")

    def test_no_output_contains_a_script_tag(self):
        # Coarse but independent of any parser. (`javascript:` may legitimately remain as plain text; what matters
        # is that no URL attribute carries it, which the structural test above checks.)
        for payload in self.payloads:
            self.assertNotIn("<script", svc.sanitize(payload).clean.lower(), payload[:80])

    def test_sanitizing_twice_changes_nothing_more(self):
        # A smoke test for mutation XSS (output that turns into something else when re-parsed); not a proof.
        # HTML input preprocessing turns every CR into LF, so `&#13;` (a CR after decoding) becomes LF on the
        # second pass. That is newline normalization, not a mutation, so it is allowed for.
        def newlines(s):
            return s.replace("\r\n", "\n").replace("\r", "\n")

        unstable = [p[:80] for p in self.payloads
                    if (once := svc.sanitize(p).clean) and svc.sanitize(once).clean != newlines(once)]
        self.assertEqual(unstable[:5], [], f"{len(unstable)} payloads were not stable under a second pass")

    def test_the_report_never_fails_on_real_payloads(self):
        for payload in self.payloads:
            svc.sanitize(payload)


class EndpointTests(unittest.TestCase):
    def post(self, html, **kw):
        return client.post(URL, json={"html": html}, **kw)

    def test_response_shape_and_content(self):
        r = self.post('<p onclick="steal()">Hi <b>there</b> <a href="javascript:alert(1)">click</a><script>alert(1)</script></p>')
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(set(body), {"clean", "changed", "report", "detector"})
        self.assertEqual(body["clean"], '<p>Hi <b>there</b> <a rel="noopener noreferrer">click</a></p>')
        self.assertTrue(body["changed"])
        report = body["report"]
        self.assertEqual(set(report), {"removed_tags", "removed_attributes", "comments_removed",
                                       "total_tags_removed", "total_attributes_removed", "truncated"})
        self.assertEqual(report["removed_tags"], [{"name": "script", "count": 1, "content_removed": True}])
        self.assertEqual({(a["tag"], a["name"], a["reason"]) for a in report["removed_attributes"]},
                         {("p", "onclick", "event_handler"), ("a", "href", "unsafe_url")})
        self.assertEqual((report["total_tags_removed"], report["total_attributes_removed"]), (1, 2))

    def test_detector_block_is_an_alert_not_a_gate(self):
        attack = self.post('<img src=x onerror=alert(1)>').json()
        self.assertTrue(attack["detector"]["is_malicious"])
        self.assertGreaterEqual(attack["detector"]["score"], 25)
        self.assertIn("XSS002", attack["detector"]["rule_ids"])
        self.assertEqual(attack["clean"], '<img src="x">')  # still sanitized and returned with 200

        benign = self.post("<p>Nice article, thanks!</p>").json()
        self.assertFalse(benign["detector"]["is_malicious"])
        self.assertEqual(benign["detector"]["rule_ids"], [])
        self.assertEqual(benign["report"]["total_tags_removed"], 0)

    def test_flagged_input_is_logged_by_rule_id_never_by_content(self):
        with self.assertLogs("app.sanitizer", "WARNING") as cm:
            self.post("<img src=x onerror=alert(1)>SECRET-MARKER")
        text = "\n".join(cm.output)
        self.assertIn("XSS002", text)
        self.assertNotIn("SECRET-MARKER", text)

    def test_empty_html_is_fine(self):
        r = self.post("")
        self.assertEqual((r.status_code, r.json()["clean"], r.json()["changed"]), (200, "", False))

    def test_length_limit_is_413(self):
        limit = settings.MAX_HTML_LENGTH
        self.assertEqual(self.post("a" * limit).status_code, 200)
        r = self.post("a" * (limit + 1))
        self.assertEqual((r.status_code, r.json()), (413, {"error": f"HTML must be at most {limit} characters"}))

    def test_bad_requests_are_400(self):
        cases = [({"json": {}}, "Provide 'html' (string)"), ({"json": {"html": None}}, "Provide 'html' (string)"),
                 ({"json": {"html": 5}}, "Provide 'html' (string)"), ({"json": {"html": ["<b>"]}}, "Provide 'html' (string)"),
                 ({"json": []}, "Body must be a JSON object"),
                 ({"content": b"{x", "headers": {"Content-Type": "application/json"}}, "Body must be valid JSON")]
        for kwargs, message in cases:
            with self.subTest(kwargs):
                r = client.post(URL, **kwargs)
                self.assertEqual((r.status_code, r.json()), (400, {"error": message}))

    def test_503_when_the_sanitizer_is_missing_and_nothing_unsanitized_is_returned(self):
        with mock.patch.dict(sys.modules, {"nh3": None}):
            r = self.post("<script>alert(1)</script>")
        self.assertEqual((r.status_code, r.json()), (503, {"error": "HTML sanitizer unavailable"}))
        self.assertNotIn("script", r.text)

    def test_get_is_not_allowed(self):
        self.assertEqual(client.get(URL).status_code, 405)

    def test_documented_in_openapi(self):
        spec = client.get("/openapi.json").json()
        op = spec["paths"][URL]["post"]
        self.assertIn("allow-list", op["description"])
        self.assertTrue({"200", "400", "413", "503"} <= set(op["responses"]))
        schemas = spec["components"]["schemas"]
        self.assertTrue({"SanitizeRequest", "SanitizeResponse", "SanitizationReport", "RemovedTag", "RemovedAttribute",
                         "DetectorAlert"} <= set(schemas))
        self.assertEqual(schemas["RemovedAttribute"]["properties"]["reason"]["enum"],
                         ["event_handler", "unsafe_url", "tag_not_allowed", "attribute_not_allowed"])


class SwaggerDocsTests(unittest.TestCase):
    def test_every_operation_has_a_summary_a_description_and_documented_fields(self):
        spec = client.get("/openapi.json").json()
        for path, ops in spec["paths"].items():
            for method, op in ops.items():
                with self.subTest(f"{method.upper()} {path}"):
                    self.assertTrue(op.get("summary"), "missing summary")
                    self.assertTrue(op.get("description"), "missing description (docstring)")
        for name, schema in spec["components"]["schemas"].items():
            if name in ("HTTPValidationError", "ValidationError"):
                continue
            for prop, definition in schema.get("properties", {}).items():
                with self.subTest(f"{name}.{prop}"):
                    self.assertTrue(definition.get("description") or "$ref" in definition or "allOf" in definition,
                                    "field has no description")

    def test_swagger_ui_is_served(self):
        self.assertEqual(client.get("/docs").status_code, 200)


if __name__ == "__main__":
    unittest.main()
