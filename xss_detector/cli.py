"""Command line: `python -m xss_detector scan|serve ...`"""

from __future__ import annotations

import argparse
import json
import sys

from .detector import XSSDetector


def _print_result(label: str, result, verbose: bool) -> None:
    verdict = "MALICIOUS" if result.is_malicious else "ok"
    print(f"[{result.level.upper():8}] score={result.score:3} {verdict:9} {label}")
    if verbose or result.is_malicious:
        for f in result.findings:
            print(f"    {f.rule_id} {f.name} (+{f.weight}): {f.match!r}")


def cmd_scan(args) -> int:
    detector = XSSDetector(block_threshold=args.threshold)
    if args.file:
        source = sys.stdin if args.file == "-" else open(args.file, encoding="utf-8", errors="replace")
        with source:
            items = [(f"line {i}", line.rstrip("\r\n")) for i, line in enumerate(source, 1) if line.strip()]
    elif args.text:
        items = [("input", " ".join(args.text))]
    else:
        print("Provide TEXT or --file PATH (use '-' for stdin).", file=sys.stderr)
        return 2

    results = [(label, detector.scan(text)) for label, text in items]
    if args.json:
        print(json.dumps([{"label": l, **r.to_dict()} for l, r in results], indent=2))
    else:
        for label, result in results:
            _print_result(label, result, args.verbose)
    return 1 if any(r.is_malicious for _, r in results) else 0


def cmd_serve(args) -> int:
    import dataclasses

    from .config import Config, ConfigError
    from .server import serve
    try:
        config = Config.from_env()
    except ConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    overrides = {k: v for k, v in (("host", args.host), ("port", args.port)) if v is not None}
    config = dataclasses.replace(config, **overrides)
    serve(config=config)
    return 0


def cmd_demo(args) -> int:
    from .demo import serve
    serve(args.host, args.port)
    return 0


def cmd_train(args) -> int:
    from .evaluate import train_model
    train_model()
    return 0


def cmd_evaluate(args) -> int:
    from .evaluate import main as evaluate_main
    evaluate_main(retrain=args.retrain)
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="xss_detector", description="XSS attack detection")
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="scan text or a file (one input per line)")
    scan.add_argument("text", nargs="*", help="text to scan")
    scan.add_argument("-f", "--file", help="file to scan line by line ('-' = stdin)")
    scan.add_argument("-t", "--threshold", type=int, default=25, help="malicious score threshold (default 25)")
    scan.add_argument("-v", "--verbose", action="store_true", help="show findings for clean inputs too")
    scan.add_argument("--json", action="store_true", help="machine-readable output")
    scan.set_defaults(func=cmd_scan)

    serve = sub.add_parser("serve", help="start the web demo (settings come from env vars; flags override)")
    serve.add_argument("--host", default=None, help="bind address (env HOST, default 127.0.0.1)")
    serve.add_argument("--port", type=int, default=None, help="port (env PORT, default 8000)")
    serve.set_defaults(func=cmd_serve)

    demo = sub.add_parser("demo", help="vulnerable vs protected comment board (stored-XSS demo)")
    demo.add_argument("--host", default="127.0.0.1")
    demo.add_argument("--port", type=int, default=8001)
    demo.set_defaults(func=cmd_demo)

    train = sub.add_parser("train", help="train the ML detector on data/payloads (writes xss_detector/model.json)")
    train.set_defaults(func=cmd_train)

    evaluate = sub.add_parser("evaluate", help="benchmark rules vs ML vs hybrid, write reports/benchmark.md")
    evaluate.add_argument("--retrain", action="store_true", help="retrain the ML model first")
    evaluate.set_defaults(func=cmd_evaluate)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
