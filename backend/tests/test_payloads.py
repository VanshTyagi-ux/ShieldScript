"""Run from backend/:  python -m unittest discover -s tests -t ."""

import os
import unittest
from datetime import datetime
from unittest import mock
from typing import Annotated

from fastapi import FastAPI, Query
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateIndex, CreateTable

from app.core.config import Settings
from app.core.database import Base
from app.models import Payload
from app.schemas.payload import PayloadFilter, PayloadRead


class PayloadModelTests(unittest.TestCase):
    def setUp(self):
        # One shared in-memory database per test; nothing touches the real app.db.
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.addCleanup(self.engine.dispose)

    def test_row_round_trips_and_gets_an_id_and_timestamp(self):
        with Session(self.engine) as db:
            db.add(Payload(content="<script>alert(1)</script>", source_file="XSS-BruteLogic.txt", category="standard"))
            db.commit()
            row = db.scalars(select(Payload)).one()
            self.assertEqual(row.id, 1)
            self.assertEqual(row.content, "<script>alert(1)</script>")
            self.assertEqual((row.source_file, row.category), ("XSS-BruteLogic.txt", "standard"))
            self.assertIsInstance(row.created_at, datetime)  # filled in by the database

    def test_content_is_stored_exactly_including_unicode_and_size(self):
        big = "<img src=x onerror=alert(1)>😀\t\"'`" * 4000  # ~100 KB, well past any VARCHAR limit
        with Session(self.engine) as db:
            db.add(Payload(content=big, source_file="f.txt", category="c"))
            db.commit()
            self.assertEqual(db.scalars(select(Payload.content)).one(), big)

    def test_every_column_is_required(self):
        full = {"content": "x", "source_file": "f.txt", "category": "c"}
        for missing in full:
            with self.subTest(missing=missing), Session(self.engine) as db:
                db.add(Payload(**{k: v for k, v in full.items() if k != missing}))
                with self.assertRaises(IntegrityError):
                    db.commit()

    def test_filter_columns_are_indexed(self):
        indexed = {tuple(ix["column_names"]) for ix in inspect(self.engine).get_indexes("payloads")}
        self.assertIn(("source_file",), indexed)
        self.assertIn(("category",), indexed)

    def test_table_is_valid_postgresql(self):
        # No Postgres server needed: compile the DDL for that dialect and look at what it would run.
        dialect = postgresql.dialect()
        ddl = str(CreateTable(Payload.__table__).compile(dialect=dialect))
        self.assertIn("id SERIAL NOT NULL", ddl.replace("\n", " ").replace("\t", ""))
        self.assertIn("content TEXT NOT NULL", ddl)
        self.assertIn("created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL", ddl)
        for index in Payload.__table__.indexes:
            str(CreateIndex(index).compile(dialect=dialect))  # must not raise


class DatabaseUrlTests(unittest.TestCase):
    def settings(self, url):
        return Settings(_env_file=None, DATABASE_URL=url).DATABASE_URL

    def test_sqlite_is_the_default(self):
        with mock.patch.dict(os.environ):  # a DATABASE_URL in the shell must not change what "default" means
            os.environ.pop("DATABASE_URL", None)
            self.assertEqual(Settings(_env_file=None).DATABASE_URL, "sqlite:///./app.db")

    def test_postgres_urls_from_hosting_platforms_get_the_psycopg_driver(self):
        for given in ("postgres://u:p@h:5432/db", "postgresql://u:p@h:5432/db", "postgresql+psycopg://u:p@h:5432/db"):
            with self.subTest(given=given):
                self.assertEqual(self.settings(given), "postgresql+psycopg://u:p@h:5432/db")

    def test_other_urls_are_left_alone(self):
        for url in ("sqlite:///./x.db", "sqlite://", "postgresql+asyncpg://u:p@h/db", "mysql+pymysql://u:p@h/db"):
            with self.subTest(url=url):
                self.assertEqual(self.settings(url), url)

    def test_the_psycopg_dialect_loads(self):
        # create_engine does not connect; it does import the driver, so this catches a missing psycopg.
        engine = create_engine(self.settings("postgres://u:p@localhost:5432/db"), pool_pre_ping=True)
        self.assertEqual(engine.dialect.driver, "psycopg")
        engine.dispose()


class ConnectArgsTests(unittest.TestCase):
    def test_sqlite_may_be_used_from_the_threadpool(self):
        from app.core.database import connect_args_for
        self.assertEqual(connect_args_for("sqlite:///./app.db"), {"check_same_thread": False})
        self.assertEqual(connect_args_for("sqlite://"), {"check_same_thread": False})

    def test_postgres_gives_up_on_a_host_that_never_answers(self):
        from app.core.database import POSTGRES_CONNECT_TIMEOUT, connect_args_for
        for url in ("postgresql+psycopg://u:p@db:5432/x", "postgresql://u:p@h/x"):
            self.assertEqual(connect_args_for(url), {"connect_timeout": POSTGRES_CONNECT_TIMEOUT})
        self.assertTrue(0 < POSTGRES_CONNECT_TIMEOUT <= 30)

    def test_other_databases_get_no_options_we_cannot_vouch_for(self):
        from app.core.database import connect_args_for
        self.assertEqual(connect_args_for("mysql+pymysql://u:p@h/x"), {})


class PayloadSchemaTests(unittest.TestCase):
    def test_read_schema_serialises_an_orm_row(self):
        row = Payload(id=7, content="<b>", source_file="f.txt", category="c", created_at=datetime(2026, 1, 2, 3, 4, 5))
        out = PayloadRead.model_validate(row).model_dump(mode="json")
        self.assertEqual(out, {"id": 7, "content": "<b>", "source_file": "f.txt", "category": "c",
                               "created_at": "2026-01-02T03:04:05"})

    def test_filter_defaults(self):
        f = PayloadFilter()
        self.assertEqual((f.source_file, f.category, f.skip, f.limit), (None, None, 0, 50))

    def test_filter_bounds(self):
        for bad in ({"skip": -1}, {"skip": 2**31}, {"skip": 2**63}, {"limit": 0}, {"limit": 501}, {"source_file": "x" * 256},{"category": "x" * 65}):
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                PayloadFilter(**bad)
        self.assertEqual(PayloadFilter(limit=500, skip=10_000).limit, 500)

    def test_blank_filters_mean_unset_and_values_are_trimmed(self):
        f = PayloadFilter(source_file="  ", category="")
        self.assertEqual((f.source_file, f.category), (None, None))
        self.assertEqual(PayloadFilter(source_file=" XSS-Jhaddix.txt ").source_file, "XSS-Jhaddix.txt")

    def test_filter_works_as_fastapi_query_parameters(self):
        app = FastAPI()

        @app.get("/probe")
        def probe(f: Annotated[PayloadFilter, Query()]):
            return f.model_dump()

        client = TestClient(app)
        r = client.get("/probe", params={"source_file": "a.txt", "category": "bypass", "skip": 20, "limit": 10})
        self.assertEqual(r.json(), {"source_file": "a.txt", "category": "bypass", "skip": 20, "limit": 10})
        self.assertEqual(client.get("/probe").json(),
                         {"source_file": None, "category": None, "skip": 0, "limit": 50})
        self.assertEqual(client.get("/probe?category=").json()["category"], None)
        self.assertEqual(client.get("/probe?limit=501").status_code, 422)
        self.assertEqual(client.get("/probe?skip=-1").status_code, 422)
        self.assertEqual(client.get("/probe?limit=abc").status_code, 422)


if __name__ == "__main__":
    unittest.main()
