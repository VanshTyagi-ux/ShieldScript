import threading
import unittest

from xss_detector.events import MAX_TEXT, EventLog


def add(log, **over):
    args = dict(source="dummy-site", field="comment", blocked=True, score=95, level="critical",
                rules=["XSS002"], text="<img src=x onerror=alert(1)>")
    args.update(over)
    return log.add(**args)


class EventLogTests(unittest.TestCase):
    def test_add_assigns_increasing_ids_starting_at_one(self):
        log = EventLog()
        self.assertEqual([add(log)["id"] for _ in range(3)], [1, 2, 3])

    def test_snapshot_is_newest_first_and_a_copy(self):
        log = EventLog()
        for name in ("a", "b", "c"):
            add(log, field=name)
        snapshot = log.snapshot()
        self.assertEqual([e["field"] for e in snapshot], ["c", "b", "a"])
        snapshot.clear()
        self.assertEqual(len(log.snapshot()), 3)

    def test_buffer_keeps_only_the_last_100(self):
        log = EventLog()
        for _ in range(130):
            add(log)
        snapshot = log.snapshot()
        self.assertEqual(len(snapshot), 100)
        self.assertEqual((snapshot[0]["id"], snapshot[-1]["id"]), (130, 31))

    def test_text_is_cut_to_200_characters_not_bytes(self):
        event = add(EventLog(), text="é" * 250)
        self.assertEqual(MAX_TEXT, 200)
        self.assertEqual(event["text"], "é" * 200)

    def test_event_has_exactly_the_documented_keys(self):
        event = add(EventLog())
        self.assertEqual(set(event), {"id", "ts", "source", "field", "blocked", "score", "level", "rules", "text"})
        self.assertRegex(event["ts"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+00:00$")

    def test_clear_returns_the_count_and_empties_the_log(self):
        log = EventLog()
        for _ in range(3):
            add(log)
        self.assertEqual(log.clear(), 3)
        self.assertEqual(log.snapshot(), [])
        self.assertEqual(log.clear(), 0)

    def test_ids_keep_counting_after_a_clear(self):
        log = EventLog()
        add(log)
        add(log)
        log.clear()
        self.assertEqual(add(log)["id"], 3)

    def test_concurrent_adds_lose_nothing(self):
        log = EventLog(maxlen=1000)
        threads = [threading.Thread(target=lambda: [add(log) for _ in range(50)]) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len({e["id"] for e in log.snapshot()}), 400)


if __name__ == "__main__":
    unittest.main()
