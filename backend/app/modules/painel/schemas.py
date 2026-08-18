from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel

# --- Painel Home / Geral (Etapa 23) -----------------------------------------
#
# Diferente dos demais paineis (Estoque, Produtos, Vendas, ...), este não é a
# tela de gestão de um módulo — é a tela inicial, cruzando dados de vários
# módulos ao mesmo tempo (estoque, movimentações, vendas, categorias,
# alertas). Por isso vive num módulo próprio (`painel`) em vez de dentro de
# um dos módulos existentes: não faria sentido o card de faturamento viver em
# `estoque/`, nem o card de saldo crítico viver em `vendas/`.
#
# Todos os KPIs são calculados sobre o estado atual/mês corrente do tenant —
# mesmo princípio já usado nos demais paineis (KPI não reflete filtro).


class KpiComVariacaoOut(BaseModel):
    valor: float
    # None quando não há base de comparação (mês anterior zerado, ou
    # período anterior sem dado suficiente) — nunca inventamos um "0%" ou
    # "100%" nesse caso, porque isso mentiria sobre a tendência real.
    variacao_percentual: float | None


class KpisPainelOut(BaseModel):
    # Valor do Estoque não tem variação: recalcular o valor do estoque de
    # "um mês atrás" exigiria histórico de custo médio por dia, que não
    # existe hoje (só guardamos o custo médio atual do produto). Um número
    # aproximado pareceria preciso mas estaria errado — melhor não mostrar.
    valor_total_estoque: float
    produtos_cadastrados: KpiComVariacaoOut
    entradas_mes: KpiComVariacaoOut
    saidas_mes: KpiComVariacaoOut
    faturamento_mes: KpiComVariacaoOut


class PontoMovimentacaoOut(BaseModel):
    data: date
    entradas: float
    saidas: float


class ProdutoGiroOut(BaseModel):
    produto_id: UUID
    nome: str
    giro_dias: float | None  # None quando não há saída suficiente pra calcular
    saldo_atual: float


class CategoriaResumoOut(BaseModel):
    categoria_id: UUID | None
    nome: str
    produtos: int
    percentual: float


class ProdutoCriticoOut(BaseModel):
    produto_id: UUID
    nome: str
    categoria_nome: str | None
    saldo_atual: float
    estoque_minimo: float
    nivel: str  # "critico" (< 50% do mínimo) | "baixo" (< 100% do mínimo)


class MovimentacaoRecenteOut(BaseModel):
    id: UUID
    tipo: str
    produto_nome: str
    quantidade: float
    origem: str | None
    criado_em: datetime


class AlertasResumoOut(BaseModel):
    total_ativos: int
    estoque_baixo: int
    validade: int
    produto_parado: int
    pedidos_em_aberto: int


class PainelGeralOut(BaseModel):
    kpis: KpisPainelOut
    movimentacoes_periodo: list[PontoMovimentacaoOut]
    giro_estoque_top5: list[ProdutoGiroOut]
    estoque_por_categoria: list[CategoriaResumoOut]
    estoque_critico: list[ProdutoCriticoOut]
    ultimas_movimentacoes: list[MovimentacaoRecenteOut]
    alertas: AlertasResumoOut
