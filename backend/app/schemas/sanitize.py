from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SanitizeRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {
        "html": '<p onclick="steal()">Hi <b>there</b> <a href="javascript:alert(1)">click</a><script>alert(1)</script></p>'}})

    html: str = Field(description="Rich text / an HTML fragment to sanitize. At most MAX_HTML_LENGTH characters "
                                  "(64 000 by default); longer input is rejected with 413.")


class RemovedTag(BaseModel):
    name: str = Field(description="Lower-cased tag name, e.g. `script`")
    count: int = Field(description="How many of this tag were removed")
    content_removed: bool = Field(description="True if what was inside the tag went with it (script, style); "
                                              "otherwise only the tag was dropped and its text kept")


class RemovedAttribute(BaseModel):
    tag: str = Field(description="Tag the attribute was on")
    name: str = Field(description="Attribute name, e.g. `onclick` (values are never echoed)")
    count: int = Field(description="How many were removed")
    reason: Literal["event_handler", "unsafe_url", "tag_not_allowed", "attribute_not_allowed"] = Field(
        description="`event_handler`: an on* attribute. `unsafe_url`: an allowed href/src whose URL scheme was "
                    "rejected (javascript:, data:, ...). `tag_not_allowed`: it was on a tag that was removed. "
                    "`attribute_not_allowed`: this attribute is not allowed on this tag (style, class, ...)")


class SanitizationReport(BaseModel):
    removed_tags: list[RemovedTag] = Field(description="Most frequent first; at most 100 entries")
    removed_attributes: list[RemovedAttribute] = Field(description="Most frequent first; at most 100 entries")
    comments_removed: int = Field(description="HTML comments stripped")
    total_tags_removed: int = Field(description="Exact number of tags removed, even if the list is cut")
    total_attributes_removed: int = Field(description="Exact number of attributes removed")
    truncated: bool = Field(description="True if a list was cut at 100 entries")


class DetectorAlert(BaseModel):
    """The XSS detector's opinion of the *raw* input. Alert only: it never blocks or changes anything."""

    score: int = Field(description="0-100 rule score")
    level: str = Field(description="safe, low, medium, high or critical")
    is_malicious: bool = Field(description="True if the detector would block this input as plain text")
    ml_probability: float | None = Field(description="ML model's probability of XSS, or null if no model is loaded")
    rule_ids: list[str] = Field(description="Ids of the detection rules that matched (see GET /api/rules on the "
                                            "stdlib server, or the rule catalog in the docs)")


class SanitizeResponse(BaseModel):
    clean: str = Field(description="The sanitized HTML. This is the only value that is safe to store or render as "
                                   "HTML body content")
    changed: bool = Field(description="clean differs from the input. Noisy: harmless re-serialisation (`<br/>` to "
                                      "`<br>`, an added rel=) also sets it, so use `report` to see real removals")
    report: SanitizationReport
    detector: DetectorAlert
