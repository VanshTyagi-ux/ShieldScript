from collections.abc import Generator
from typing import Annotated

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

POSTGRES_CONNECT_TIMEOUT = 10  # seconds


def connect_args_for(url: str) -> dict:
    """Driver options for the database `url` points at.

    SQLite connections are bound to their creating thread by default; FastAPI runs sync endpoints in a threadpool,
    so that check has to be off. PostgreSQL's driver waits forever for a host that never answers (a firewall that
    drops packets, a wrong address), which would hang a request, or the container's start-up, instead of failing so
    that it can be retried or restarted.
    """
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    if url.startswith("postgresql"):
        return {"connect_timeout": POSTGRES_CONNECT_TIMEOUT}
    return {}


# Which database is chosen by DATABASE_URL (see .env.example): SQLite by default, PostgreSQL by setting
# e.g. postgresql+psycopg://user:password@host:5432/dbname. Nothing else in the code changes.
engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args_for(settings.DATABASE_URL),
    pool_pre_ping=True,  # drop dead pooled connections (PostgreSQL restarts, idle timeouts) instead of erroring
    echo=settings.DEBUG,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Base class for all ORM models."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: one session per request, always closed.

    Endpoints commit explicitly; a request that raises before committing leaves nothing half-written,
    because closing the session rolls back any open transaction.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Shorthand for endpoint signatures:  def handler(db: DbSession): ...
DbSession = Annotated[Session, Depends(get_db)]
