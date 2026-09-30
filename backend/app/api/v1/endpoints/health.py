from fastapi import APIRouter

from app.core.config import settings
from app.schemas.health import HealthResponse
from app.services import detector

router = APIRouter()


@router.get("/health", response_model=HealthResponse, summary="Liveness check")
def health() -> HealthResponse:
    """Report that the API process is up, with its name and version, how many detection rules are loaded and
    whether the ML model is.

    It does not touch the database, so it is cheap enough for a load balancer or container platform to poll.
    """
    return HealthResponse(status="ok", service=settings.PROJECT_NAME, version=settings.VERSION,
                          rules=detector.rule_count(), ml_loaded=detector.ml_loaded())
