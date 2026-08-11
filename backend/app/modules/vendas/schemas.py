from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ItemVendaInput(BaseModel):
    produto_id: UUID
    quantidade: float = Field(gt=0)
    preco_unitario: float = Field(gt=0)


class VendaCreate(BaseModel):
    itens: list[ItemVendaInput] = Field(min_length=1, max_length=200)  # limite evita payload abusivo


class VendaItemOut(BaseModel):
    produto_id: UUID
    quantidade: float
    preco_unitario: float

    model_config = {"from_attributes": True}


class VendaOut(BaseModel):
    id: UUID
    status: str
    valor_total: float
    criado_em: datetime
    itens: list[VendaItemOut]

    model_config = {"from_attributes": True}


# --- Painel da tela de Vendas (Etapa 16) ------------------------------------

class KpisVendasOut(BaseModel):
    vendas_hoje: int
    faturamento_hoje: float
    ticket_medio_hoje: float
    vendas_canceladas_total: int


class VendaListaItemOut(BaseModel):
    id: UUID
    status: str
    valor_total: float
    qtd_itens: int
    criado_em: datetime
    finalizado_em: datetime | None


class PainelVendasOut(BaseModel):
    itens: list[VendaListaItemOut]
    kpis: KpisVendasOut
    total: int
    pagina: int
    tamanho: int
