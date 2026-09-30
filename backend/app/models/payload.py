from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Payload(Base):
    """One test payload, e.g. a line from data/payloads/XSS-BruteLogic.txt."""

    __tablename__ = "payloads"

    id: Mapped[int] = mapped_column(primary_key=True)
    content: Mapped[str] = mapped_column(Text)  # the raw payload string (one line of the source file)
    source_file: Mapped[str] = mapped_column(String(255), index=True)  # e.g. "XSS-BruteLogic.txt"
    category: Mapped[str] = mapped_column(String(64), index=True)  # free-form, e.g. polyglot, bypass, standard
    # Set by the database on insert. SQLite drops the time zone, so values read back naive (UTC there);
    # PostgreSQL returns them timezone-aware.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
