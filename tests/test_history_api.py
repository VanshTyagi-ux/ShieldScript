import codecs
import csv
import io
import json
import unittest
import urllib.error
import urllib.request

from tests.helpers import ServerTestCase, call
from xss_detector import config as settings
from xss_detector.config import Config
from xss_detector.server import API_COSTS

ATTACK = "<img src=x onerror=alert(1)>"


def rows(httpd):
    return httpd.store.page(limit=100)["items"]


class StoreWriteTests(ServerTestCase):
    def test_scan_stores_one_row_per_field_whatever_the_source(self):
        httpd, base = self.serve_httpd(Config())
        call(base, "/api/scan", {"fields": {"name": "Ada", "comment": ATTACK}})
        call(base, "/api/scan", {"fields": {"name": "Grace Hopper", "comment": "<script>x</script>"},
                                 "source": "dummy-site"})
        got = rows(httpd)
        self.assertEqual(len(got), 4)
        first = {r["field"]: r for r in got if r["text"] in ("Ada", ATTACK)}
        self.assertEqual(set(first), {"name", "comment"})
        self.assertTrue(first["comment"]["blocked"])
        self.assertIn("XSS002", first["comment"]["rules"])
        self.assertEqual(first["comment"]["source"], "")
        second = {r["field"]: r for r in got if r["source"] == "dummy-site"}
        self.assertEqual(set(second), {"name", "comment"})

    def test_scan_text_row_records_field_text_decode_layers_and_ml(self):
        httpd, base = self.serve_httpd(Config())
        call(base, "/api/scan", {"text": "%3Cscript%3Ealert(1)%3C/script%3E"})
        (row,) = rows(httpd)
        self.assertEqual(row["field"], "text")
        self.assertGreaterEqual(row["decode_layers"], 1)
        self.assertIn("XSS001", row["rules"])
        self.assertIsInstance(row["ml_probability"], float)

    def test_submit_stores_rows_with_an_empty_source(self):
        httpd, base = self.serve_httpd(Config())
        status, _, _ = call(base, "/api/submit", {"fields": {"name": "Ada", "comment": ATTACK}})
        self.assertEqual(status, 422)
        got = {r["field"]: r for r in rows(httpd)}
        self.assertEqual(set(got), {"name", "comment"})
        self.assertTrue(got["comment"]["blocked"])
        self.assertEqual({r["source"] for r in got.values()}, {""})

    def test_requests_that_fail_validation_store_nothing(self):
        httpd, base = self.serve_httpd(Config())
        self.assertEqual(call(base, "/api/scan", {"text": ATTACK, "source": "Bad Source"})[0], 400)
        self.assertEqual(call(base, "/api/scan", {"nothing": 1})[0], 400)
        self.assertEqual(httpd.store.page()["total"], 0)

    def test_a_storage_failure_does_not_fail_the_scan(self):
        httpd, base = self.serve_httpd(Config())

        def boom(rows):
            raise RuntimeError("disk full")

        httpd.store.add_many = boom
        with self.assertLogs("xss_detector.server", level="WARNING"):
            status, _, body = call(base, "/api/scan", {"text": ATTACK})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["is_malicious"])

    def test_long_input_is_stored_cut(self):
        httpd, base = self.serve_httpd(Config())
        status, _, _ = call(base, "/api/scan", {"text": "a" * 200_000})
        self.assertEqual(status, 200)
        (row,) = rows(httpd)
        self.assertEqual(len(row["text"]), 1000)

    def test_a_many_field_scan_is_written_in_one_batch(self):
        httpd, base = self.serve_httpd(Config())
        batches = []
        real = httpd.store.add_many

        def spy(batch):
            batches.append(len(batch))
            return real(batch)

        httpd.store.add_many = spy
        call(base, "/api/scan", {"fields": {f"f{i}": f"value {i}" for i in range(50)}})
        self.assertEqual(batches, [50])
        self.assertEqual(httpd.store.page()["total"], 50)

    def test_store_false_keeps_a_scan_out_of_the_history(self):
        httpd, base = self.serve_httpd(Config())
        status, _, body = call(base, "/api/scan", {"text": ATTACK, "store": False})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["is_malicious"])
        call(base, "/api/scan", {"fields": {"comment": ATTACK}, "store": False})
        self.assertEqual(httpd.store.page()["total"], 0)
        call(base, "/api/scan", {"text": "hello there", "store": True})
        self.assertEqual(httpd.store.page()["total"], 1)

    def test_store_must_be_a_boolean(self):
        httpd, base = self.serve_httpd(Config())
        for bad in ("no", 0, None, [False]):
            with self.subTest(store=bad):
                status, _, body = call(base, "/api/scan", {"text": ATTACK, "store": bad})
                self.assertEqual(status, 400)
                self.assertEqual(json.loads(body)["error"], "'store' must be true or false")
        self.assertEqual(httpd.store.page()["total"], 0)

    def test_typing_in_the_scanner_collapses_to_one_row(self):
        httpd, base = self.serve_httpd(Config())
        call(base, "/api/scan", {"text": "<img"})
        call(base, "/api/scan", {"text": "<img src=x"})
        (row,) = rows(httpd)
        self.assertEqual(row["text"], "<img src=x")


class StoreSwitchTests(ServerTestCase):
    def test_storing_is_off_by_default_on_a_public_bind(self):
        httpd, base = self.serve_httpd(Config(), host="0.0.0.0")
        self.assertIsNone(httpd.store)
        self.assertEqual(call(base, "/api/scan", {"text": ATTACK})[0], 200)
        forced_on, _ = self.serve_httpd(Config(store_scans="1"), host="0.0.0.0")
        self.assertIsNotNone(forced_on.store)
        forced_off, _ = self.serve_httpd(Config(store_scans="0"))
        self.assertIsNone(forced_off.store)

    def test_an_unusable_database_path_leaves_storing_off(self):
        missing = settings.DEFAULT_SCAN_DB.parent / "missing-dir" / "x.db"
        httpd, base = self.serve_httpd(Config(scan_db=str(missing)))
        self.assertIsNone(httpd.store)
        self.assertEqual(call(base, "/api/scan", {"text": ATTACK})[0], 200)


OFF = {"enabled": False, "items": [], "total": 0, "counts": {"all": 0, "blocked": 0, "allowed": 0}}


def get_json(base, path):
    status, headers, body = call(base, path)
    return status, json.loads(body)


class HistoryRouteTests(ServerTestCase):
    def seeded(self, config=None):
        base = self.serve(config or Config())
        for text in ("alpha one", "bravo two", ATTACK):
            call(base, "/api/scan", {"text": text})
        return base

    def test_history_lists_newest_first_with_totals(self):
        status, body = get_json(self.seeded(), "/api/history")
        self.assertEqual(status, 200)
        self.assertIs(body["enabled"], True)
        self.assertEqual([i["text"] for i in body["items"]], [ATTACK, "bravo two", "alpha one"])
        self.assertEqual(body["total"], 3)
        self.assertEqual(body["counts"], {"all": 3, "blocked": 1, "allowed": 2})

    def test_history_filter_limit_and_offset(self):
        base = self.seeded()
        blocked = get_json(base, "/api/history?filter=blocked")[1]
        self.assertEqual((blocked["total"], [i["text"] for i in blocked["items"]]), (1, [ATTACK]))
        self.assertEqual(get_json(base, "/api/history?filter=allowed")[1]["total"], 2)
        paged = get_json(base, "/api/history?limit=2&offset=2")[1]
        self.assertEqual([i["text"] for i in paged["items"]], ["alpha one"])
        self.assertEqual(paged["total"], 3)
        past = get_json(base, "/api/history?offset=100")[1]
        self.assertEqual((past["items"], past["total"]), ([], 3))

    def test_history_rejects_bad_parameters(self):
        base = self.seeded()
        for query in ("filter=maybe", "limit=0", "limit=101", "limit=x", "offset=-1", "offset=x"):
            with self.subTest(query=query):
                status, body = get_json(base, "/api/history?" + query)
                self.assertEqual(status, 400)
                self.assertIn("error", body)

    def test_history_when_storing_is_off(self):
        base = self.serve(Config(), host="0.0.0.0")
        self.assertEqual(get_json(base, "/api/history"), (200, OFF))

    def test_export_csv_and_json(self):
        base = self.seeded()
        status, headers, body = call(base, "/api/history/export?format=csv")
        self.assertEqual(status, 200)
        self.assertTrue(headers["Content-Type"].startswith("text/csv"))
        self.assertEqual(headers["Content-Disposition"], 'attachment; filename="scriptshield-history.csv"')
        self.assertTrue(body.startswith(codecs.BOM_UTF8))
        self.assertEqual(len(list(csv.reader(io.StringIO(body.decode("utf-8-sig"), newline="")))), 4)
        status, headers, body = call(base, "/api/history/export?format=json")
        self.assertEqual(status, 200)
        self.assertTrue(headers["Content-Type"].startswith("application/json"))
        self.assertEqual(headers["Content-Disposition"], 'attachment; filename="scriptshield-history.json"')
        self.assertEqual([r["text"] for r in json.loads(body)], [ATTACK, "bravo two", "alpha one"])
        for query in ("", "?format=xml"):
            with self.subTest(query=query):
                self.assertEqual(call(base, "/api/history/export" + query)[0], 400)

    def test_export_csv_neutralises_a_formula_payload(self):
        base = self.serve(Config())
        call(base, "/api/scan", {"text": "=cmd|' /C calc'!A0"})
        body = call(base, "/api/history/export?format=csv")[2].decode("utf-8-sig")
        cells = list(csv.reader(io.StringIO(body, newline="")))[1]
        self.assertEqual(cells[4], "'=cmd|' /C calc'!A0")

    def test_export_when_off_is_404(self):
        base = self.serve(Config(), host="0.0.0.0")
        status, _, body = call(base, "/api/history/export?format=csv")
        self.assertEqual((status, json.loads(body)), (404, {"error": "History is off"}))

    def test_clear_empties_the_history(self):
        base = self.seeded()
        status, _, body = call(base, "/api/history/clear", {})
        self.assertEqual((status, json.loads(body)), (200, {"cleared": 3}))
        self.assertEqual(get_json(base, "/api/history")[1]["total"], 0)

    def test_clear_requires_a_json_content_type_and_is_a_no_op_when_off(self):
        base = self.seeded()
        request = urllib.request.Request(base + "/api/history/clear", data=b"{}", method="POST",
                                         headers={"Content-Type": "text/plain"})
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(request)
        self.assertEqual(ctx.exception.code, 415)
        self.assertEqual(get_json(base, "/api/history")[1]["total"], 3)
        off = self.serve(Config(), host="0.0.0.0")
        self.assertEqual(json.loads(call(off, "/api/history/clear", {})[2]), {"cleared": 0})

    def test_history_routes_have_the_documented_costs_and_the_page_exists(self):
        self.assertEqual(API_COSTS[("GET", "/api/history")], 0.25)
        self.assertEqual(API_COSTS[("GET", "/api/history/export")], 1.0)
        status, _, body = call(self.serve(Config()), "/history")
        self.assertEqual(status, 200)
        self.assertIn(b'<div id="root">', body)


if __name__ == "__main__":
    unittest.main()
