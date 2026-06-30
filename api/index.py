"""Vercel entrypoint: re-exports the FastAPI ASGI app defined at the repo root."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import app  # noqa: E402
