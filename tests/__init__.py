"""Test package. The scan history file defaults to scans.db in the project root; send it to a temporary
directory for every test run (in-process servers and the subprocess servers of the smoke tests alike), so no test
ever writes into a real history (the one a demo shows)."""

import atexit
import os
import tempfile
from pathlib import Path

from xss_detector import config

_scratch = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
atexit.register(_scratch.cleanup)
config.DEFAULT_SCAN_DB = Path(_scratch.name) / "scans.db"
os.environ["SCAN_DB"] = str(config.DEFAULT_SCAN_DB)  # servers started as subprocesses by the tests inherit it
