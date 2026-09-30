"""Run from backend/:  python -m unittest discover -s tests -t ."""

import unittest

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import detector as svc

client = TestClient(app)
V1 = settings.API_V1_PREFIX
ATTACK = "<img src=x onerror=alert(1)>"
HARMLESS = "Hello, I would like to order 5 items."
FORM_OK = {"name": "Ada", "email": "ada@example.com", "website": "https://example.com", "comment": "5 < 10."}


class ScanTests(unittest.TestCase):
    def test_attack_text_is_flagged(self):
        r = client.post(f"{V1}/scan", json={"text": ATTACK})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["is_malicious"])
        self.assertEqual(body["level"], "critical")
        self.assertIn("XSS002", [f["rule_id"] for f in body["findings"]])
        self.assertIn("ml_probability", body)

    def test_harmless_text_is_allowed(self):
        body = client.post(f"{V1}/scan", json={"text": HARMLESS}).json()
        self.assertFalse(body["is_malicious"])
        self.assertEqual(body["findings"], [])

    def test_response_is_identical_to_the_detector_output(self):
        # The wire format must not drift from what the stdlib server sends (nulls included).
        for text in (ATTACK, HARMLESS, "%3Cscript%3Ealert(1)%3C/script%3E", "", "😀 <b>x</b>"):
            with self.subTest(text=text):
                self.assertEqual(client.post(f"{V1}/scan", json={"text": text}).json(), svc.detector.scan(text))

    def test_fields_mode(self):
        body = client.post(f"{V1}/scan", json={"fields": {"a": ATTACK, "b": HARMLESS}}).json()
        self.assertEqual(set(body["results"]), {"a", "b"})
        self.assertTrue(body["results"]["a"]["is_malicious"])
        self.assertFalse(body["results"]["b"]["is_malicious"])

    def test_fields_win_when_both_are_sent(self):
        body = client.post(f"{V1}/scan", json={"text": HARMLESS, "fields": {"a": ATTACK}}).json()
        self.assertIn("results", body)

    def test_bad_requests_are_400_with_an_error_message(self):
        cases = {
            "empty object": ({"json": {}}, "Provide 'text' (string) or 'fields' (object)"),
            "null text": ({"json": {"text": None}}, "Provide 'text' (string) or 'fields' (object)"),
            "number text": ({"json": {"text": 5}}, "Provide 'text' (string) or 'fields' (object)"),
            "non-string field": ({"json": {"fields": {"a": 1}}}, "Provide 'text' (string) or 'fields' (object)"),
            "not json": ({"content": b"{nope", "headers": {"Content-Type": "application/json"}},
                         "Body must be valid JSON"),
            "json array": ({"json": [1, 2]}, "Body must be a JSON object"),
        }
        for name, (kwargs, message) in cases.items():
            with self.subTest(name):
                r = client.post(f"{V1}/scan", **kwargs)
                self.assertEqual(r.status_code, 400)
                self.assertEqual(r.json(), {"error": message})


class SubmitTests(unittest.TestCase):
    def post(self, fields):
        return client.post(f"{V1}/submit", json={"fields": fields})

    def test_clean_form_is_accepted_and_escaped(self):
        r = self.post(FORM_OK)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["accepted"])
        self.assertEqual(body["sanitized"]["comment"], "5 &lt; 10.")
        self.assertEqual(set(body["results"]), set(FORM_OK))

    def test_xss_is_rejected_with_a_per_field_error(self):
        with self.assertLogs("xss_detector.server", "WARNING"):
            r = self.post({**FORM_OK, "comment": ATTACK})
        self.assertEqual(r.status_code, 422)
        body = r.json()
        self.assertFalse(body["accepted"])
        self.assertEqual(list(body["errors"]), ["comment"])
        self.assertIn("Potential XSS detected", body["errors"]["comment"])
        self.assertTrue(body["results"]["comment"]["is_malicious"])

    def test_bad_email_and_disallowed_website_are_rejected(self):
        r = self.post({**FORM_OK, "email": "not-an-email", "website": "ftp://example.com"})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["errors"], {"email": "Invalid email address",
                                              "website": "Website must start with http:// or https://"})
        self.assertEqual(self.post({**FORM_OK, "website": "example.com"}).status_code, 422)  # no scheme

    def test_javascript_url_is_rejected_as_xss(self):
        # The detector runs first, so its message wins over the generic website message.
        with self.assertLogs("xss_detector.server", "WARNING"):
            r = self.post({**FORM_OK, "website": "javascript:alert(1)"})
        self.assertEqual(r.status_code, 422)
        self.assertIn("Potential XSS detected", r.json()["errors"]["website"])

    def test_matches_the_stdlib_server_policy(self):
        # Both servers call the same function; pin that the HTTP layer adds nothing and drops nothing.
        for fields in (FORM_OK, {**FORM_OK, "email": "x"}):
            with self.subTest(fields=fields):
                status, payload = svc.submit_fields(fields)
                r = self.post(fields)
                self.assertEqual((r.status_code, r.json()), (status, payload))

    def test_bad_requests_are_400(self):
        for body in ({}, {"fields": "x"}, {"fields": {"a": 1}}, {"fields": None}):
            with self.subTest(body=body):
                r = client.post(f"{V1}/submit", json=body)
                self.assertEqual(r.status_code, 400)
                self.assertEqual(r.json(), {"error": "'fields' must be an object of strings"})


class TransportTests(unittest.TestCase):
    def test_oversized_body_is_413_json_with_cors_headers(self):
        big = b'{"text": "' + b"a" * (settings.MAX_BODY + 1) + b'"}'
        r = client.post(f"{V1}/scan", content=big,
                        headers={"Content-Type": "application/json", "Origin": "http://localhost:5173"})
        self.assertEqual(r.status_code, 413)
        self.assertIn("at most", r.json()["error"])
        self.assertEqual(r.headers.get("access-control-allow-origin"), "http://localhost:5173")

    def test_body_at_the_limit_is_accepted(self):
        pad = settings.MAX_BODY - len(b'{"text": ""}')
        r = client.post(f"{V1}/scan", content=b'{"text": "' + b"a" * pad + b'"}',
                        headers={"Content-Type": "application/json"})
        self.assertEqual(r.status_code, 200)

    def test_body_without_content_length_is_411(self):
        def chunks():
            yield b'{"text": "hi"}'
        r = client.post(f"{V1}/scan", content=chunks(), headers={"Content-Type": "application/json"})
        self.assertEqual(r.status_code, 411)
        self.assertEqual(r.json(), {"error": "Content-Length header required"})

    def test_unknown_route_and_wrong_method_use_the_error_shape(self):
        self.assertEqual(client.get(f"{V1}/nope").json(), {"error": "Not found"})
        r = client.get(f"{V1}/scan")
        self.assertEqual(r.status_code, 405)
        self.assertIn("error", r.json())

    def test_unexpected_errors_are_json_500_without_details(self):
        from app.core.database import get_db

        def broken_db():
            raise RuntimeError("secret connection string leaked here")
            yield  # pragma: no cover  (makes this a generator like the real dependency)

        app.dependency_overrides[get_db] = broken_db
        self.addCleanup(app.dependency_overrides.pop, get_db, None)
        with self.assertLogs("app.errors", "ERROR"):
            r = TestClient(app, raise_server_exceptions=False).get(f"{V1}/payloads")
        self.assertEqual((r.status_code, r.json()), (500, {"error": "Internal server error"}))
        self.assertNotIn("secret", r.text)

    def test_cors_preflight_for_the_react_dev_servers(self):
        for origin in ("http://localhost:3000", "http://localhost:5173"):
            r = client.options(f"{V1}/scan", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                                      "Access-Control-Request-Headers": "content-type"})
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.headers["access-control-allow-origin"], origin)

    def test_openapi_documents_both_endpoints(self):
        paths = client.get("/openapi.json").json()["paths"]
        self.assertIn(f"{V1}/scan", paths)
        self.assertIn(f"{V1}/submit", paths)
        self.assertIn("422", paths[f"{V1}/submit"]["post"]["responses"])


if __name__ == "__main__":
    unittest.main()
