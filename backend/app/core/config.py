from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "MindWell API"
    api_v1_prefix: str = "/api/v1"
    environment: str = "development"
    debug: bool = True

    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/mindwell"

    jwt_secret_key: str = "change-this-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    invitation_code_secret: str = "change-this-in-production"
    invitation_expire_days: int = 7
    frontend_base_url: str = "http://localhost:5173"
    serve_frontend: bool = False
    frontend_dist_dir: str = "dist"

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    auto_seed: bool = True
    seed_send_emails: bool = False

    mail_mailer: str = "smtp"
    mail_scheme: str | None = None
    mail_host: str = "smtp.gmail.com"
    mail_port: int = 587
    mail_username: str = ""
    mail_password: str = ""
    mail_encryption: str = "tls"
    mail_from_address: str = "no-reply@mindwell.local"
    mail_from_name: str = "MindWell"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @field_validator("debug", "serve_frontend", mode="before")
    @classmethod
    def normalize_debug_value(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "prod", "production", "off", "false", "0", "no"}:
                return False
            if normalized in {"debug", "dev", "development", "on", "true", "1", "yes"}:
                return True
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
