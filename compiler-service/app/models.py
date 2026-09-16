from typing import Optional
from pydantic import BaseModel, Field


class ExecuteRequest(BaseModel):
    language: str = Field(..., pattern="^c$")  # C only for now
    source_code: str = Field(..., min_length=1, max_length=65536)
    stdin: str = Field(default="", max_length=4096)
    timeout_ms: int = Field(default=5000, ge=100, le=10000)
    memory_limit_mb: int = Field(default=64, ge=4, le=128)


class ExecuteResponse(BaseModel):
    success: bool
    status: str  # accepted | compile_error | runtime_error | time_limit_exceeded | memory_limit_exceeded | system_error
    stdout: str
    stderr: str
    compile_error: Optional[str]
    execution_time_ms: int
    memory_used_mb: Optional[float]
