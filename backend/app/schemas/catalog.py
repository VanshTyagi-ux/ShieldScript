from pydantic import BaseModel, ConfigDict, Field


class RuleRead(BaseModel):
    id: str = Field(description="Rule id, e.g. XSS002")
    name: str = Field(description="Short rule name")
    category: str = Field(description="markup, uri, javascript, css, template or evasion")
    weight: int = Field(description="Points added to the score when the rule matches")
    description: str = Field(description="What the rule looks for")
    derived: bool = Field(description="True for the obfuscation rule, which is added when decoding changed the input "
                                      "rather than matched by a pattern")


class LevelRead(BaseModel):
    name: str = Field(description="safe, low, medium, high or critical")
    min: int = Field(description="Lowest score in this band")


class RulesResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {
        "rules": [{"id": "XSS001", "name": "Script tag", "category": "markup", "weight": 70,
                   "description": "Opening or closing <script> tag.", "derived": False}],
        "levels": [{"name": "safe", "min": 0}, {"name": "low", "min": 1}, {"name": "medium", "min": 25},
                   {"name": "high", "min": 50}, {"name": "critical", "min": 75}],
        "block_threshold": 25}})

    rules: list[RuleRead] = Field(description="Every pattern rule, then the derived obfuscation rule")
    levels: list[LevelRead] = Field(description="The score bands, lowest first")
    block_threshold: int = Field(description="Score at which input counts as malicious")
