"""Small dependency-free machine-learning detector.

Features : hashed character 1-4-grams of the *decoded* text (same normalisation as
           the rule engine, so encoded payloads look like their plain form) plus
           whole-word tokens.
Model    : logistic regression trained with SGD + L2 regularisation.
Storage  : sparse JSON (xss_detector/model.json).
"""

from __future__ import annotations

import json
import math
import random
import re
import zlib
from pathlib import Path

from .detector import XSSDetector, normalize

MODEL_PATH = Path(__file__).parent / "model.json"
DIM = 1 << 16
_WORD = re.compile(r"[a-z_]{2,}")


def features(text: str) -> list[int]:
    """Hashed binary feature indices for `text`."""
    decoded, _ = normalize(str(text))
    s = decoded.lower()[:2000]
    feats = set()
    for n in (1, 2, 3, 4):
        for i in range(len(s) - n + 1):
            feats.add(zlib.crc32(s[i:i + n].encode("utf-8", "replace")) % DIM)
    for w in _WORD.findall(s):
        feats.add(zlib.crc32(b"w:" + w.encode()) % DIM)
    feats.add(zlib.crc32(b"len:%d" % min(len(s) // 20, 20)) % DIM)
    return sorted(feats)


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


class MLDetector:
    def __init__(self, weights: dict[int, float] | None = None, bias: float = 0.0, threshold: float = 0.5):
        self.weights = weights or {}
        self.bias = bias
        self.threshold = threshold

    def probability(self, text) -> float:
        w = self.weights
        return _sigmoid(self.bias + sum(w.get(i, 0.0) for i in features(text)))

    def is_malicious(self, text) -> bool:
        return self.probability(text) >= self.threshold

    # -- training ---------------------------------------------------------------
    @classmethod
    def train(cls, malicious: list[str], benign: list[str], epochs: int = 8, lr: float = 0.3,
              l2: float = 1e-6, seed: int = 1) -> "MLDetector":
        data = [(features(t), 1.0) for t in malicious] + [(features(t), 0.0) for t in benign]
        # class weights keep the (smaller) malicious class from being drowned out
        pos_w = len(data) / (2 * max(1, len(malicious)))
        neg_w = len(data) / (2 * max(1, len(benign)))
        w: dict[int, float] = {}
        bias = 0.0
        rng = random.Random(seed)
        for epoch in range(epochs):
            rng.shuffle(data)
            step = lr / (1 + epoch)
            for feats, y in data:
                z = bias + sum(w.get(i, 0.0) for i in feats)
                grad = (_sigmoid(z) - y) * (pos_w if y else neg_w)
                for i in feats:
                    w[i] = w.get(i, 0.0) * (1 - step * l2) - step * grad
                bias -= step * grad
        return cls({i: round(v, 5) for i, v in w.items() if abs(v) > 1e-4}, round(bias, 5))

    def save(self, path: Path = MODEL_PATH) -> None:
        payload = {"dim": DIM, "bias": self.bias, "threshold": self.threshold,
                   "weights": {str(i): v for i, v in self.weights.items()}}
        path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    @classmethod
    def load(cls, path: Path = MODEL_PATH) -> "MLDetector":
        data = json.loads(path.read_text(encoding="utf-8"))
        if data["dim"] != DIM:
            raise ValueError("model was trained with a different feature dimension; retrain it")
        return cls({int(i): v for i, v in data["weights"].items()}, data["bias"], data["threshold"])

    @classmethod
    def load_default(cls) -> "MLDetector | None":
        return cls.load() if MODEL_PATH.exists() else None


class HybridDetector:
    """Rules decide; ML is a second opinion that can only *escalate*.

    Input is malicious if the rule score reaches the block threshold, or if the rules found
    *some* evidence (a low-scoring finding) and the ML model is very confident
    (probability >= ml_threshold). ML alone never blocks: on short benign text such as
    "5 < 10" it acts as a "looks like code" detector and would reject real users.
    """

    def __init__(self, rules: XSSDetector | None = None, ml: MLDetector | None = None,
                 ml_threshold: float = 0.95):
        self.rules = rules or XSSDetector()
        self.ml = ml or MLDetector.load_default()
        self.ml_threshold = ml_threshold

    def scan(self, text) -> dict:
        result = self.rules.scan(text)
        payload = result.to_dict()
        prob = self.ml.probability(text) if self.ml else None
        payload["ml_probability"] = None if prob is None else round(prob, 4)
        payload["ml_malicious"] = None if prob is None else prob >= self.ml_threshold
        payload["is_malicious"] = result.is_malicious or bool(payload["ml_malicious"] and result.findings)
        return payload
