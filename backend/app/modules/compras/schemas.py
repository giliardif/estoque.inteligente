from uuid import UUID

from pydantic import BaseModel, Field
from datetime import datetime


class ItemPedidoInput(BaseModel):
    produto_id: UUID
    quantidade: float = Field(gt=0)
    custo_unitario: float = Field(gt=0)


class PedidoCompraCreate(BaseModel):
    fornecedor_id: UUID | None = None
    itens: list[ItemPedidoInput] = Field(min_length=1, max_length=200)


class ReceberItemInput(BaseModel):
    item_id: UUID
    quantidade_recebida: float = Field(gt=0)


class PedidoItemOut(BaseModel):
    id: UUID
    produto_id: UUID
    quantidade: float
    custo_unitario: float
    quantidade_recebida: float

    model_config = {"from_attributes": True}


class PedidoCompraOut(BaseModel):
    id: UUID
    fornecedor_id: UUID | None
    status: str
    itens: list[PedidoItemOut]

    model_config = {"from_attributes": True}


class SugestaoReposicaoOut(BaseModel):
    produto_id: UUID
    produto_nome: str
    saldo_atual: float
    estoque_minimo: float
    quantidade_sugerida: float


# --- Painel da tela de Compras (Etapa 19) -----------------------------------
#
# GET /compras/painel, separado de GET /compras/pedidos (listagem crua já
# usada) — mesmo padrão de /vendas/painel, /notas-fiscais/painel etc.

class KpisComprasOut(BaseModel):
    total_pedidos: int
    pedidos_em_aberto: int
    valor_total_pedidos: float
    fornecedores_distintos: int


class OpcaoFiltroFornecedorCompras(BaseModel):
    id: UUID
    nome: str


class FiltrosComprasOut(BaseModel):
    fornecedores: list[OpcaoFiltroFornecedorCompras]


class PedidoListaItemOut(BaseModel):
    id: UUID
    status: str
    fornecedor_nome: str | None
    valor_total: float
    qtd_itens: int
    quantidade_pendente: float
    criado_em: datetime


class PainelComprasOut(BaseModel):
    itens: list[PedidoListaItemOut]
    kpis: KpisComprasOut
    filtros: FiltrosComprasOut
    total: int
    pagina: int
    tamanho: int
