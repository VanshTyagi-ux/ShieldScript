# Import every model here: it registers the table on Base.metadata (needed by scripts/init_db.py and Alembic).
from app.models.payload import Payload

__all__ = ["Payload"]
