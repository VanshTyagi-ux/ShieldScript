"""Create all tables for the models in app.models.

Run from backend/:  python -m scripts.init_db
(Use Alembic migrations instead once the schema needs to evolve.)
"""

import app.models  # noqa: F401  (importing registers the models on Base.metadata)
from app.core.database import Base, engine


def main() -> None:
    Base.metadata.create_all(bind=engine)
    print(f"Created tables: {', '.join(Base.metadata.tables) or '(none - no models defined yet)'}")


if __name__ == "__main__":
    main()
