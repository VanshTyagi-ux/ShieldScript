FROM python:3.12-slim

# HOST=0.0.0.0 so the platform's proxy can reach the container; the platform injects $PORT.
ENV HOST=0.0.0.0 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN useradd --create-home --uid 10001 app
WORKDIR /app

# Runtime is stdlib-only, so there is nothing to install. The React bundle (xss_detector/static/app.js) is
# committed; CI fails if it is stale. reports/benchmark.json feeds the /benchmarks page.
COPY xss_detector/ xss_detector/
COPY reports/benchmark.json reports/benchmark.json

USER app
EXPOSE 8000

# Fails (exit 1) on connection errors and on the 503 that /api/health returns when the bundle is missing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/api/health'%os.environ.get('PORT','8000'),timeout=3)"

CMD ["python", "-m", "xss_detector", "serve"]
