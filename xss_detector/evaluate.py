"""Benchmark: rules vs ML vs hybrid on held-out data. `python -m xss_detector evaluate`."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .corpus import load_benign, load_dataset, load_malicious_by_source, split_of
from .detector import XSSDetector
from .ml import HybridDetector, MLDetector

REPORT_PATH = Path(__file__).resolve().parent.parent / "reports" / "benchmark.md"
SHIPPED = "Hybrid (rules; ML escalates)"  # the detector the server actually uses
NOTES = [
    "Many lines in public payload lists are fragments (e.g. `</scrip</scr`, `href=`, `top.`) rather "
    "than working attacks, so recall below 100% is expected, especially for the rule engine.",
    "The ML model's benign training text is mostly English prose and code from the Python docs, so it "
    "partly learns \"looks like markup/code\" versus \"looks like prose\". Treat its false-positive rate as "
    "optimistic for real-world input such as rich-text comments; the hard-negative column is the harsher check.",
    "The random-split numbers are optimistic (near-duplicate payloads leak across the split); the "
    "unseen-source table below is the fairer estimate.",
]


@dataclass
class Metrics:
    tp: int = 0
    fn: int = 0
    fp: int = 0
    tn: int = 0

    @property
    def recall(self): return self.tp / (self.tp + self.fn) if self.tp + self.fn else 0.0
    @property
    def precision(self): return self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0
    @property
    def fpr(self): return self.fp / (self.fp + self.tn) if self.fp + self.tn else 0.0
    @property
    def f1(self):
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r else 0.0
    @property
    def accuracy(self):
        total = self.tp + self.fn + self.fp + self.tn
        return (self.tp + self.tn) / total if total else 0.0


def train_model(verbose: bool = True) -> MLDetector:
    data = load_dataset()
    mal, ben = data["malicious"]["train"], data["benign"]["train"]
    if verbose:
        print(f"Training on {len(mal)} malicious + {len(ben)} benign samples ...")
    start = time.perf_counter()
    model = MLDetector.train(mal, ben)
    model.save()
    if verbose:
        print(f"Done in {time.perf_counter() - start:.1f}s; {len(model.weights)} weights saved.")
    return model


def _evaluate(name: str, predict, data: dict) -> dict:
    m = Metrics()
    misses, false_pos, hard_fp = [], [], []
    for text in data["malicious"]["test"]:
        if predict(text):
            m.tp += 1
        else:
            m.fn += 1
            misses.append(text)
    for text in data["benign"]["test"]:
        if predict(text):
            m.fp += 1
            false_pos.append(text)
        else:
            m.tn += 1
    for text in data["hard"]:
        if predict(text):
            hard_fp.append(text)
    return {"name": name, "metrics": m, "misses": misses, "false_pos": false_pos, "hard_fp": hard_fp}


def run(model: MLDetector | None = None) -> tuple[list[dict], dict]:
    data = load_dataset()
    rules = XSSDetector()
    model = model or MLDetector.load_default()
    detectors = [("Rules", lambda t: rules.scan(t).is_malicious)]
    if model:
        hybrid = HybridDetector(rules, model)
        detectors += [("ML alone", model.is_malicious),
                      ("Naive hybrid (rules OR ML)", lambda t: rules.scan(t).is_malicious or model.is_malicious(t)),
                      ("Hybrid (rules; ML escalates)", lambda t: hybrid.scan(t)["is_malicious"])]
    return [_evaluate(n, p, data) for n, p in detectors], data


def cross_source(min_size: int = 40) -> list[dict]:
    """Leave-one-source-out: train ML without one payload list, test on that unseen list.

    Much stricter than the random split, because payload lists are full of near-duplicate
    variants that leak between train and test.
    """
    sources = {k: v for k, v in load_malicious_by_source().items() if len(v) >= min_size}
    benign = load_benign()
    ben_train = [t for t in benign if split_of(t) == "train"]
    ben_test = [t for t in benign if split_of(t) == "test"]
    rules = XSSDetector()
    rows = []
    for held_out, payloads in sources.items():
        train_mal = [p for name, items in sources.items() if name != held_out for p in items]
        model = MLDetector.train(train_mal, ben_train)
        rows.append({
            "source": held_out, "n": len(payloads),
            "rules": sum(rules.scan(p).is_malicious for p in payloads) / len(payloads),
            "ml": sum(model.is_malicious(p) for p in payloads) / len(payloads),
            "ml_fpr": sum(model.is_malicious(t) for t in ben_test) / len(ben_test),
        })
    return rows


def render_cross_source(rows: list[dict]) -> str:
    lines = ["", "## Unseen-source test (leave-one-list-out)", "",
             "The ML model is retrained without one payload list and scored on that list only.", "",
             "| Held-out list | Payloads | Rules recall | ML recall (unseen) | ML false-positive rate |",
             "|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['source']} | {r['n']} | {r['rules']:.1%} | {r['ml']:.1%} | {r['ml_fpr']:.2%} |")
    total = sum(r["n"] for r in rows)
    lines.append(f"| **Weighted average** | {total} | {sum(r['rules'] * r['n'] for r in rows) / total:.1%} | "
                 f"{sum(r['ml'] * r['n'] for r in rows) / total:.1%} | |")
    return "\n".join(lines) + "\n"


def _sample(items, n=12):
    return [f"- `{x[:110]}`" for x in items[:n]] or ["- (none)"]


def render_report(results: list[dict], data: dict) -> str:
    n_mal, n_ben = len(data["malicious"]["test"]), len(data["benign"]["test"])
    lines = [
        "# XSS detector benchmark", "",
        f"Held-out test split: **{n_mal}** malicious payloads (SecLists public XSS lists), "
        f"**{n_ben}** benign inputs (Python docs text + synthetic form input), "
        f"**{len(data['hard'])}** hand-written hard negatives (never used for training).", "",
        "| Detector | Recall | Precision | F1 | False-positive rate | Hard-negative FPs | TP | FN | FP | TN |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in results:
        m = r["metrics"]
        lines.append(f"| {r['name']} | {m.recall:.1%} | {m.precision:.1%} | {m.f1:.1%} | {m.fpr:.2%} | "
                     f"{len(r['hard_fp'])}/{len(data['hard'])} | {m.tp} | {m.fn} | {m.fp} | {m.tn} |")
    for r in results:
        lines += ["", f"## {r['name']}: sample of missed payloads (false negatives)", *_sample(r["misses"]),
                  "", f"### {r['name']}: false positives on benign text", *_sample(r["false_pos"]),
                  "", f"### {r['name']}: false positives on hard negatives", *_sample(r["hard_fp"], 40)]
    lines += ["", "> **Notes**", *[f"> - {note}" for note in NOTES]]
    return "\n".join(lines) + "\n"


def _clip(items, n):
    return [x[:110] for x in items[:n]]


def build_report_data(results: list[dict], data: dict, cross_rows: list[dict] | None,
                      today: date | None = None) -> dict:
    """Structured twin of the markdown report (reports/benchmark.json), served by /api/benchmark."""
    detectors = []
    for r in results:
        m = r["metrics"]
        detectors.append({
            "name": r["name"], "shipped": r["name"] == SHIPPED,
            "recall": m.recall, "precision": m.precision, "f1": m.f1, "fpr": m.fpr, "accuracy": m.accuracy,
            "tp": m.tp, "fn": m.fn, "fp": m.fp, "tn": m.tn,
            "hard_fps": len(r["hard_fp"]), "hard_total": len(data["hard"]),
            "samples": {"misses": _clip(r["misses"], 12), "false_positives": _clip(r["false_pos"], 12),
                        "hard_false_positives": _clip(r["hard_fp"], 40)},
        })
    rows = cross_rows or []
    total = sum(r["n"] for r in rows)
    return {
        "generated": (today or date.today()).isoformat(),
        "dataset": {"malicious_test": len(data["malicious"]["test"]), "benign_test": len(data["benign"]["test"]),
                    "hard_negatives": len(data["hard"])},
        "detectors": detectors,
        "unseen_sources": [{"source": r["source"], "payloads": r["n"], "rules_recall": r["rules"],
                            "ml_recall": r["ml"], "ml_fpr": r["ml_fpr"]} for r in rows],
        "unseen_weighted": ({"payloads": total,
                             "rules_recall": sum(r["rules"] * r["n"] for r in rows) / total,
                             "ml_recall": sum(r["ml"] * r["n"] for r in rows) / total} if total else None),
        "notes": list(NOTES),
    }


def main(retrain: bool = False, out: Path = REPORT_PATH, cross: bool = True) -> None:
    model = train_model() if retrain or not MLDetector.load_default() else None
    results, data = run(model)
    report = render_report(results, data)
    rows = None
    if cross:
        print("Running unseen-source test (trains several models) ...")
        rows = cross_source()
        report += render_cross_source(rows)
        total = sum(r["n"] for r in rows)
        print(f"Unseen sources: rules recall={sum(r['rules'] * r['n'] for r in rows) / total:.1%}  "
              f"ML recall={sum(r['ml'] * r['n'] for r in rows) / total:.1%}")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(report, encoding="utf-8")
    out.with_suffix(".json").write_text(json.dumps(build_report_data(results, data, rows), indent=2), encoding="utf-8")
    for r in results:
        m = r["metrics"]
        print(f"{r['name']:24} recall={m.recall:6.1%} precision={m.precision:6.1%} F1={m.f1:6.1%} "
              f"FPR={m.fpr:6.2%} hard-FP={len(r['hard_fp'])}/{len(data['hard'])}")
    print(f"Full report: {out}")
