from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ReposicaoOut(BaseModel):
    produto_id: UUID
    produto_nome: str
    estoque_atual: float
    demanda_media_dia: float
    tendencia: str  # alta | baixa | estavel
    quantidade_sugerida: float
    precisa_repor: bool
    narrativa: str | None = None


class IndicadorGiroOut(BaseModel):
    produto_id: UUID
    produto_nome: str
    giro_periodo: float
    cobertura_dias: float | None
    risco_ruptura: str  # alto | medio | baixo


class AnomaliaOut(BaseModel):
    produto_id: UUID
    produto_nome: str
    classificacao: str  # pico | queda
    semana_atual: float
    media_historica: float
    z_score: float | None
    narrativa: str | None = None


class DeadStockOut(BaseModel):
    produto_id: UUID
    produto_nome: str
    dias_parado: int
    saldo_parado: float
    valor_em_risco: float
    narrativa: str | None = None


class PainelInteligenciaOut(BaseModel):
    ultima_analise_em: datetime | None
    resumo_semanal: str | None
    reposicoes: list[ReposicaoOut]
    indicadores_giro: list[IndicadorGiroOut]
    anomalias: list[AnomaliaOut]
    dead_stock: list[DeadStockOut]


class CriarPedidoReposicaoInput(BaseModel):
    produto_id: UUID
    fornecedor_id: UUID | None = None
