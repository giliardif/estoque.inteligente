"""
Camada analista — anomalias (desvio estatístico) e estoque parado (dead stock).

Diferença importante em relação ao alerta de "estoque_baixo" que já existe no
módulo alertas/: aquele é limiar fixo (saldo < mínimo cadastrado); isto aqui é
comportamento fora do padrão histórico do próprio produto (z-score), então
pode disparar mesmo num produto com estoque saudável — o problema não é
quantidade, é ritmo incomum.
"""
from datetime import date
from statistics import mean, pstdev

LIMIAR_Z_SCORE = 2.0  # desvios-padrão pra considerar "fora do padrão"
DIAS_PARADO_DEAD_STOCK = 45


def calcular_z_score(valor_atual: float, historico: list[float]) -> float | None:
    """z-score do valor atual em relação ao histórico (média/desvio-padrão
    populacional). None quando não há histórico suficiente (< 3 semanas) ou
    desvio-padrão é zero (produto com demanda idêntica toda semana — não
    dá pra falar de 'desvio' sem variação nenhuma pra medir)."""
    if len(historico) < 3:
        return None
    desvio = pstdev(historico)
    if desvio == 0:
        return None
    return round((valor_atual - mean(historico)) / desvio, 2)


def classificar_anomalia(z_score: float | None) -> str:
    if z_score is None:
        return "normal"
    if z_score >= LIMIAR_Z_SCORE:
        return "pico"
    if z_score <= -LIMIAR_Z_SCORE:
        return "queda"
    return "normal"


def detectar_anomalia_semanal(semana_atual: float, historico_semanas_anteriores: list[float]) -> dict:
    """Pacote pra `dados_calculados` (tipo='anomalia'). Só deve ser
    persistido pelo service quando classificacao != 'normal' — não faz
    sentido gerar uma linha de insight (e narrativa) pra cada produto sem
    nenhum desvio."""
    z = calcular_z_score(semana_atual, historico_semanas_anteriores)
    return {
        "semana_atual": round(semana_atual, 2),
        "media_historica": round(mean(historico_semanas_anteriores), 2) if historico_semanas_anteriores else 0.0,
        "z_score": z,
        "classificacao": classificar_anomalia(z),
    }


def dias_desde_ultima_movimentacao(ultima_movimentacao: date | None, hoje: date) -> int | None:
    if ultima_movimentacao is None:
        return None
    return (hoje - ultima_movimentacao).days


def avaliar_dead_stock(
    ultima_movimentacao: date | None,
    hoje: date,
    saldo_atual: float,
    custo_medio: float,
    limiar_dias: int = DIAS_PARADO_DEAD_STOCK,
) -> dict | None:
    """None quando o produto não se qualifica como dead stock (movimentou
    recentemente, ou não tem saldo parado pra se preocupar) — o service só
    persiste um insight quando isto não é None."""
    dias_parado = dias_desde_ultima_movimentacao(ultima_movimentacao, hoje)
    if dias_parado is None or dias_parado < limiar_dias or saldo_atual <= 0:
        return None
    return {
        "dias_parado": dias_parado,
        "saldo_parado": saldo_atual,
        "valor_em_risco": round(saldo_atual * custo_medio, 2),
        "ultima_movimentacao": ultima_movimentacao.isoformat(),
    }
