from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class InventarioAbrir(BaseModel):
    deposito_id: UUID | None = None
    ciclo: str = Field(min_length=2, max_length=20)  # ex: "2026-07"


class InventarioItemContagem(BaseModel):
    produto_id: UUID
    qtd_contada: float = Field(ge=0)


class InventarioFechar(BaseModel):
    itens: list[InventarioItemContagem] = Field(min_length=1, max_length=5000)  # limite evita payload abusivo


class InventarioItemOut(BaseModel):
    produto_id: UUID
    qtd_sistema: float
    qtd_contada: float | None
    divergencia: float | None

    model_config = {"from_attributes": True}


class InventarioOut(BaseModel):
    id: UUID
    status: str
    ciclo: str
    deposito_id: UUID | None
    criado_em: datetime

    model_config = {"from_attributes": True}
