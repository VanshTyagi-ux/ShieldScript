# XSS Attack Detection

Detects likely Cross-Site Scripting (XSS) payloads in user input fields. Python 3.10+, **standard library only** - nothing to install.

## Quick start

```powershell
python -m unittest discover -s tests -t .     # run tests
python -m xss_detector serve                  # the site (scanner, rules, benchmarks, API docs) at http://127.0.0.1:8000
python -m xss_detector demo                   # vulnerable vs protected comment board at http://127.0.0.1:8001
python -m xss_detector evaluate               # benchmark -> reports/benchmark.md and benchmark.json (feeds the Benchmarks page)
python -m xss_detector train                  # retrain the ML model -> xss_detector/model.json
python -m xss_detector scan "<img src=x onerror=alert(1)>"
python -m xss_detector scan --file inputs.txt # one input per line; exit code 1 if any is malicious
python -m xss_detector scan --json "text"     # machine-readable
```

The web UI is a React app (plain JavaScript). Its built bundle, `xss_detector/static/app.js`, is committed, so **running the project still needs only Python**. Node is needed only to change the UI:

```powershell
cd frontend
npm install
npm test          # component and hook tests (Vitest)
npm run build     # rebuild ../xss_detector/static/app.js - run this after editing frontend/src
npm run dev       # dev server at http://localhost:5173 that rebuilds and reloads on change, talking to the FastAPI backend
```

**Where the UI finds its API.** Every request goes to one base URL, set by the `VITE_API_URL` environment variable when the bundle is built (`frontend/.env.example` explains the files it can live in; only `VITE_*` variables ever reach the browser):

| Command | `VITE_API_URL` | Talks to |
|---|---|---|
| `npm run dev` | not set, so the default `http://localhost:8000/api/v1` | the [FastAPI backend](#fastapi-backend-optional) (CORS allows `localhost:5173`) |
| `npm run build` | `/api`, from `frontend/.env.production` | the built-in server that ships the bundle, on its own origin |
| `npm run build:dist` | `/api/v1`, from `frontend/.env.docker` | a static site (`frontend/dist`) for the Docker image, where nginx forwards `/api/` to the backend |

Keep `.env.production` as it is: the built-in server's CSP (`default-src 'self'`) only lets the page call its own origin, and its API has no `/payloads` or `/sanitize`. `VITE_BACKEND_PAGES=false` (also set there) therefore leaves the Payloads and Sanitizer pages, and their entries in the API docs, out of that bundle; it is on by default. Set `VITE_API_URL` in `frontend/.env.local` (git-ignored) or the shell to use another server.

The UI applies its styles as a constructable stylesheet (the server's CSP forbids inline `<style>`), so it needs Chrome 73+, Firefox 101+ or Safari 16.4+; older browsers show it unstyled.

## Use as a library

```python
from xss_detector import scan, XSSDetector, escape_html

result = scan(user_input)
if result.is_malicious:
    reject(result.level, [f.rule_id for f in result.findings])

# custom threshold / per-field scanning
detector = XSSDetector(block_threshold=40)
results = detector.scan_fields({"name": name, "comment": comment})
```

## How it works

1. **Normalise** - repeatedly decode URL escapes (`%3C`), HTML entities (`&#x3c;`, `&lt;`), `\uXXXX`/`\xXX` escapes, strip NUL/control characters and short `/**/` comments, apply Unicode NFKC. This defeats `%253Cscript`, `<scr\0ipt>`, `jav&#x09;ascript:` and similar evasions.
2. **Match** - 23 weighted regex rules (`xss_detector/detector.py`) across script/markup, dangerous URI schemes, JS sinks, CSS vectors and template injection.
3. **Score** - weights of distinct rules that fired are summed (cap 100). Payloads that only become dangerous *after* decoding get an extra "obfuscation" finding.

| Score | Level | 
|---|---|
| 0 | safe |
| 1-24 | low |
| 25-49 | medium |
| 50-74 | high |
| 75-100 | critical |

Input scoring **>= 25** (`block_threshold`) is flagged malicious.

## Machine-learning detector and hybrid mode

`xss_detector/ml.py` is a dependency-free logistic-regression model over hashed character 1-4-grams of the *decoded* input. A trained model (`model.json`) is included; `python -m xss_detector train` rebuilds it from `data/payloads/`.

The web server uses a **hybrid**: the rules decide, and the ML model can only *escalate* input the rules already found some evidence in, when it is >= 95% confident. ML alone never blocks, because on short harmless text (e.g. `5 < 10`) it behaves like a "looks like code" detector and would reject real users. This trade-off is measured in the benchmark below.

## Benchmark

`python -m xss_detector evaluate` scores every detector on a held-out 30% split of a **25,007-sample corpus** (8,560 malicious + 16,397 benign + 50 hard negatives): **2,640 public XSS payloads** ([SecLists](https://github.com/danielmiessler/SecLists) lists in `data/payloads/`, MIT licence), **4,948 benign inputs** (Python-docs text plus synthetic form input) and **50 hand-written hard negatives** that are never used for training.

| Detector | Recall | Precision | False-positive rate | Hard-negative FPs |
|---|---|---|---|---|
| Rules | 94.2% | 100% | 0.00% | 0/50 |
| ML alone | 99.9% | 99.8% | 0.10% | 2/50 |
| Naive hybrid (rules OR ML) | 99.9% | 99.8% | 0.10% | 2/50 |
| **Hybrid (rules; ML escalates)** - used by the server | 95.1% | 100% | 0.00% | 0/50 |

Caveats, all repeated in `reports/benchmark.md`: many public payload "lines" are fragments (`href=`, `top.`) that no rule engine should flag; near-duplicate payloads make the random split optimistic, so the report also retrains the model with each payload list held out (ML recall on unseen lists: 99.3% weighted, but only 78.9% on `XSS-EnDe-evation.txt`); and the benign training text is mostly prose, so the ML false-positive rate is optimistic for real rich-text input.

## Vulnerable vs protected demo

`python -m xss_detector demo` serves two identical comment boards on `http://127.0.0.1:8001`. Post the "Steal cookie" sample to `/vulnerable` and the injected script runs in your browser and reads a fake cookie; post it to `/protected` and it is rejected (and anything harmless is HTML-escaped, with a CSP that forbids inline scripts). Local only - comments stay in memory.

## Dummy site and live feed

The demo is a small dummy blog with two inputs on each board: a comment form (stored XSS) and a search box
(reflected XSS). Its **protected** pages are a client of the main site: every input goes to `POST /api/scan` on the
main site (port 8000), and the dummy site only accepts it if the detector says it is clean. The **vulnerable** pages
do no scanning, on purpose.

```powershell
python -m xss_detector serve     # the main site, http://127.0.0.1:8000
python -m xss_detector demo      # the dummy site, http://127.0.0.1:8001
```

Open `http://127.0.0.1:8000/live` while you use the dummy site: each scan appears there within about 2 seconds, with
the verdict, score, the rules that fired and the input.

- **Fails closed.** If the main site cannot be reached (down, slow, rate-limited, or an unusable answer) the protected
  pages reject the input with "Detector unavailable, input not accepted" (HTTP 503). They never let input through
  unscanned and never fall back to a local detector.
- **Pointing at another main site.** `python -m xss_detector demo --detector-url http://host:port`, or the
  `DETECTOR_URL` environment variable (default `http://127.0.0.1:8000`).
- **How the feed works.** A scan request that carries `"source": "<name>"` (1-40 lowercase letters, digits or hyphens)
  is recorded; the Scanner page sends none, so typing there never shows up. The last 100 events are kept in memory
  only, and `GET /api/events` returns them newest first.
- **Privacy.** The README says request bodies are never logged. The feed is a deliberate, narrow exception: it keeps
  the first 200 characters of input, in memory, only for requests that name a `source`. It is **on by default only
  when the server binds to a loopback address**; on a public host such as Render or Docker (`HOST=0.0.0.0`) it is
  off unless you set `LIVE_FEED=1`, so visitors cannot read what other people submitted.
- **Builds.** `/live` and `GET /api/events` belong to the built-in server. The FastAPI-backed build of the UI
  (`VITE_BACKEND_PAGES=true`) leaves the page out, because that backend has no `/events`.

## The site

`python -m xss_detector serve` serves a small multi-page site (a React app; see the UI section above for building it):

| Page | What it shows |
|---|---|
| `/` Home | A live auto-playing demo, headline numbers from the benchmark, features, and how to use it in your app |
| `/scanner` | The live scanner: a score gauge, where the score comes from, session history and insights, copy-as-JSON and share links, and the protected form |
| `/live` | The live feed of scans sent by other apps (see [Dummy site and live feed](#dummy-site-and-live-feed)) |
| `/how-it-works` | An interactive walk through the three steps (normalize, match, score) on the real detector |
| `/rules` | Every rule, grouped by category in collapsible sections (with search and expand/collapse all), plus charts of weights and categories |
| `/benchmarks` | Detector comparison, the unseen-source test, confusion counts, example misses, and the caveats |
| `/api-docs` | The API reference, with a "Try it" box for every endpoint |
| `/about` | Limitations, how it is built, and the roadmap |

Charts are hand-drawn SVG (no charting library); every chart has tooltips on hover and keyboard focus and a "View as table" toggle. The theme follows your system and can be switched (light, dark, system) from the header. The scanner keeps your scan history in `sessionStorage` (this tab only, cleared with **Clear history**), and a **share link** puts the scanned text in the URL, so anyone who has the link can read it. Unknown paths return the app with a real HTTP 404.

## Web demo / API

`python -m xss_detector serve [--host 127.0.0.1] [--port 8000]`

| Endpoint | Body | Result |
|---|---|---|
| `POST /api/scan` | `{"text": "..."}` or `{"fields": {...}}`, optional `"source": "name"` | score, level, findings, decoded text, `ml_probability`; with a `source` the scan also goes to the live feed |
| `POST /api/submit` | `{"fields": {"name","email","website","comment"}}` | `200` + HTML-escaped values, or `422` + per-field errors |
| `GET /api/rules` | - | the rule catalog (id, name, category, weight, description), the level bands and the block threshold |
| `GET /api/events` | - | the live feed: `{"events": [...], "enabled": bool}`, newest first, at most 100; empty and `enabled: false` when the feed is off |
| `GET /api/benchmark` | - | the latest benchmark as JSON (`reports/benchmark.json`); `404` with instructions if not generated |
| `GET /api/health` | - | `{"status", "rules", "ml_loaded", "bundle"}`; `503` (`"status": "degraded"`) if the frontend bundle is missing |

The UI (React) renders all untrusted text as plain text, never as HTML (`dangerouslySetInnerHTML` is banned and checked by a test), and the server sends a strict CSP, so the demo doesn't become an XSS vector itself.

## FastAPI backend (optional)

`backend/` is a second API server (FastAPI, SQLAlchemy, Pydantic v2) with the same detector plus a payload database and an HTML sanitizer. Unlike the rest of the project it needs packages (`pip install -r backend/requirements.txt`; use a standard CPython 3.12 venv). Everything below runs from `backend/`; interactive docs are at `/docs`.

```powershell
python -m venv .venv ; .venv\Scripts\activate ; pip install -r requirements-dev.txt
copy .env.example .env                        # DATABASE_URL (SQLite by default, PostgreSQL by changing one line), CORS_ORIGINS, limits
python -m scripts.seed_payloads               # create the tables and load data/payloads/*.txt (safe to re-run; --replace reloads)
uvicorn app.main:app --port 8000              # http://localhost:8000/api/v1
python -m unittest discover -s tests -t .     # backend tests (requirements-dev.txt adds httpx, needed by TestClient)
```

The built-in server also defaults to port 8000, so run only one of them there, or start the other with `--port`. To see the UI against this backend: start it as above, then `npm run dev` in `frontend/` and open http://localhost:5173.

| Endpoint (under `/api/v1`) | Result |
|---|---|
| `POST /scan`, `POST /submit`, `GET /rules`, `GET /benchmark`, `GET /health` | the same data as the built-in server's `/api/*` (`/health` adds `service` and `version`) |
| `GET /payloads?source_file=&category=&skip=&limit=` | a page of stored payloads: `{items, total, skip, limit}` (`limit` 1-500) |
| `GET /payloads/facets` | the categories and source files with counts, for filter controls |
| `GET /payloads/{id}` | one payload; `404` if there is none |
| `POST /sanitize` | `{"html": "..."}` -> the allow-list-sanitized HTML, a report of removed tags/attributes, and the detector's alert. At most 64 000 characters (`MAX_HTML_LENGTH`); `503` if `nh3` is missing |

Errors are always `{"error": "..."}`. Per-client rate limiting is on by default (`RATE_LIMIT`/`RATE_BURST` in `.env`, 60/min with a burst of 20, same defaults and `429` + `Retry-After` contract as the built-in server); `TRUSTED_PROXY_HOPS` (default `0`) controls whether `X-Forwarded-For` is trusted - leave it at `0` unless this API sits solely behind that many trusted proxies, which is not the case in this repository's `docker-compose.yml` (the backend port is also published directly). The limit is kept **per instance** (in memory, like the built-in server's), so running several instances multiplies it.

## Run everything with Docker Compose

One command starts PostgreSQL, the backend and the React site:

```powershell
docker compose up --build       # then open http://localhost:3000   (API docs: http://localhost:8000/docs)
docker compose down             # stop; the database survives in the "db-data" volume
docker compose down -v          # stop and delete the database
```

| Service | What it is | Host port |
|---|---|---|
| `db` | `postgres:16-alpine`, data in the `db-data` volume; not published (only the backend needs it) | none |
| `backend` | `backend/Dockerfile`: multi-stage Python 3.12 slim (dependencies built into a venv in one stage, only the venv copied into the runtime image), non-root, uvicorn on 8000. On start it creates the tables and loads `data/payloads` (safe to repeat) | 8000 |
| `frontend` | `frontend/Dockerfile`: Node builds the site (`npm run build:dist`, settings in `frontend/.env.docker`), unprivileged nginx serves it on 8080 and forwards `/api/` to the backend | 3000 |

The browser only ever talks to nginx, so page and API share one origin: no CORS, and the strict CSP (`default-src 'self'`) still holds. Ports are published on `127.0.0.1` only, because the API has no authentication or rate limiting; set `BIND_ADDRESS=0.0.0.0` only behind something that provides them.

Settings come from the environment or a `.env` file (copy `.env.example`; every value has a default that works locally): `POSTGRES_USER`, `POSTGRES_PASSWORD` (**change it** for anything but a throwaway stack; keep it URL-safe), `POSTGRES_DB`, `DATABASE_URL` (built from those by default; set it to use another database, e.g. `sqlite:////data/app.db` for the backend's SQLite file volume), `SEED_ON_START`, `BIND_ADDRESS`, `BACKEND_PORT`, `FRONTEND_PORT`. `.env` is git-ignored.

Build the images on their own with `docker build -f backend/Dockerfile -t xss-backend .` (**from the repository root**: the backend needs `xss_detector/`, `data/` and `reports/` beside it) and `docker build -t xss-frontend frontend`. `backend/Dockerfile.dockerignore` keeps tests, `.env` files and the UI bundle out of the backend image.

CI builds both images, starts the stack with `docker compose up --wait` and smoke-tests it through nginx, the backend and the database. `tests/test_compose_files.py` checks the same files statically (which files each `COPY` really includes after the ignore rules, port and header agreement between nginx, compose and the built-in server). Since the built-in server's own `Dockerfile` (stdlib only, for Render) is unchanged, both deployments coexist.

## Deploying

The server is stdlib-only and configured by environment variables (command-line `--host`/`--port` override `HOST`/`PORT`). A bad value stops start-up with one `error:` line.

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` (the Docker image sets `0.0.0.0`) | bind address |
| `PORT` | `8000` | listen port (platforms inject it) |
| `LOG_LEVEL` | `INFO` | log level |
| `LOG_FORMAT` | `text` | `text` or `json` (one JSON object per line) |
| `MAX_BODY` | `262144` | largest request body in bytes; bigger gets `413` |
| `RATE_LIMIT` | `60` | sustained requests per minute per client on `/api/*` |
| `RATE_BURST` | `20` | short-burst allowance |
| `TRUSTED_PROXY_HOPS` | `0` | proxies in front of the app whose `X-Forwarded-For` entry to trust |
| `ENABLE_HSTS` | off | send `Strict-Transport-Security` (turn on only when the site is served over HTTPS) |
| `LIVE_FEED` | `auto` | record scans that name a `source` for `/live`: `auto` (only on a loopback bind), `1` or `0` |

**On Render:** push the repository to GitHub, then *New > Blueprint Instance* and pick it. `render.yaml` builds the `Dockerfile` (a non-root, stdlib-only image), points the platform health check at `/api/health`, and sets `TRUSTED_PROXY_HOPS=1`, `LOG_FORMAT=json` and `ENABLE_HSTS=1`. Render terminates HTTPS and injects `$PORT`. For Railway or Fly.io use the same variables; look at the `X-Forwarded-For` header your platform sends before choosing `TRUSTED_PROXY_HOPS`.

**Get `TRUSTED_PROXY_HOPS` right.** The client address is the *n*-th entry from the **right** of `X-Forwarded-For` (each trusted proxy appends what it saw, so anything to the left was written by the client and is ignored). Too low, and every visitor shares the proxy's address and one rate-limit bucket. Too high, and a client can forge its own identity and dodge the limit.

**What protects a public instance:**
- Per-client rate limiting on `/api/*`: `429` with `Retry-After`. The page, `/app.js` and `/api/health` are never limited. The limit is kept **per instance** (in memory), so running several instances multiplies it; a shared limiter would need an external store.
- At most 64 concurrent connections (more get `503` + `Retry-After`) and a 15 s deadline for a **whole request** (a client that trickles bytes is cut off, not just one that goes silent), so slow clients cannot pin connection slots or stall shutdown.
- `app.js` is served with an `ETag` and gzip; a redeploy is never stale. Every response carries the CSP, `Permissions-Policy` and `Cross-Origin-Opener-Policy`.
- One log line per request (method, route, status, duration, client, request id). Request bodies and query strings are **never** logged, because they hold user input.
- `SIGTERM` finishes in-flight requests, then exits.

CI (`.github/workflows/ci.yml`) runs both test suites, `npm audit`, rebuilds the frontend and fails if the committed `xss_detector/static/app.js` is stale, and builds the Docker image.

## Limitations

- Detection is heuristic. **Always HTML-encode output** (`escape_html`) and use a CSP; treat this as an additional layer, not a replacement.
- Text that merely *discusses* XSS (e.g. a security blog comment) will be flagged. This is deliberate: real markup such as `<script>` or `onclick=` in prose cannot be told apart from an attack that hides in a sentence, so no "looks like prose" discount is applied.
- The generic event-handler rule (`on<word>=` with an unrecognised name) only fires inside an opening tag, so prose such as `onset = 3` is safe. The cost is that a bare `" onfoo=1` with an obscure handler name and no `<` is not caught by that rule.
- Only what is sent to it is scanned; it does not see DOM-based XSS that never reaches the server.

## Layout

```
xss_detector/  detector.py (rule engine)  ml.py (ML + hybrid)  corpus.py / evaluate.py (benchmark)
               sanitizer.py  server.py  demo.py  cli.py  model.json  static/app.js (built UI bundle)
               config.py (env settings)  ratelimit.py  logs.py  events.py (live feed)  catalog.py / submit.py (shared with the backend)
frontend/      React source for the UI (npm run build -> xss_detector/static/app.js; npm run dev -> :5173)
backend/       FastAPI API: app/ (api, core, models, schemas, services)  scripts/ (seed_payloads)  tests/  Dockerfile
docker-compose.yml  .env.example   PostgreSQL + backend + frontend (nginx); frontend/Dockerfile and frontend/nginx.conf
data/payloads/ public payload lists (SecLists, MIT)      reports/benchmark.md   tests/
Dockerfile  .dockerignore  render.yaml  .github/workflows/ci.yml   deployment
```
