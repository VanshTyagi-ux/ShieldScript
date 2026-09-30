from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api import api_router
from app.core.config import settings
from app.core.errors import install_error_handlers
from app.core.limits import BodyLimitMiddleware
from app.core.ratelimit import RateLimitMiddleware

app = FastAPI(title=settings.PROJECT_NAME, version=settings.VERSION, debug=settings.DEBUG)

# Middleware order: the one added last is outermost. CORS goes outside the rest so a 413/429 still carries
# CORS headers and the browser lets the React app read the error; rate limiting sits outside the body limit
# so an over-limit client is turned away before its body is even inspected.
app.add_middleware(BodyLimitMiddleware, max_body=settings.MAX_BODY)
app.add_middleware(RateLimitMiddleware, prefix=settings.API_V1_PREFIX)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

install_error_handlers(app)
app.include_router(api_router, prefix=settings.API_V1_PREFIX)
