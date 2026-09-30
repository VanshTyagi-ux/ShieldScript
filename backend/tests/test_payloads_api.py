"""Seeding service and GET /api/v1/payloads.  Run from backend/:  python -m unittest discover -s tests -t ."""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.database import Base, get_db
from app.core.repo import PAYLOAD_DIR
from app.main import app
from app.models import Payload
from app.schemas.payload import PayloadFilter
from app.services import payloads as svc

URL = f"{settings.API_V1_PREFIX}/payloads"
SOURCES = {
    "a.txt": ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "\"'><svg/onload=alert(1)>"],
    "b.txt": ["javascript:alert(1)", "<b onmouseover=alert(1)>x</b>"],
}
CATEGORIES = {"a.txt": "standard", "b.txt": "bypass"}
by_name = CATEGORIES.__getitem__

# What each shipped file must be tagged with. Changing infer_category or the data folder should be deliberate.
SHIPPED_CATEGORIES = {
    "XSS-BruteLogic.txt": "standard", "XSS-Cheat-Sheet-PortSwigger.txt": "standard", "XSS-Jhaddix.txt": "standard",
    "XSS-OFJAAAH.txt": "standard", "XSS-payloadbox.txt": "standard", "XSS-Vectors-Mario.txt": "standard",
    "XSS-Polyglots.txt": "polyglot", "XSS-innerht-ml.txt": "polyglot",
    "XSS-Bypass-Strings-BruteLogic.txt": "bypass", "XSS-RSNAKE.txt": "bypass", "XSS-Somdev.txt": "bypass",
    "xss-without-parentheses-semi-colons-portswigger.txt": "bypass",
    "XSS-EnDe-evation.txt": "encoded", "XSS-EnDe-h4k.txt": "encoded", "XSS-EnDe-mario.txt": "encoded",
    "XSS-EnDe-xssAttacks.txt": "encoded",
}


class DbTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)
        self.db = Session(self.engine)
        self.addCleanup(self.db.close)

    def count(self, *where):
        return self.db.scalar(select(func.count()).select_from(Payload).where(*where))


class InferCategoryTests(unittest.TestCase):
    def test_shipped_files(self):
        for name, expected in SHIPPED_CATEGORIES.items():
            with self.subTest(name):
                self.assertEqual(svc.infer_category(name), expected)

    def test_every_shipped_file_is_covered_and_no_override_is_stale(self):
        shipped = {p.name for p in PAYLOAD_DIR.glob("*.txt")}
        self.assertEqual(shipped, set(SHIPPED_CATEGORIES))
        self.assertEqual(set(svc.CATEGORY_OVERRIDES) - shipped, set(), "an override names a file that does not exist")

    def test_names_are_matched_by_whole_words_ignoring_case(self):
        cases = {
            "my-POLYGLOTS.txt": "polyglot", "waf_bypass_list.txt": "bypass", "Unicode-Evasion.txt": "bypass",
            "url-encoded.txt": "encoded", "html.ende.txt": "encoded",
            "legend.txt": "standard",  # contains "ende" but is not the word
            "bypassing.txt": "standard",  # not an exact keyword
            "anything.txt": "standard", "": "standard",
        }
        for name, expected in cases.items():
            with self.subTest(name):
                self.assertEqual(svc.infer_category(name), expected)

    def test_priority_when_several_words_match(self):
        self.assertEqual(svc.infer_category("polyglot-bypass.txt"), "polyglot")
        self.assertEqual(svc.infer_category("encoded-bypass.txt"), "encoded")


class CollectTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def write(self, name, data):
        (self.dir / name).write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))

    def test_strips_whitespace_and_skips_blank_lines(self):
        self.write("a.txt", "  <script>alert(1)</script>  \n\n   \n\t\n<b>x</b>\t\n")
        got = svc.collect_payloads(self.dir)
        self.assertEqual(got.sources["a.txt"], ["<script>alert(1)</script>", "<b>x</b>"])
        self.assertEqual((got.lines["a.txt"], got.blank["a.txt"], got.duplicates["a.txt"]), (2, 3, 0))

    def test_line_endings_bom_and_missing_final_newline(self):
        self.write("crlf.txt", b"\xef\xbb\xbf<i>1</i>\r\n<i>2</i>\r<i>3</i>")  # BOM, CRLF, lone CR, no trailing newline
        self.assertEqual(svc.collect_payloads(self.dir).sources["crlf.txt"], ["<i>1</i>", "<i>2</i>", "<i>3</i>"])

    def test_first_file_wins_and_duplicates_are_counted(self):
        self.write("a.txt", "one\ntwo\none\n")
        self.write("b.txt", "two\nthree\n")
        got = svc.collect_payloads(self.dir)
        self.assertEqual(got.sources, {"a.txt": ["one", "two"], "b.txt": ["three"]})
        self.assertEqual(got.duplicates, {"a.txt": 1, "b.txt": 1})
        self.assertEqual(got.lines, {"a.txt": 3, "b.txt": 2})

    def test_files_are_read_in_name_order(self):
        for name in ("c.txt", "a.txt", "b.txt"):
            self.write(name, f"from-{name}\n")
        self.assertEqual(list(svc.collect_payloads(self.dir).sources), ["a.txt", "b.txt", "c.txt"])

    def test_only_txt_files_in_the_folder_itself(self):
        self.write("a.txt", "x1x\n")
        self.write("notes.md", "y1y\n")
        (self.dir / "sub").mkdir()
        (self.dir / "sub" / "deep.txt").write_text("z1z\n", encoding="utf-8")
        self.assertEqual(list(svc.collect_payloads(self.dir).sources), ["a.txt"])

    def test_empty_file_and_undecodable_bytes(self):
        self.write("empty.txt", "")
        self.write("bad.txt", b"<b>ok</b>\n<i>\xff\xfe</i>\n")
        got = svc.collect_payloads(self.dir)
        self.assertEqual(got.sources["empty.txt"], [])
        self.assertEqual(got.sources["bad.txt"], ["<b>ok</b>", "<i>��</i>"])

    def test_unusual_line_separators_stay_inside_the_payload(self):
        # Only \n, \r and \r\n end a line; a vertical tab or U+2028 in the middle of a payload is payload data.
        self.write("a.txt", "<a\x0bhref=x> y</a>\n")
        self.assertEqual(svc.collect_payloads(self.dir).sources["a.txt"], ["<a\x0bhref=x> y</a>"])


class LoaderTests(DbTestCase):
    def load(self, sources=SOURCES, **kw):
        return svc.load_payloads(self.db, sources, category_for=by_name, **kw)

    def test_rows_get_the_file_and_its_category(self):
        stats = self.load()
        self.assertEqual((stats.inserted, stats.skipped_existing, stats.per_file), (5, 0, {"a.txt": 3, "b.txt": 2}))
        rows = {(p.source_file, p.category) for p in self.db.scalars(select(Payload))}
        self.assertEqual(rows, {("a.txt", "standard"), ("b.txt", "bypass")})
        self.assertEqual(self.count(Payload.content == "javascript:alert(1)", Payload.category == "bypass"), 1)

    def test_category_defaults_to_the_inferred_one(self):
        svc.load_payloads(self.db, {"my-polyglots.txt": ["<svg onload=alert(1)>"]})
        self.assertEqual(self.db.scalar(select(Payload.category)), "polyglot")

    def test_running_twice_inserts_nothing_the_second_time(self):
        self.load()
        again = self.load()
        self.assertEqual((again.inserted, again.skipped_existing), (0, 5))
        self.assertEqual(self.count(), 5)

    def test_only_new_lines_are_added_on_a_later_run(self):
        self.load()
        stats = self.load({**SOURCES, "a.txt": SOURCES["a.txt"] + ["<iframe src=javascript:alert(1)>"]})
        self.assertEqual((stats.inserted, stats.skipped_existing), (1, 5))
        self.assertEqual(self.count(Payload.source_file == "a.txt"), 4)

    def test_duplicates_within_the_input_are_stored_once(self):
        stats = self.load({"a.txt": ["x1x", "x1x", "x1x"]})
        self.assertEqual((stats.inserted, self.count()), (1, 1))

    def test_replace_applies_a_new_category_and_leaves_other_files_alone(self):
        self.load()
        self.db.add(Payload(content="keep me", source_file="untouched.txt", category="standard"))
        self.db.commit()

        stats = svc.load_payloads(self.db, SOURCES, replace=True,
                                  category_for={"a.txt": "polyglot", "b.txt": "bypass"}.__getitem__)
        self.assertEqual((stats.deleted, stats.inserted), (5, 5))
        self.assertEqual(self.count(Payload.source_file == "a.txt", Payload.category == "polyglot"), 3)
        self.assertEqual(self.count(Payload.source_file == "untouched.txt"), 1)
        self.assertEqual(self.count(), 6)

    def test_payloads_with_nul_are_skipped_not_stored(self):
        stats = self.load({"a.txt": ["ok<script>", "bad\x00<script>"]})
        self.assertEqual((stats.inserted, stats.skipped_invalid), (1, 1))

    def test_more_rows_than_one_batch(self):
        many = {"a.txt": [f"<svg onload=alert({i})>" for i in range(svc.BATCH_SIZE * 2 + 5)]}
        self.assertEqual(self.load(many).inserted, svc.BATCH_SIZE * 2 + 5)
        self.assertEqual(self.count(), svc.BATCH_SIZE * 2 + 5)

    def test_a_failed_load_leaves_the_table_unchanged(self):
        self.load()
        with mock.patch.object(svc, "insert", side_effect=RuntimeError("disk full")):
            with self.assertRaises(RuntimeError):
                svc.load_payloads(self.db, SOURCES, replace=True, category_for=by_name)  # deletes, then fails
        self.assertEqual(self.count(), 5)  # the delete was rolled back with it


class ListTests(DbTestCase):
    def setUp(self):
        super().setUp()
        svc.load_payloads(self.db, {"a.txt": [f"a-{i:02d}" for i in range(10)], "b.txt": [f"b-{i:02d}" for i in range(5)]},
                          category_for=by_name)

    def ls(self, **kw):
        rows, total = svc.list_payloads(self.db, PayloadFilter(**kw))
        return [r.content for r in rows], total

    def test_filters_and_total(self):
        self.assertEqual(self.ls()[1], 15)
        self.assertEqual(self.ls(source_file="b.txt")[1], 5)
        self.assertEqual(self.ls(category="standard")[1], 10)
        self.assertEqual(self.ls(source_file="a.txt", category="bypass"), ([], 0))  # both must match
        self.assertEqual(self.ls(source_file="nope.txt"), ([], 0))

    def test_pages_are_ordered_disjoint_and_total_ignores_paging(self):
        first, total = self.ls(limit=6)
        second, _ = self.ls(limit=6, skip=6)
        third, _ = self.ls(limit=6, skip=12)
        self.assertEqual(first + second + third, [f"a-{i:02d}" for i in range(10)] + [f"b-{i:02d}" for i in range(5)])
        self.assertEqual((len(third), total), (3, 15))
        self.assertEqual(self.ls(skip=100), ([], 15))


class EndpointTests(DbTestCase):
    def setUp(self):
        super().setUp()
        svc.load_payloads(self.db, {"a.txt": [f"a-{i:02d}" for i in range(10)], "b.txt": ["<b>\"quoted\" 😀 \\ </b>"]},
                          category_for=by_name)
        app.dependency_overrides[get_db] = lambda: (yield self.db)
        self.addCleanup(app.dependency_overrides.pop, get_db, None)
        self.client = TestClient(app)

    def test_default_page(self):
        body = self.client.get(URL).json()
        self.assertEqual((body["total"], body["skip"], body["limit"], len(body["items"])), (11, 0, 50, 11))
        self.assertEqual(set(body["items"][0]), {"id", "content", "source_file", "category", "created_at"})
        ids = [i["id"] for i in body["items"]]
        self.assertEqual(ids, sorted(ids))

    def test_query_parameters(self):
        body = self.client.get(URL, params={"source_file": "a.txt", "category": "standard", "skip": 8, "limit": 5}).json()
        self.assertEqual([i["content"] for i in body["items"]], ["a-08", "a-09"])
        self.assertEqual((body["total"], body["skip"], body["limit"]), (10, 8, 5))
        self.assertEqual(self.client.get(URL, params={"category": "bypass"}).json()["total"], 1)
        self.assertEqual(self.client.get(URL, params={"category": "nope"}).json()["items"], [])

    def test_blank_filter_means_no_filter(self):
        self.assertEqual(self.client.get(URL + "?category=&source_file=").json()["total"], 11)

    def test_content_survives_json_untouched(self):
        item = self.client.get(URL, params={"source_file": "b.txt"}).json()["items"][0]
        self.assertEqual(item["content"], "<b>\"quoted\" 😀 \\ </b>")

    def test_bad_parameters_are_400_with_a_readable_error(self):
        # skip=2**63 used to overflow SQLite's integer and answer 500
        for query, field in (("limit=501", "limit"), ("limit=0", "limit"), ("skip=-1", "skip"), ("limit=abc", "limit"),
                             (f"skip={2**63}", "skip"), (f"skip={10**30}", "skip"), (f"skip={2**31}", "skip")):
            with self.subTest(query):
                r = self.client.get(f"{URL}?{query}")
                self.assertEqual(r.status_code, 400)
                self.assertTrue(r.json()["error"].startswith(f"{field}: "), r.json())

    def test_documented_in_openapi(self):
        params = self.client.get("/openapi.json").json()["paths"][URL]["get"]["parameters"]
        self.assertEqual({p["name"] for p in params}, {"source_file", "category", "skip", "limit"})


class DetailEndpointTests(DbTestCase):
    def setUp(self):
        super().setUp()
        svc.load_payloads(self.db, {"a.txt": ["<svg onload=alert(1)>", "<b>\"q\" 😀</b>"]}, category_for=by_name)
        app.dependency_overrides[get_db] = lambda: (yield self.db)
        self.addCleanup(app.dependency_overrides.pop, get_db, None)
        self.client = TestClient(app)

    def test_returns_the_full_record(self):
        r = self.client.get(f"{URL}/2")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual((body["id"], body["content"], body["source_file"], body["category"]),
                         (2, "<b>\"q\" 😀</b>", "a.txt", "standard"))
        self.assertEqual(set(body), {"id", "content", "source_file", "category", "created_at"})

    def test_matches_the_list_entry(self):
        listed = self.client.get(URL).json()["items"]
        for item in listed:
            self.assertEqual(self.client.get(f"{URL}/{item['id']}").json(), item)

    def test_unknown_id_is_404_with_the_error_shape(self):
        r = self.client.get(f"{URL}/999")
        self.assertEqual((r.status_code, r.json()), (404, {"error": "Payload not found"}))

    def test_invalid_ids_are_400_not_500(self):
        # 2**31 does not fit the column's integer type; 2**63 would overflow SQLite's driver.
        for bad in ("0", "-1", "abc", "1.5", str(2**31), str(2**63), "9" * 40):
            with self.subTest(bad):
                r = self.client.get(f"{URL}/{bad}")
                self.assertEqual(r.status_code, 400, r.text)
                self.assertTrue(r.json()["error"].startswith("payload_id: "), r.json())

    def test_the_largest_valid_id_is_a_clean_404(self):
        self.assertEqual(self.client.get(f"{URL}/{2**31 - 1}").status_code, 404)

    def test_unknown_routes_keep_the_generic_404(self):
        self.assertEqual(self.client.get(f"{URL}/1/extra").json(), {"error": "Not found"})

    def test_documented_in_openapi(self):
        op = self.client.get("/openapi.json").json()["paths"][f"{URL}/{{payload_id}}"]["get"]
        self.assertTrue(op["description"])
        self.assertEqual({"200", "400", "404"} <= set(op["responses"]), True)


class RealDataTests(DbTestCase):
    def test_every_shipped_payload_is_seeded_with_its_category(self):
        found = svc.collect_payloads(PAYLOAD_DIR)
        expected = sum(len(v) for v in found.sources.values())
        self.assertGreater(expected, 8000)

        stats = svc.load_payloads(self.db, found.sources)
        self.assertEqual((stats.inserted, self.count()), (expected, expected))
        self.assertEqual(stats.per_file, {n: len(v) for n, v in found.sources.items() if v})
        for name, category in SHIPPED_CATEGORIES.items():
            with self.subTest(name):
                self.assertEqual(self.count(Payload.source_file == name, Payload.category != category), 0)
        self.assertEqual(svc.load_payloads(self.db, found.sources).inserted, 0)  # idempotent on the real data too

    def test_no_payload_is_stored_twice(self):
        svc.load_payloads(self.db, svc.collect_payloads(PAYLOAD_DIR).sources)
        distinct = self.db.scalar(select(func.count(func.distinct(Payload.content))))
        self.assertEqual(distinct, self.count())


if __name__ == "__main__":
    unittest.main()
