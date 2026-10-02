from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {"status": "ok", "service": "ScriptShield API",
                                                             "version": "0.1.0", "rules": 24, "ml_loaded": True}})

    status: str = Field(description='Always "ok" while the process is serving requests')
    service: str = Field(description="Service name (PROJECT_NAME)")
    version: str = Field(description="API version (VERSION)")
    rules: int = Field(description="Number of detection rules loaded")
    ml_loaded: bool = Field(description="Whether the ML model was found and loaded (false: rules only)")
