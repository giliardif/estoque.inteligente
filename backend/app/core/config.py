"""
Configuração central da aplicação.

Suporta 3 ambientes via variável ENV: development | staging | production.
Cada ambiente aponta para um banco de dados e segredos distintos —
NUNCA compartilhar banco de produção com staging/desenvolvimento.
"""
from functools import lru_cache
from typing import Literal

from pydantic import Field, PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    ENV: Literal["development", "staging", "production"] = "development"

    # Banco de dados — string de conexão distinta por ambiente (.env.staging / .env.production)
    DATABASE_URL: PostgresDsn

    # Conexão dedicada do módulo de autenticação (papel `auth_service` com
    # BYPASSRLS escopado só a users/refresh_tokens). Se omitida, cai para
    # DATABASE_URL — aceitável em desenvolvimento, NUNCA em produção real
    # (produção deve ter o papel auth_service configurado explicitamente).
    AUTH_DATABASE_URL: PostgresDsn | None = None

    # Segredos — obrigatórios via variável de ambiente, NUNCA com valor default em código
    SECRET_KEY: str = Field(min_length=32)
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS — em produção deve ser lista fechada de domínios, nunca "*"
    ALLOWED_ORIGINS: list[str] = []

    # Rate limiting
    RATE_LIMIT_DEFAULT: str = "100/minute"
    RATE_LIMIT_AUTH: str = "5/minute"

    # Upload de XML de NF-e
    MAX_UPLOAD_SIZE_MB: int = 5

    # Supabase Storage — upload de imagem de produto (Etapa 25). Bucket
    # público: caminho é prefixado por tenant_id/produto_id (UUIDs não
    # adivinháveis), risco aceitável pra foto de produto (não é dado
    # sensível). SERVICE_ROLE_KEY nunca deve ir para o frontend — só o
    # backend fala com o Storage.
    SUPABASE_URL: str | None = None
    SUPABASE_SERVICE_ROLE_KEY: str | None = None
    SUPABASE_STORAGE_BUCKET: str = "produtos-imagens"
    MAX_IMAGEM_PRODUTO_SIZE_MB: int = 3

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_not_default(cls, v: str) -> str:
        forbidden = {"changeme", "secret", "supersecret", "development", "your-secret-key"}
        if v.lower() in forbidden:
            raise ValueError("SECRET_KEY não pode usar um valor padrão/óbvio — gere uma chave forte por ambiente.")
        return v

    @property
    def is_production(self) -> bool:
        return self.ENV == "production"

    @property
    def docs_enabled(self) -> bool:
        # Documentação interativa (/docs) só habilitada fora de produção
        return not self.is_production


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
