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


# --- Painel da tela de Inventário (Etapa 20) --------------------------------
#
# GET /inventario/painel, separado de GET /inventario (listagem crua) —
# mesmo padrão de /estoque/painel, /compras/painel etc. Atenção: InventarioItem
# não tem tenant_id próprio (gap conhecido registrado no backlog) — o filtro
# de tenant é sempre feito via join com Inventario.tenant_id, nunca direto.

class KpisInventarioOut(BaseModel):
    total_inventarios: int
    inventarios_abertos: int
    itens_divergentes: int
    depositos_distintos: int


class OpcaoFiltroDeposito(BaseModel):
    id: UUID
    nome: str


class FiltrosInventarioOut(BaseModel):
    depositos: list[OpcaoFiltroDeposito]


class InventarioListaItemOut(BaseModel):
    id: UUID
    status: str
    ciclo: str
    deposito_id: UUID | None
    deposito_nome: str | None
    qtd_itens_contados: int
    qtd_divergentes: int
    criado_em: datetime


class PainelInventarioOut(BaseModel):
    itens: list[InventarioListaItemOut]
    kpis: KpisInventarioOut
    filtros: FiltrosInventarioOut
    total: int
    pagina: int
    tamanho: int
