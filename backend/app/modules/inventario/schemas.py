from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

MOTIVOS_DIVERGENCIA = ("avaria", "vencimento", "furto", "erro_entrada")


class InventarioAbrir(BaseModel):
    deposito_id: UUID | None = None
    ciclo: str = Field(min_length=2, max_length=20)  # ex: "2026-07"


class InventarioOut(BaseModel):
    id: UUID
    status: str  # aberto | em_analise | fechado
    ciclo: str
    deposito_id: UUID | None
    criado_em: datetime
    enviado_por: UUID | None = None
    enviado_em: datetime | None = None
    aprovado_por: UUID | None = None
    aprovado_em: datetime | None = None

    model_config = {"from_attributes": True}


# --- Etapa A: contagem do operador (tela de contagem, contagem cega) -------
#
# O operador NUNCA recebe qtd_sistema — só o que ele mesmo digitou e um
# indicador de divergência (badge), que a etapa aprovou manter com o
# sinal/magnitude visível (ex: "Sobra +2"), mesmo sem expor o saldo bruto
# do sistema.

class InventarioItemContagemIn(BaseModel):
    qtd_contada: float = Field(ge=0)
    motivo: Literal["avaria", "vencimento", "furto", "erro_entrada"] | None = None
    anexo_url: str | None = Field(default=None, max_length=500)


class InventarioItemOperadorOut(BaseModel):
    produto_id: UUID
    produto_nome: str
    codigo_barras: str | None
    categoria_nome: str | None
    qtd_contada: float | None
    divergencia: float | None  # nunca expõe qtd_sistema, só o resultado da comparação
    status_item: str  # pendente | contado | divergente | aprovado | recontagem_solicitada
    motivo: str | None
    anexo_url: str | None


class ResumoDivergenciasOut(BaseModel):
    sem_divergencia: int
    com_divergencia: int
    pendentes: int


class ProgressoContagemOut(BaseModel):
    total: int
    contados: int
    percentual: float


class PainelOperadorOut(BaseModel):
    inventario: InventarioOut
    progresso: ProgressoContagemOut
    resumo: ResumoDivergenciasOut
    itens: list[InventarioItemOperadorOut]


class EnviarAnaliseOut(BaseModel):
    inventario: InventarioOut
    itens_contados: int
    itens_pendentes: int


# --- Etapa B: conciliação do supervisor -------------------------------------

class DecisaoItemIn(BaseModel):
    acao: Literal["aprovar", "recontagem"]


class InventarioItemConciliacaoOut(BaseModel):
    produto_id: UUID
    produto_nome: str
    codigo_barras: str | None
    qtd_anterior: float  # qtd_sistema — só visível aqui, na conciliação
    qtd_contada: float | None
    divergencia: float | None
    impacto_financeiro: float | None  # divergencia * custo_unitario, calculado em runtime
    status_item: str
    motivo: str | None
    anexo_url: str | None
    decidido_por_nome: str | None
    decidido_em: datetime | None


class KpisConciliacaoOut(BaseModel):
    itens_divergentes: int
    itens_aguardando_decisao: int
    impacto_financeiro_total: float


class ConciliacaoOut(BaseModel):
    inventario: InventarioOut
    enviado_por_nome: str | None
    kpis: KpisConciliacaoOut
    itens: list[InventarioItemConciliacaoOut]


class AprovacaoFinalOut(BaseModel):
    inventario: InventarioOut
    itens_ajustados: int
    impacto_financeiro_total: float


# --- Painel de listagem de ciclos (Etapa 20, mantido) -----------------------
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
