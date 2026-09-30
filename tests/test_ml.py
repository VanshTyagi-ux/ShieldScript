import tempfile
import unittest
from pathlib import Path

from xss_detector.corpus import HARD_BENIGN, PAYLOAD_DIR, load_benign, load_dataset, split_of
from xss_detector.ml import HybridDetector, MLDetector, features


class StubML:
    threshold = 0.5

    def __init__(self, p):
        self.p = p

    def probability(self, text):
        return self.p


class MLTests(unittest.TestCase):
    def test_features_see_through_encoding(self):
        self.assertEqual(features("%3Cscript%3Ealert(1)"), features("<script>alert(1)"))

    def test_train_save_load_roundtrip(self):
        mal = [f"<script>alert({i})</script>" for i in range(30)] + [f"<img src=x onerror=alert({i})>" for i in range(30)]
        ben = [f"hello there number {i}, how are you" for i in range(60)]
        model = MLDetector.train(mal, ben, epochs=5)
        self.assertGreater(model.probability("<script>alert(99)</script>"), 0.9)
        self.assertLess(model.probability("hello there, how are you"), 0.1)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "m.json"
            model.save(path)
            loaded = MLDetector.load(path)
        self.assertAlmostEqual(loaded.probability("<img src=x onerror=alert(5)>"),
                               model.probability("<img src=x onerror=alert(5)>"), places=3)


class HybridTests(unittest.TestCase):
    def test_ml_alone_never_blocks(self):
        hybrid = HybridDetector(ml=StubML(1.0))
        result = hybrid.scan("5 < 10")
        self.assertFalse(result["is_malicious"])
        self.assertTrue(result["ml_malicious"])

    def test_ml_escalates_low_rule_evidence(self):
        hybrid = HybridDetector(ml=StubML(0.99))
        self.assertTrue(hybrid.scan("a=alert,a(1)")["is_malicious"])  # rules alone: score 20
        self.assertFalse(HybridDetector(ml=StubML(0.5)).scan("a=alert,a(1)")["is_malicious"])

    def test_rules_still_block_when_ml_disagrees(self):
        self.assertTrue(HybridDetector(ml=StubML(0.0)).scan("<script>alert(1)</script>")["is_malicious"])

    def test_without_model(self):
        hybrid = HybridDetector(ml=None)
        hybrid.ml = None
        result = hybrid.scan("<script>alert(1)</script>")
        self.assertIsNone(result["ml_probability"])
        self.assertTrue(result["is_malicious"])


@unittest.skipUnless(PAYLOAD_DIR.exists() and any(PAYLOAD_DIR.glob("*.txt")), "payload lists not downloaded")
class CorpusTests(unittest.TestCase):
    def test_split_is_disjoint_and_deterministic(self):
        data = load_dataset()
        for group in ("malicious", "benign"):
            train, test = set(data[group]["train"]), set(data[group]["test"])
            self.assertFalse(train & test)
            self.assertTrue(train and test)
        self.assertEqual(split_of("abc"), split_of("abc"))

    def test_hard_negatives_never_in_training_data(self):
        self.assertFalse(set(HARD_BENIGN) & set(load_benign()))


if __name__ == "__main__":
    unittest.main()
