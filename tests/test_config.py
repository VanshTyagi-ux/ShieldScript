import os
import subprocess
import sys
import unittest
from pathlib import Path

from xss_detector.config import (Config, ConfigError, DEFAULT_CONFIG, DEFAULT_SCAN_DB, live_feed_enabled,
                                 resolve_scan_db, store_enabled)


class ConfigFromEnvTests(unittest.TestCase):
    def test_empty_environment_gives_the_defaults(self):
        self.assertEqual(Config.from_env({}), Config())
        self.assertEqual(DEFAULT_CONFIG, Config())
        self.assertEqual(
            (Config().host, Config().port, Config().log_level, Config().log_format, Config().max_body,
             Config().rate_limit, Config().rate_burst, Config().trusted_proxy_hops, Config().enable_hsts),
            ("127.0.0.1", 8000, "INFO", "text", 262144, 60, 20, 0, False))

    def test_every_variable_is_read(self):
        config = Config.from_env({
            "HOST": "0.0.0.0", "PORT": "10000", "LOG_LEVEL": "debug", "LOG_FORMAT": "json", "MAX_BODY": "1000",
            "RATE_LIMIT": "5", "RATE_BURST": "2", "TRUSTED_PROXY_HOPS": "1", "ENABLE_HSTS": "1"})
        self.assertEqual(config, Config(host="0.0.0.0", port=10000, log_level="DEBUG", log_format="json",
                                        max_body=1000, rate_limit=5, rate_burst=2, trusted_proxy_hops=1,
                                        enable_hsts=True))

    def test_live_feed_defaults_to_auto(self):
        self.assertEqual(Config().live_feed, "auto")
        self.assertEqual(Config.from_env({"LIVE_FEED": "1"}).live_feed, "1")

    def test_live_feed_rejects_other_values(self):
        with self.assertRaises(ConfigError) as ctx:
            Config.from_env({"LIVE_FEED": "maybe"})
        self.assertIn("LIVE_FEED", str(ctx.exception))

    def test_live_feed_enabled_rules(self):
        for host in ("127.0.0.1", "localhost", "::1"):
            self.assertTrue(live_feed_enabled(Config(), host), host)
        self.assertFalse(live_feed_enabled(Config(), "0.0.0.0"))
        self.assertTrue(live_feed_enabled(Config(live_feed="1"), "0.0.0.0"))
        self.assertFalse(live_feed_enabled(Config(live_feed="0"), "127.0.0.1"))

    def test_store_scans_defaults_to_auto_and_rejects_other_values(self):
        self.assertEqual(Config().store_scans, "auto")
        self.assertEqual(Config.from_env({"STORE_SCANS": "1"}).store_scans, "1")
        with self.assertRaises(ConfigError) as ctx:
            Config.from_env({"STORE_SCANS": "maybe"})
        self.assertIn("STORE_SCANS", str(ctx.exception))

    def test_store_enabled_rules(self):
        for host in ("127.0.0.1", "localhost", "::1"):
            self.assertTrue(store_enabled(Config(), host), host)
        self.assertFalse(store_enabled(Config(), "0.0.0.0"))
        self.assertTrue(store_enabled(Config(store_scans="1"), "0.0.0.0"))
        self.assertFalse(store_enabled(Config(store_scans="0"), "127.0.0.1"))

    def test_scan_db_defaults_to_the_project_root_and_env_overrides(self):
        self.assertEqual(Config().scan_db, "")
        self.assertEqual(resolve_scan_db(Config()), DEFAULT_SCAN_DB)
        self.assertEqual(DEFAULT_SCAN_DB.name, "scans.db")
        self.assertEqual(Config.from_env({"SCAN_DB": "x/y.db"}).scan_db, "x/y.db")
        self.assertEqual(resolve_scan_db(Config(scan_db="x/y.db")), Path("x/y.db"))

    def test_the_real_default_scan_db_is_scans_db_in_the_project_root(self):
        # tests/__init__.py redirects DEFAULT_SCAN_DB for the test run, so ask a fresh interpreter
        root = Path(__file__).resolve().parent.parent
        out = subprocess.run(
            [sys.executable, "-c", "from xss_detector.config import DEFAULT_SCAN_DB; print(DEFAULT_SCAN_DB)"],
            cwd=root, capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(Path(out), root / "scans.db")

    def test_config_is_frozen(self):
        with self.assertRaises(Exception):
            Config().port = 1

    def test_enable_hsts_spellings(self):
        for value in ("1", "true", "TRUE", "yes", "On"):
            self.assertTrue(Config.from_env({"ENABLE_HSTS": value}).enable_hsts, value)
        for value in ("0", "false", "No", "off", ""):
            self.assertFalse(Config.from_env({"ENABLE_HSTS": value}).enable_hsts, value)
        with self.assertRaises(ConfigError) as ctx:
            Config.from_env({"ENABLE_HSTS": "maybe"})
        self.assertIn("ENABLE_HSTS", str(ctx.exception))

    def test_invalid_values_raise_and_name_the_variable(self):
        bad = [("PORT", "abc"), ("PORT", ""), ("PORT", "0"), ("PORT", "70000"), ("RATE_LIMIT", "-5"),
               ("RATE_LIMIT", "0"), ("RATE_BURST", "0"), ("MAX_BODY", "0"), ("TRUSTED_PROXY_HOPS", "-1"),
               ("LOG_FORMAT", "xml"), ("LOG_LEVEL", "loud")]
        for name, value in bad:
            with self.subTest(name=name, value=value):
                with self.assertRaises(ConfigError) as ctx:
                    Config.from_env({name: value})
                self.assertIn(name, str(ctx.exception))

    def test_reads_the_real_environment_by_default(self):
        old = os.environ.get("RATE_BURST")
        os.environ["RATE_BURST"] = "7"
        try:
            self.assertEqual(Config.from_env().rate_burst, 7)
        finally:
            if old is None:
                del os.environ["RATE_BURST"]
            else:
                os.environ["RATE_BURST"] = old


class CliConfigTests(unittest.TestCase):
    def test_bad_environment_fails_with_one_clear_line_and_exit_code_2(self):
        env = {**os.environ, "PORT": "abc"}
        try:
            proc = subprocess.run([sys.executable, "-m", "xss_detector", "serve"], env=env,
                                  capture_output=True, text=True, timeout=8)
        except subprocess.TimeoutExpired:
            self.fail("serve started instead of rejecting PORT=abc")
        self.assertEqual(proc.returncode, 2)
        lines = proc.stderr.strip().splitlines()
        self.assertEqual(len(lines), 1, proc.stderr)
        self.assertTrue(lines[0].startswith("error:"), lines[0])
        self.assertIn("PORT", lines[0])
        self.assertNotIn("Traceback", proc.stderr)


if __name__ == "__main__":
    unittest.main()
