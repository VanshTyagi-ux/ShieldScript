"""Static checks on the Docker Compose stack (backend image, frontend image, nginx, compose file).

Docker is not needed, and CI (which builds the images and runs a smoke test) is the real proof. These tests catch the
mistakes that only show up when an image is built or started: a COPY that the .dockerignore silently drops, a
directory layout the backend's path arithmetic does not expect, a port or header that two files disagree on.
"""

import posixpath
import re
import shlex
import shutil
import subprocess
import unittest
from pathlib import Path, PurePosixPath

from xss_detector.server import SECURITY_HEADERS

ROOT = Path(__file__).resolve().parent.parent


def read(relative: str) -> str:
    path = ROOT / relative
    assert path.is_file(), f"{relative} is missing"
    return path.read_text(encoding="utf-8")


# -- a small Dockerfile reader ----------------------------------------------------------------------------------
def instructions(text: str) -> list[tuple[str, str]]:
    """(KEYWORD, arguments) per instruction: continuation lines joined, comments and blank lines dropped."""
    out = []
    for line in re.sub(r"\\\r?\n", " ", text).splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            keyword, _, rest = line.partition(" ")
            out.append((keyword.upper(), rest.strip()))
    return out


def stages(text: str) -> dict[str, list[tuple[str, str]]]:
    """{stage name: its instructions}, from `FROM image AS name`."""
    result, current = {}, None
    for keyword, rest in instructions(text):
        if keyword == "FROM":
            current = rest.split()[-1] if " AS " in rest.upper() else f"stage{len(result)}"
            result[current] = []
        result[current].append((keyword, rest))
    return result


# -- a small .dockerignore matcher (Docker semantics: patterns in order, the last one that matches wins, a pattern that
#    matches a directory covers everything inside it, and ! puts things back) --------------------------------------
def _glob(pattern: str) -> re.Pattern:
    pattern = pattern.strip("/")
    out, i = "", 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif pattern.startswith("**", i):
            out, i = out + ".*", i + 2
        elif pattern[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif pattern[i] == "?":
            out, i = out + "[^/]", i + 1
        else:
            out, i = out + re.escape(pattern[i]), i + 1
    return re.compile(out + r"\Z")


def make_ignore(text: str):
    rules = []
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            rules.append((line.startswith("!"), _glob(line.lstrip("!"))))

    def ignored(path: str) -> bool:
        parts = path.split("/")
        candidates = ["/".join(parts[:i]) for i in range(1, len(parts) + 1)]  # the path and each parent directory
        result = False
        for negated, regex in rules:
            if any(regex.match(c) for c in candidates):
                result = not negated
        return result

    return ignored


def image_files(dockerfile: str, stage: str, dockerignore: str) -> dict[str, str]:
    """Where each file the build context lets through ends up in `stage`: {path in the image: path in the repo}."""
    ignored = make_ignore(read(dockerignore))
    files, workdir = {}, "/"
    for keyword, rest in stages(read(dockerfile))[stage]:
        if keyword == "WORKDIR":
            workdir = posixpath.join(workdir, rest)
        elif keyword == "COPY":
            args = [a for a in shlex.split(rest) if not a.startswith("--")]
            if any(a.startswith("--from=") for a in shlex.split(rest)):
                continue
            *sources, dest = args
            dest = posixpath.join(workdir, dest)
            for source in sources:
                src = ROOT / source
                if src.is_dir():
                    for file in sorted(p for p in src.rglob("*") if p.is_file()):
                        rel = file.relative_to(ROOT).as_posix()
                        if not ignored(rel):
                            files[posixpath.join(dest, file.relative_to(src).as_posix())] = rel
                elif src.is_file() and not ignored(source):
                    files[posixpath.join(dest, src.name) if dest.endswith("/") else dest] = source
    return files


BACKEND_DOCKERFILE = "backend/Dockerfile"
BACKEND_IGNORE = "backend/Dockerfile.dockerignore"


class DockerignoreMatcherTests(unittest.TestCase):
    """The matcher above must itself behave like Docker's, or the tests that use it prove nothing."""

    def test_exclude_everything_then_let_things_back_in(self):
        ignored = make_ignore("*\n!keep/\n!top.txt\nkeep/secret\n**/__pycache__")
        self.assertTrue(ignored("other/file.py"))
        self.assertFalse(ignored("keep/a.py"))
        self.assertFalse(ignored("keep/deep/b.py"))
        self.assertFalse(ignored("top.txt"))
        self.assertTrue(ignored("keep/secret"))                # a later rule wins
        self.assertTrue(ignored("keep/x/__pycache__/m.pyc"))   # a directory pattern covers what is inside it
        self.assertTrue(ignored("README.md"))

    def test_star_does_not_cross_directories(self):
        ignored = make_ignore("docs/*.md")
        self.assertTrue(ignored("docs/a.md"))
        self.assertFalse(ignored("docs/sub/a.md"))
        self.assertFalse(ignored("docs/a.txt"))


class BackendDockerfileTests(unittest.TestCase):
    def setUp(self):
        self.text = read(BACKEND_DOCKERFILE)
        self.stages = stages(self.text)

    def test_is_a_two_stage_python_312_slim_build(self):
        self.assertEqual(list(self.stages), ["builder", "runtime"])
        for name, steps in self.stages.items():
            self.assertEqual(steps[0], ("FROM", f"python:3.12-slim AS {name}"))

    def test_dependencies_are_installed_only_in_the_builder_and_carried_over_as_a_venv(self):
        builder = " ".join(f"{keyword} {rest}" for keyword, rest in self.stages["builder"])
        runtime = " ".join(f"{keyword} {rest}" for keyword, rest in self.stages["runtime"])
        self.assertIn("pip install -r /tmp/requirements.txt", builder)
        self.assertNotIn("pip install", runtime)
        self.assertIn("COPY --from=builder /opt/venv /opt/venv", runtime)
        self.assertIn("/opt/venv/bin", runtime)  # on PATH, so `uvicorn` and `python` come from the venv

    def test_runs_uvicorn_on_port_8000_as_a_non_root_user(self):
        runtime = dict((k, v) for k, v in self.stages["runtime"] if k in ("USER", "EXPOSE", "CMD", "ENTRYPOINT", "VOLUME"))
        self.assertEqual(runtime["USER"], "app")
        self.assertEqual(runtime["EXPOSE"], "8000")
        self.assertEqual(runtime["ENTRYPOINT"], '["docker-entrypoint.sh"]')
        self.assertEqual(runtime["CMD"], '["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]')
        self.assertIn("useradd", self.text)
        self.assertIn("chown app:app /data", self.text)

    def test_healthcheck_asks_the_versioned_health_endpoint(self):
        health = [rest for keyword, rest in self.stages["runtime"] if keyword == "HEALTHCHECK"]
        self.assertEqual(len(health), 1)
        self.assertIn("http://127.0.0.1:8000/api/v1/health", health[0])
        self.assertIn("/api/v1", read("backend/app/core/config.py"))  # the prefix the check relies on

    def test_every_copy_source_exists(self):
        for keyword, rest in instructions(self.text):
            if keyword == "COPY" and "--from=" not in rest:
                for source in [a for a in shlex.split(rest) if not a.startswith("--")][:-1]:
                    self.assertTrue((ROOT / source).exists(), f"COPY source {source} is missing")

    def test_the_build_context_lets_through_what_the_image_needs(self):
        files = image_files(BACKEND_DOCKERFILE, "runtime", BACKEND_IGNORE)
        needed = ["/app/backend/app/main.py", "/app/backend/app/core/repo.py", "/app/backend/scripts/seed_payloads.py",
                  "/app/xss_detector/__init__.py", "/app/xss_detector/model.json", "/app/xss_detector/catalog.py",
                  "/app/xss_detector/submit.py", "/app/xss_detector/ml.py", "/app/reports/benchmark.json"]
        for path in needed:
            self.assertIn(path, files, f"{path} would not be in the image (dropped by Dockerfile.dockerignore?)")
        payload_files = [p for p in files if p.startswith("/app/data/payloads/") and p.endswith(".txt")]
        self.assertEqual(len(payload_files), len(list((ROOT / "data" / "payloads").glob("*.txt"))))

    def test_the_build_context_keeps_secrets_tests_and_junk_out(self):
        ignored = make_ignore(read(BACKEND_IGNORE))
        for path in ("backend/.env", "backend/.env.local", "backend/tests/test_detector_api.py", "backend/app.db",
                     "backend/.venv/pyvenv.cfg", "backend/requirements-dev.txt", "backend/Dockerfile", ".env",
                     "frontend/package.json", "tests/test_server.py", "docs/superpowers/specs/x.md",
                     "xss_detector/static/app.js", "backend/app/__pycache__/main.cpython-312.pyc",
                     "xss_detector/__pycache__/ml.cpython-312.pyc", "reports/benchmark.md"):
            self.assertTrue(ignored(path), f"{path} would be sent into the build context")
        image = image_files(BACKEND_DOCKERFILE, "runtime", BACKEND_IGNORE)
        self.assertFalse([p for p in image if "__pycache__" in p or p.endswith(".pyc") or "/tests/" in p or p.endswith(".env")])
        self.assertFalse(any(p.startswith("/app/xss_detector/static") for p in image))

    def test_the_layout_matches_how_the_backend_finds_the_repository_root(self):
        # backend/app/core/repo.py: REPO_ROOT = Path(__file__).resolve().parents[3]
        self.assertIn("parents[3]", read("backend/app/core/repo.py"))
        files = image_files(BACKEND_DOCKERFILE, "runtime", BACKEND_IGNORE)
        root = PurePosixPath("/app/backend/app/core/repo.py").parents[3]
        self.assertEqual(str(root), "/app")
        for below_root in ("xss_detector/model.json", "data/payloads/XSS-Jhaddix.txt", "reports/benchmark.json"):
            self.assertIn(str(root / below_root), files)
        workdirs = [rest for keyword, rest in self.stages["runtime"] if keyword == "WORKDIR"]
        self.assertEqual(workdirs[-1], "/app/backend")  # `python -m scripts.seed_payloads` and `app.main` import from here

    def test_the_default_database_is_a_sqlite_file_on_a_volume_the_app_user_owns(self):
        self.assertIn("DATABASE_URL=sqlite:////data/app.db", self.text)
        self.assertIn("VOLUME /data", self.text)

    def test_the_runtime_dependencies_are_the_pinned_requirements(self):
        self.assertIn("psycopg", read("backend/requirements.txt"))  # the PostgreSQL driver compose relies on
        self.assertIn("uvicorn", read("backend/requirements.txt"))


class EntrypointTests(unittest.TestCase):
    def setUp(self):
        self.raw = (ROOT / "backend" / "docker-entrypoint.sh").read_bytes()
        self.text = self.raw.decode("utf-8")

    def test_is_a_posix_shell_script_with_unix_line_endings(self):
        self.assertTrue(self.text.startswith("#!/bin/sh\n"))
        self.assertNotIn(b"\r", self.raw)

    def test_seeds_then_hands_over_to_the_command(self):
        self.assertIn("set -eu", self.text)
        self.assertIn("python -m scripts.seed_payloads", self.text)
        self.assertTrue((ROOT / "backend" / "scripts" / "seed_payloads.py").is_file())
        self.assertTrue(self.text.rstrip().endswith('exec "$@"'))  # signals reach uvicorn: it must be PID 1

    def test_seeding_can_be_switched_off_and_retries_while_the_database_starts(self):
        self.assertIn("SEED_ON_START:-true", self.text)
        for knob in ("SEED_RETRIES", "SEED_RETRY_DELAY"):
            self.assertIn(knob, self.text)
        self.assertIn("exit 1", self.text)  # gives up rather than looping forever

    @unittest.skipUnless(shutil.which("sh"), "no POSIX shell available")
    def test_parses_as_shell(self):
        result = subprocess.run(["sh", "-n", str(ROOT / "backend" / "docker-entrypoint.sh")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


class NginxConfigTests(unittest.TestCase):
    def setUp(self):
        self.text = read("frontend/nginx.conf")
        self.code = "\n".join(line.split("#")[0] for line in self.text.splitlines())  # comments dropped

    def test_is_well_formed(self):
        self.assertEqual(self.code.count("{"), self.code.count("}"))
        for line in self.code.splitlines():
            line = line.strip()
            if line and not line.endswith(("{", "}")):
                self.assertTrue(line.endswith(";"), f"directive without a semicolon: {line!r}")

    def test_listens_on_8080_because_the_unprivileged_image_cannot_bind_80(self):
        self.assertRegex(self.code, r"listen\s+8080;")
        self.assertIn("EXPOSE 8080", read("frontend/Dockerfile"))
        self.assertIn(":8080", read("docker-compose.yml"))

    def test_forwards_the_api_to_the_backend_service_on_port_8000(self):
        self.assertRegex(self.code, r"location \^~ /api/ \{")
        self.assertIn("set $backend http://backend:8000;", self.code)
        self.assertIn("proxy_pass $backend;", self.code)
        self.assertRegex(self.code, r"resolver\s+127\.0\.0\.11")  # Docker's DNS, needed because of the variable
        compose = read("docker-compose.yml")
        self.assertRegex(compose, r"(?m)^  backend:")
        self.assertIn("8000", compose)

    def test_the_site_is_a_single_page_app_with_a_health_endpoint_and_real_404s_for_files(self):
        self.assertRegex(self.code, r"try_files \$uri /index\.html;")
        self.assertRegex(self.code, r"location = /healthz \{")
        self.assertRegex(self.code, r"location ~ \\\.\[A-Za-z0-9\]\+\$ \{\s*try_files \$uri =404;")
        self.assertIn("/healthz", read("frontend/Dockerfile"))

    def test_sends_the_same_security_headers_as_the_built_in_server(self):
        sent = dict(re.findall(r'add_header\s+(\S+)\s+"([^"]*)"\s+always;', self.code))
        for name, value in SECURITY_HEADERS.items():
            if name == "Cache-Control":  # nginx sets caching per file with `expires`
                continue
            self.assertEqual(sent.get(name), value, f"{name} differs from xss_detector/server.py")

    def test_no_location_sets_its_own_headers(self):
        # In nginx, add_header in a location REPLACES the server-level ones instead of adding to them.
        depth, offenders = 0, []
        for line in self.code.splitlines():
            depth += line.count("{") - line.count("}")
            if "add_header" in line and depth != 1:
                offenders.append(line.strip())
        self.assertEqual(offenders, [])

    def test_the_html_and_bundle_are_revalidated_on_every_load(self):
        self.assertRegex(self.code, r"location = /index\.html \{ expires -1; \}")
        self.assertRegex(self.code, r"location = /app\.js \{ expires -1; \}")


class FrontendDockerfileTests(unittest.TestCase):
    def setUp(self):
        self.text = read("frontend/Dockerfile")
        self.stages = stages(self.text)

    def test_builds_with_node_and_serves_with_unprivileged_nginx(self):
        self.assertEqual(list(self.stages), ["build", "runtime"])
        self.assertEqual(self.stages["build"][0], ("FROM", "node:24-alpine AS build"))
        self.assertTrue(self.stages["runtime"][0][1].startswith("nginxinc/nginx-unprivileged:"))

    def test_installs_from_the_lockfile_before_copying_the_source_so_the_layer_is_cached(self):
        build = [(k, r) for k, r in self.stages["build"] if k in ("COPY", "RUN")]
        commands = [r for _, r in build]
        self.assertLess(commands.index("package.json package-lock.json ./"), commands.index("npm ci"))
        self.assertLess(commands.index("npm ci"), commands.index("src/ src/"))
        self.assertEqual(commands[-1], "npm run build:dist")

    def test_the_build_script_and_env_file_it_needs_exist(self):
        import json
        scripts = json.loads(read("frontend/package.json"))["scripts"]
        self.assertEqual(scripts["build:dist"], "node scripts/build.mjs dist")
        for keyword, rest in instructions(self.text):
            if keyword == "COPY" and "--from=" not in rest:
                for source in shlex.split(rest)[:-1]:
                    self.assertTrue((ROOT / "frontend" / source).exists(), f"COPY source {source} is missing")
        self.assertTrue((ROOT / "frontend" / "package-lock.json").is_file())

    def test_the_site_is_built_for_the_same_origin_api_that_nginx_forwards(self):
        env = read("frontend/.env.docker")
        self.assertIn("VITE_API_URL=/api/v1", env)
        self.assertIn("VITE_BACKEND_PAGES=true", env)
        self.assertRegex(read("frontend/nginx.conf"), r"location \^~ /api/")
        self.assertIn('API_V1_PREFIX: str = "/api/v1"', read("backend/app/core/config.py"))

    def test_the_docker_context_leaves_out_what_would_leak_or_bloat(self):
        lines = set(read("frontend/.dockerignore").split())
        for expected in ("node_modules", "dist", ".tmp", ".env.local"):
            self.assertIn(expected, lines)

    def test_copies_the_built_site_into_nginx(self):
        runtime = " ".join(rest for _, rest in self.stages["runtime"])
        self.assertIn("nginx.conf /etc/nginx/conf.d/default.conf", runtime)
        self.assertIn("--from=build /app/dist /usr/share/nginx/html", runtime)
        self.assertIn("root /usr/share/nginx/html;", read("frontend/nginx.conf"))


class ComposeFileTests(unittest.TestCase):
    def setUp(self):
        self.text = read("docker-compose.yml")
        # Comments removed, both whole-line and trailing (a "#" after whitespace; none of the values contains one).
        self.code = "\n".join(re.sub(r"\s+#.*$", "", line) for line in self.text.splitlines() if not line.strip().startswith("#"))

    def service(self, name: str) -> str:
        match = re.search(rf"(?ms)^  {name}:\n(.*?)(?=^  \w[\w-]*:\n|^\w)", self.code)
        self.assertIsNotNone(match, f"no service {name}")
        return match.group(1)

    def test_has_the_three_services(self):
        self.assertEqual(re.findall(r"(?m)^  ([a-z]+):\n", self.code.split("\nvolumes:")[0].split("services:")[1]),
                         ["db", "backend", "frontend"])

    def test_the_database_is_postgresql_with_a_volume_and_a_tcp_healthcheck(self):
        db = self.service("db")
        self.assertIn("image: postgres:16-alpine", db)
        self.assertIn("db-data:/var/lib/postgresql/data", db)
        self.assertIn("pg_isready -h 127.0.0.1", db)  # not the socket: see the comment in the file
        self.assertNotIn("ports:", db)                # only the backend needs it

    def test_the_backend_is_built_from_the_repository_root_and_waits_for_a_healthy_database(self):
        backend = self.service("backend")
        self.assertRegex(backend, r"context: \.\n\s+dockerfile: backend/Dockerfile")
        self.assertRegex(backend, r"depends_on:\n\s+db:\n\s+condition: service_healthy")
        self.assertIn(":8000\"", backend)
        self.assertTrue((ROOT / "backend" / "Dockerfile").is_file())

    def test_the_backend_defaults_to_the_postgres_container_through_the_psycopg_driver(self):
        url = re.search(r"DATABASE_URL: (.+)", self.service("backend")).group(1)
        self.assertIn("postgresql+psycopg://", url)
        self.assertIn("@db:5432/", url)
        for name in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"):
            self.assertIn(name, url)
            self.assertIn(name, self.service("db"))  # the database is created with the same three values

    def test_the_frontend_waits_for_the_backend_and_publishes_nginx_port_8080(self):
        frontend = self.service("frontend")
        self.assertRegex(frontend, r"depends_on:\n\s+backend:\n\s+condition: service_healthy")
        self.assertRegex(frontend, r"context: \./frontend")
        self.assertRegex(frontend, r':\$\{FRONTEND_PORT:-3000\}:8080|FRONTEND_PORT:-3000\}:8080')

    def test_every_service_that_others_wait_for_has_a_healthcheck(self):
        self.assertIn("healthcheck:", self.service("db"))
        self.assertRegex(read("backend/Dockerfile"), r"(?m)^HEALTHCHECK ")  # backend: defined in its image

    def test_ports_are_published_on_the_loopback_address_by_default(self):
        self.assertEqual(self.code.count("${BIND_ADDRESS:-127.0.0.1}"), 2)

    def test_named_volumes_are_declared(self):
        declared = re.search(r"(?ms)^volumes:\n(.*)\Z", self.code).group(1)
        used = set(re.findall(r"- ([a-z-]+):/", self.code))
        for volume in used:
            self.assertRegex(declared, rf"(?m)^  {volume}:")

    def test_every_variable_is_documented_with_its_default_in_env_example(self):
        used = set(re.findall(r"\$\{([A-Z_]+)", self.text))
        documented = set(re.findall(r"(?m)^#?\s*([A-Z_]+)=", read(".env.example")))
        self.assertEqual(used - documented, set(), "used in docker-compose.yml but not in .env.example")
        self.assertEqual(documented - used, set(), "in .env.example but never used by docker-compose.yml")

    def test_the_local_env_file_is_git_ignored_and_the_example_has_a_password_warning(self):
        self.assertIn(".env", read(".gitignore").split())
        self.assertRegex(read(".env.example"), r"(?i)change this")

    def test_the_stack_publishes_the_ports_the_documentation_promises(self):
        self.assertIn("BACKEND_PORT:-8000", self.text)
        self.assertIn("FRONTEND_PORT:-3000", self.text)


class CiSmokeTestTests(unittest.TestCase):
    def test_ci_builds_and_starts_the_stack_and_checks_it_end_to_end(self):
        ci = read(".github/workflows/ci.yml")
        for command in ("docker compose config --quiet", "docker compose build", "docker compose up -d --wait",
                        "http://localhost:8000/api/v1/health", "http://localhost:3000/api/v1/payloads/facets",
                        "docker compose down -v"):
            self.assertIn(command, ci)


if __name__ == "__main__":
    unittest.main()
