from fastapi import APIRouter

from app.api.v1.endpoints import catalog, health, payloads, sanitizer, scan, submit

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(scan.router, tags=["detector"])
api_router.include_router(submit.router, tags=["detector"])
api_router.include_router(catalog.router, tags=["catalog"])
api_router.include_router(payloads.router, tags=["payloads"])
api_router.include_router(sanitizer.router, tags=["sanitizer"])
