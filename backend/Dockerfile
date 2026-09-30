# The FastAPI backend. BUILD FROM THE REPOSITORY ROOT (the backend imports the xss_detector package and reads
# data/payloads and reports/benchmark.json from beside it):
#
#   docker build -f backend/Dockerfile -t xss-backend .
#
# Two stages: dependencies are installed into a virtualenv in a throwaway "builder" stage, and only that
# virtualenv is copied into the slim runtime image, so pip, its cache and any build leftovers never ship.

# ---- builder: install the dependencies ---------------------------------------------------------------------
FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN python -m venv /opt/venv
COPY backend/requirements.txt /tmp/requirements.txt
# Every dependency ships a prebuilt wheel for CPython 3.12 on Linux, so no compiler is needed.
RUN /opt/venv/bin/pip install -r /tmp/requirements.txt

# ---- runtime -----------------------------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

# DATABASE_URL defaults to a SQLite file on the /data volume, so `docker run` works on its own. docker-compose.yml
# points it at PostgreSQL instead.
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATABASE_URL=sqlite:////data/app.db

RUN useradd --system --uid 10001 --no-create-home --home-dir /nonexistent app \
    && mkdir /data \
    && chown app:app /data

COPY --from=builder /opt/venv /opt/venv

# The layout matters: backend/app/core/repo.py finds the repository root three directories above itself, so
# xss_detector/, data/ and reports/ have to sit next to backend/ under /app.
WORKDIR /app
COPY xss_detector/ xss_detector/
COPY data/payloads/ data/payloads/
COPY reports/benchmark.json reports/benchmark.json
COPY backend/app/ backend/app/
COPY backend/scripts/ backend/scripts/

COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Strip CRs (a Windows checkout can add them, and "#!/bin/sh\r" does not run), then make it executable.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod 755 /usr/local/bin/docker-entrypoint.sh

WORKDIR /app/backend
USER app

VOLUME /data
EXPOSE 8000

# Fails (exit 1) on connection errors and on any non-2xx answer.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=3)"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
