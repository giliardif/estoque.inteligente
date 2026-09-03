from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

MOTIVOS_DIVERGENCIA = ("avaria", "vencimento", "furto", "erro_entrada")
LIMITE_TENTATIVAS = 3


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


# --- Etapa A: contagem do operador (contagem cega de verdade) --------------
#
# O operador NUNCA recebe qtd_sistema nem divergencia — só o status_item e
# quantas tentativas já usou. Cada envio de contagem é uma "tentativa"
# registrada (log em InventarioItemTentativa), até o limite de 3. O +/- do
# stepper só ajusta o valor local no frontend; a chamada à API só acontece
# quando o operador aperta "Confirmar".

class InventarioItemContagemIn(BaseModel):
    qtd_contada: float = Field(ge=0)


class ResultadoContagemOut(BaseModel):
    produto_id: UUID
    status_item: str
    tentativas: int
    limite_atingido: bool


class JustificativaIn(BaseModel):
    motivo: Literal["avaria", "vencimento", "furto", "erro_entrada"]
    anexo_url: str | None = Field(default=None, max_length=500)


class InventarioItemOperadorOut(BaseModel):
    produto_id: UUID
    produto_nome: str
    codigo_barras: str | None
    categoria_nome: str | None
    qtd_contada: float | None
    status_item: str  # pendente | aguardando_confirmacao | contado | divergente | aprovado | recontagem_solicitada
    tentativas: int
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
    tentativas: int
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


# --- Detalhes do ciclo (histórico, qualquer status) -------------------------
#
# Mesma informação da conciliação, mas consultável mesmo depois do ciclo
# fechado — e com o log completo de tentativas por item, não só o
# resultado final. Restrito a PERFIS_SUPERVISOR, igual à conciliação,
# porque também expõe qtd_sistema/divergência real.

class TentativaOut(BaseModel):
    numero_tentativa: int
    qtd_contada: float
    usuario_nome: str | None
    criado_em: datetime


class InventarioItemDetalheOut(InventarioItemConciliacaoOut):
    tentativas_log: list[TentativaOut]


class DetalheCicloOut(BaseModel):
    inventario: InventarioOut
    enviado_por_nome: str | None
    aprovado_por_nome: str | None
    kpis: KpisConciliacaoOut
    itens: list[InventarioItemDetalheOut]


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
