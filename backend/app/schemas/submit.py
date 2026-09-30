from pydantic import BaseModel, ConfigDict, Field

from app.schemas.scan import ScanResult


class SubmitRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {"fields": {
        "name": "Ada Lovelace", "email": "ada@example.com", "website": "https://example.com", "comment": "5 < 10."}}})

    fields: dict[str, str] = Field(description="Form fields by name. `email` and `website` get extra validation")


class SubmitAccepted(BaseModel):
    accepted: bool = Field(True, description="Always true here")
    sanitized: dict[str, str] = Field(description="HTML-escaped copy of every value, safe to render as text")
    results: dict[str, ScanResult] = Field(description="The scan of every field")


class SubmitRejected(BaseModel):
    accepted: bool = Field(False, description="Always false here")
    errors: dict[str, str] = Field(description="Field name to what is wrong with it")
    results: dict[str, ScanResult] = Field(description="The scan of every field")


class ErrorResponse(BaseModel):
    """The shape of every error the API returns."""

    model_config = ConfigDict(json_schema_extra={"example": {"error": "Body must be valid JSON"}})

    error: str = Field(description="What went wrong")
