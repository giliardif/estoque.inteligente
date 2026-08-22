from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class EtiquetaModeloBase(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    # Forma livre validada só superficialmente aqui (tamanho do payload) —
    # o conteúdo semântico (elementos, tipo de código, tamanho, colunas,
    # margem/espaçamento, modo de impressão) é interpretado pelo frontend.
    # Mesma abordagem de produtos.campos_customizados.
    config_json: dict = Field(default_factory=dict)

    @field_validator("nome")
    @classmethod
    def sanitize_nome(cls, v: str) -> str:
        cleaned = "".join(ch for ch in v if ch.isprintable())
        if not cleaned.strip():
            raise ValueError("Nome não pode ser vazio ou conter apenas caracteres inválidos.")
        return cleaned.strip()

    @field_validator("config_json")
    @classmethod
    def limitar_tamanho_config(cls, v: dict) -> dict:
        # Payload é pequeno por natureza (config de etiqueta) — limite
        # generoso só pra impedir abuso, não pra restringir uso legítimo.
        import json

        if len(json.dumps(v)) > 20_000:
            raise ValueError("Configuração de etiqueta excede o tamanho permitido.")
        return v


class EtiquetaModeloCreate(EtiquetaModeloBase):
    pass


class EtiquetaModeloUpdate(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=120)
    config_json: dict | None = None


class EtiquetaModeloOut(EtiquetaModeloBase):
    id: UUID
    criado_em: datetime
    atualizado_em: datetime

    model_config = {"from_attributes": True}
