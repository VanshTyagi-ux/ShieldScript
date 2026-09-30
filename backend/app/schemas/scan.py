from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Finding(BaseModel):
    """One detection rule that matched."""

    rule_id: str = Field(description="Rule id, e.g. XSS002")
    name: str = Field(description="Rule name")
    category: str = Field(description="markup, uri, javascript, css, template or evasion")
    weight: int = Field(description="Points this rule adds to the score")
    description: str = Field(description="What the rule looks for")
    match: str = Field(description="The first matching text (truncated)")
    position: int = Field(description="Where it starts in `decoded` (in characters)")
    count: int = Field(description="How many times the rule matched")


class ScanResult(BaseModel):
    score: int = Field(description="0-100: the sum of the matched rules' weights, capped at 100")
    level: str = Field(description="safe, low, medium, high or critical")
    is_malicious: bool = Field(description="Would be blocked: score >= 25, or ML very confident plus a rule match")
    decode_layers: int = Field(description="How many rounds of decoding (URL, HTML entity, escapes) the input needed")
    decoded: str = Field(description="The normalized text the rules were run against")
    findings: list[Finding] = Field(description="Matched rules, heaviest first")
    ml_probability: float | None = Field(description="ML model's probability of XSS, or null if no model is loaded")
    ml_malicious: bool | None = Field(description="ml_probability >= the model's threshold, or null without a model")


class ScanRequest(BaseModel):
    """Either one `text`, or a `fields` object of form fields. If both are sent, `fields` wins (as it does in
    the stdlib server)."""

    model_config = ConfigDict(json_schema_extra={"example": {"text": "<img src=x onerror=alert(1)>"}})

    text: str | None = Field(None, description="One string to scan")
    fields: dict[str, str] | None = Field(None, description="Named strings to scan, e.g. a form's fields")

    @model_validator(mode="after")
    def _one_of(self) -> Self:
        if self.text is None and self.fields is None:
            raise ValueError("Provide 'text' (string) or 'fields' (object)")
        return self


class FieldsScanResponse(BaseModel):
    results: dict[str, ScanResult] = Field(description="The scan result of each submitted field, by name")
