from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

TIPOS_VALIDOS = {"validade", "estoque_baixo", "produto_parado"}


class RegraAlertaCreate(BaseModel):
    tipo: str
    parametros: dict = Field(default_factory=dict)
    ativo: bool = True

    @field_validator("tipo")
    @classmethod
    def tipo_valido(cls, v: str) -> str:
        if v not in TIPOS_VALIDOS:
            raise ValueError(f"Tipo deve ser um de: {', '.join(sorted(TIPOS_VALIDOS))}")
        return v


class RegraAlertaOut(BaseModel):
    id: UUID
    tipo: str
    parametros: dict
    ativo: bool

    model_config = {"from_attributes": True}


class RegraAlertaUpdate(BaseModel):
    # Todos os campos opcionais — PATCH parcial. Tipo não é editável por
    # design: trocar o tipo de uma regra já criada muda seu significado por
    # completo, então o fluxo correto é desativar e criar uma nova.
    parametros: dict | None = None
    ativo: bool | None = None


class AlertaOut(BaseModel):
    id: UUID
    tipo: str
    produto_id: UUID
    mensagem: str
    lido: bool
    criado_em: datetime

    model_config = {"from_attributes": True}
