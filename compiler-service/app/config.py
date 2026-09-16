from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Service
    host: str = "0.0.0.0"
    port: int = 8000
    api_key: str = "CHANGE_ME_COMPILER_SERVICE_SECRET"
    debug: bool = False

    # Docker sandbox image
    sandbox_image: str = "fcf-sandbox:latest"

    # Execution limits (hard maximums — requests cannot exceed these)
    max_timeout_ms: int = 10_000
    max_memory_mb: int = 128
    max_cpu: float = 0.5
    max_pids: int = 32

    # Mock mode: use subprocess instead of Docker (dev only, NEVER in production)
    mock_mode: bool = False

    class Config:
        env_file = ".env"
        env_prefix = "COMPILER_"


settings = Settings()
