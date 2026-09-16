import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

from .config import settings
from .models import ExecuteRequest, ExecuteResponse
from .executor import execute

logging.basicConfig(level=logging.DEBUG if settings.debug else logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    mode = "MOCK (dev)" if settings.mock_mode else "Docker (production)"
    logger.info(f"FCF Compiler Service starting — mode: {mode}")
    if settings.mock_mode:
        logger.warning("MOCK MODE ACTIVE — NOT SECURE. Use only for development.")
    yield
    logger.info("FCF Compiler Service shutting down")


app = FastAPI(
    title="FCF Compiler Service",
    description="Universal C code execution service for Fastest Coder First",
    version="1.0.0",
    docs_url="/docs" if settings.debug else None,  # disable docs in production
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4000"],  # backend only
    allow_methods=["POST", "GET"],
    allow_headers=["X-API-Key", "Content-Type"],
)


def verify_api_key(x_api_key: Optional[str] = Header(None)) -> None:
    """All requests must provide the correct API key."""
    if not x_api_key or x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "mode": "mock" if settings.mock_mode else "docker",
        "sandbox_image": settings.sandbox_image if not settings.mock_mode else None,
    }


@app.post("/execute", response_model=ExecuteResponse)
async def execute_code(
    request: ExecuteRequest,
    _: None = Depends(verify_api_key),
) -> ExecuteResponse:
    """
    Execute C source code safely and return the result.
    The correct answer comparison happens in the backend, not here.
    This service only executes code and returns raw output.
    """
    logger.info(f"Execute request: timeout={request.timeout_ms}ms memory={request.memory_limit_mb}MB")

    result = execute(
        source_code=request.source_code,
        stdin=request.stdin,
        timeout_ms=request.timeout_ms,
        memory_limit_mb=request.memory_limit_mb,
    )

    logger.info(f"Execute result: status={result.status} time={result.execution_time_ms}ms")
    return result
