from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PLANTCARE_", case_sensitive=False, populate_by_name=True
    )

    environment: Literal["development", "test", "production"] = Field(
        default="production",
        validation_alias=AliasChoices("PLANTCARE_ENV", "PLANTCARE_ENVIRONMENT"),
    )
    auth_mode: Literal["enabled", "disabled"] = "enabled"
    data_dir: Path = Path("/data")
    database_url: str | None = None
    static_dir: Path = Path("/app/frontend")
    log_level: str = "info"
    sync_interval_seconds: int = Field(default=30, ge=5, le=3600)
    supervisor_token: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPERVISOR_TOKEN", "PLANTCARE_SUPERVISOR_TOKEN"),
    )
    cloudflare_account_id: str | None = None
    cloudflare_api_token: SecretStr | None = None

    @property
    def resolved_database_url(self) -> str:
        return self.database_url or f"sqlite+aiosqlite:///{self.data_dir / 'plantcare.db'}"

    @property
    def simulator_enabled(self) -> bool:
        return self.environment in {"development", "test"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
