"""Static checks on the deployment files. Docker is not needed here; CI proves the image really builds."""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_VARS = ("HOST", "PORT", "LOG_LEVEL", "LOG_FORMAT", "MAX_BODY", "RATE_LIMIT", "RATE_BURST",
            "TRUSTED_PROXY_HOPS", "ENABLE_HSTS")


def read(relative: str) -> str:
    path = ROOT / relative
    assert path.is_file(), f"{relative} is missing"
    return path.read_text(encoding="utf-8")


class DockerfileTests(unittest.TestCase):
    def setUp(self):
        self.text = read("Dockerfile")

    def test_base_image_and_command(self):
        self.assertIn("FROM python:3.12", self.text)
        self.assertRegex(self.text, r'(?m)^CMD \["python", "-m", "xss_detector", "serve"\]')
        self.assertIn("HOST=0.0.0.0", self.text)

    def test_runs_as_a_non_root_user(self):
        users = re.findall(r"(?m)^USER\s+(\S+)", self.text)
        self.assertTrue(users, "no USER instruction")
        self.assertNotIn(users[-1], ("root", "0"))

    def test_healthcheck_calls_the_health_endpoint(self):
        self.assertRegex(self.text, r"(?m)^HEALTHCHECK ")
        self.assertIn("/api/health", self.text)

    def test_has_no_pip_dependencies(self):
        self.assertNotIn("pip install", self.text)

    def test_copies_only_what_runs_and_it_exists(self):
        sources = [line.split()[1] for line in self.text.splitlines() if line.startswith("COPY ")]
        self.assertEqual(sorted(sources), ["reports/benchmark.json", "xss_detector/"])
        for source in sources:
            self.assertTrue((ROOT / source).exists(), source)
        self.assertTrue((ROOT / "xss_detector" / "model.json").is_file())
        self.assertTrue((ROOT / "xss_detector" / "static" / "app.js").is_file())


class DockerignoreTests(unittest.TestCase):
    def test_keeps_the_build_context_small(self):
        lines = {line.strip() for line in read(".dockerignore").splitlines()}
        for expected in ("node_modules", "frontend", "data", "docs", "tests", ".git", ".github"):
            self.assertIn(expected, lines)


class RenderBlueprintTests(unittest.TestCase):
    def setUp(self):
        self.text = read("render.yaml")

    def test_service_settings(self):
        for expected in ("runtime: docker", "healthCheckPath: /api/health", "TRUSTED_PROXY_HOPS", "LOG_FORMAT",
                         "ENABLE_HSTS"):
            self.assertIn(expected, self.text)

    def test_the_platform_provides_the_port(self):
        self.assertNotRegex(self.text, r"(?m)^\s*-?\s*key:\s*PORT\s*$")  # a comment may mention $PORT


class CiWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text = read(".github/workflows/ci.yml")

    def test_runs_on_push_and_pull_request(self):
        self.assertRegex(self.text, r"(?m)^\s*push:")
        self.assertRegex(self.text, r"(?m)^\s*pull_request:")

    def test_runs_every_gate(self):
        for command in ("python -m unittest discover -s tests -t .", "npm --prefix frontend ci",
                        "npm --prefix frontend test", "npm --prefix frontend audit",
                        "npm --prefix frontend run build", "git diff --exit-code xss_detector/static/app.js",
                        "docker build"):
            self.assertIn(command, self.text)

    def test_pins_the_runtimes(self):
        self.assertIn('python-version: "3.12"', self.text)
        self.assertIn('node-version: "24"', self.text)


class RepoFilesTests(unittest.TestCase):
    def test_gitattributes_keeps_the_bundle_byte_exact(self):
        self.assertIn("xss_detector/static/app.js -text", read(".gitattributes"))

    def test_readme_documents_every_setting_and_the_proxy_caveat(self):
        readme = read("README.md")
        for name in ENV_VARS:
            self.assertIn(name, readme)
        self.assertIn("Deploying", readme)
        self.assertRegex(readme, r"(?i)X-Forwarded-For")
        self.assertRegex(readme, r"(?i)per (instance|process)")


if __name__ == "__main__":
    unittest.main()
