from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PayloadRead(BaseModel):
    """A stored test payload (built straight from a `Payload` ORM row)."""

    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={"example": {"id": 1, "content": "<svg onload=alert(1)>", "source_file": "XSS-BruteLogic.txt",
                                       "category": "standard", "created_at": "2026-09-28T14:33:00"}},
    )

    id: int = Field(description="Primary key")
    content: str = Field(description="The raw payload string (one line of the source file)")
    source_file: str = Field(description="File in data/payloads it came from, e.g. XSS-BruteLogic.txt")
    category: str = Field(description="polyglot, bypass, encoded or standard (inferred from the file name)")
    created_at: datetime = Field(description="When the row was stored. UTC; SQLite returns it without a time zone")


class PayloadPage(BaseModel):
    """One page of a listing. `total` counts every match, so a client can compute the number of pages."""

    items: list[PayloadRead] = Field(description="The payloads on this page, ordered by id")
    total: int = Field(description="How many payloads match the filters in all, ignoring skip and limit")
    skip: int = Field(description="The offset that was applied")
    limit: int = Field(description="The page size that was applied")


class FacetCount(BaseModel):
    name: str = Field(description="The source file or category")
    count: int = Field(description="How many payloads have it")


class PayloadFacets(BaseModel):
    """What the payload listing can be filtered by, with counts. Meant for building filter controls."""

    model_config = ConfigDict(json_schema_extra={"example": {
        "total": 8562,
        "categories": [{"name": "standard", "count": 8027}, {"name": "encoded", "count": 415}],
        "sources": [{"name": "XSS-Cheat-Sheet-PortSwigger.txt", "count": 6042}]}})

    total: int = Field(description="Number of payloads stored")
    categories: list[FacetCount] = Field(description="Each category, largest first")
    sources: list[FacetCount] = Field(description="Each source file, largest first")


class PayloadFilter(BaseModel):
    """Query parameters for listing payloads: `?source_file=XSS-Jhaddix.txt&category=bypass&skip=0&limit=50`.

    Use as `Annotated[PayloadFilter, Query()]` in an endpoint signature. Unset filters match everything.
    """

    source_file: str | None = Field(None, max_length=255, description="Exact source file name, e.g. XSS-BruteLogic.txt")
    category: str | None = Field(None, max_length=64, description="Exact category, e.g. polyglot")
    # The upper bound matches the 32-bit id column (no offset can reach past it) and keeps a huge value from
    # overflowing the database driver's integer type.
    skip: int = Field(0, ge=0, le=2_147_483_647, description="Rows to skip (offset)")
    limit: int = Field(50, ge=1, le=500, description="Maximum rows to return")

    @field_validator("source_file", "category", mode="before")
    @classmethod
    def _blank_means_unset(cls, value):
        # `?category=` arrives as "" - treat it as "no filter" rather than "match nothing".
        if isinstance(value, str) and not value.strip():
            return None
        return value.strip() if isinstance(value, str) else value
