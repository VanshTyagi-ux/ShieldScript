from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query

from app.core.database import DbSession
from app.schemas.payload import PayloadFacets, PayloadFilter, PayloadPage, PayloadRead
from app.schemas.submit import ErrorResponse
from app.services import payloads

router = APIRouter()

# The id column is a 32-bit integer on PostgreSQL; anything larger cannot exist (and would overflow SQLite's driver).
MAX_ID = 2_147_483_647


@router.get(
    "/payloads",
    response_model=PayloadPage,
    responses={400: {"model": ErrorResponse, "description": "A query parameter is out of range or not a number"}},
    summary="List stored test payloads",
)
def list_payloads(filters: Annotated[PayloadFilter, Query()], db: DbSession) -> PayloadPage:
    """Return one page of the stored XSS test payloads.

    - **source_file**: only payloads from this file, e.g. `XSS-BruteLogic.txt` (exact match).
    - **category**: only this category: `standard`, `polyglot`, `bypass` or `encoded` (exact match).
    - **skip** / **limit**: offset and page size (`limit` is 1-500, default 50).

    Filters combine with AND, and a blank value means "no filter". Results are ordered by `id`, so paging is
    stable. `total` is the number of matches across all pages.
    """
    rows, total = payloads.list_payloads(db, filters)
    return PayloadPage(items=[PayloadRead.model_validate(r) for r in rows],
                       total=total, skip=filters.skip, limit=filters.limit)


# Declared before /payloads/{payload_id}, or "facets" would be parsed as an id.
@router.get("/payloads/facets", response_model=PayloadFacets, summary="Payload filter options with counts")
def payload_facets(db: DbSession) -> dict:
    """List the categories and source files that exist, with how many payloads each has, largest first. Use it to
    fill filter dropdowns for `GET /payloads`; `total` is the number of payloads stored.
    """
    return payloads.payload_facets(db)


@router.get(
    "/payloads/{payload_id}",
    response_model=PayloadRead,
    responses={
        400: {"model": ErrorResponse, "description": "`payload_id` is not a positive integer"},
        404: {"model": ErrorResponse, "description": "No payload has this id"},
    },
    summary="Get one payload",
)
def get_payload(
    payload_id: Annotated[int, Path(ge=1, le=MAX_ID, description="The payload's id", examples=[1])],
    db: DbSession,
) -> PayloadRead:
    """Return the full record of a single payload: its content, source file, category and creation time."""
    row = payloads.get_payload(db, payload_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Payload not found")
    return PayloadRead.model_validate(row)
