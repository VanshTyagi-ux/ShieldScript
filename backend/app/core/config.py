from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    PROJECT_NAME: str = "XSS Detector API"
    VERSION: str = "0.1.0"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: str = "sqlite:///./app.db"

    MAX_BODY: int = 262144  # request-body cap in bytes; same default as the stdlib server
    # Longest HTML the sanitize endpoint accepts, in characters. Sanitizing cost grows quadratically for deeply
    # nested markup (measured: up to 0.4 s at 64 000 characters, 8 s at 256 000), so this is a safety limit.
    MAX_HTML_LENGTH: int = 64_000

    RATE_LIMIT: int = 60  # sustained requests per minute per client on API_V1_PREFIX; same default as the stdlib server
    RATE_BURST: int = 20  # short-burst allowance
    TRUSTED_PROXY_HOPS: int = 0  # proxies in front of this API whose X-Forwarded-For entry to trust

    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    @field_validator("DATABASE_URL")
    @classmethod
    def _use_psycopg_for_postgres(cls, url: str) -> str:
        """Hosting platforms hand out `postgres://...` (or `postgresql://...`), which SQLAlchemy would open
        with the older psycopg2 driver. This project installs psycopg 3, so name it explicitly."""
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url


settings = Settings()
