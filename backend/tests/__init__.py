"""Every test module shares one `app`/`TestClient` (see e.g. tests/test_detector_api.py) and together makes
far more requests than a real client's rate-limit burst would allow, so the limiter is off by default for
the whole suite - the same "no limiter = unlimited" convention the stdlib server's own tests rely on.
tests/test_ratelimit.py explicitly re-enables a small one for its own tests and restores this after.
"""

from app.core import ratelimit

ratelimit.limiter = None
