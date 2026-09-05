"""
Camada analista — giro, cobertura e risco de ruptura.

Derivam quase de graça da mesma demanda média diária já calculada em
previsao.py — não é um cálculo novo do zero, é reaproveitamento.
"""


def calcular_giro(quantidade_saida_periodo: float, estoque_medio: float) -> float:
    """Giro no período analisado = quanto do estoque médio 'virou' em
    vendas. estoque_medio=0 (produto sem estoque no período todo) não tem
    giro que faça sentido — devolve 0.0 em vez de dividir por zero."""
    if estoque_medio <= 0:
        return 0.0
    return round(quantidade_saida_periodo / estoque_medio, 2)


def calcular_cobertura_dias(estoque_atual: float, demanda_dia: float) -> float | None:
    """Quantos dias o estoque atual aguenta no ritmo de demanda calculado.
    None (não infinito) quando não há demanda — sinaliza pro chamador que
    o número não é calculável, em vez de um valor grande e enganoso."""
    if demanda_dia <= 0:
        return None
    return round(estoque_atual / demanda_dia, 1)


def classificar_risco_ruptura(cobertura_dias: float | None, lead_time_dias: float) -> str:
    """Classifica o risco considerando o prazo de entrega do fornecedor —
    cobertura de 10 dias é folgada com lead time de 2 dias e apertada com
    lead time de 9."""
    if cobertura_dias is None:
        return "baixo"
    margem = cobertura_dias - lead_time_dias
    if margem <= 0:
        return "alto"
    if margem <= lead_time_dias:
        return "medio"
    return "baixo"


def calcular_indicadores_giro(
    quantidade_saida_periodo: float,
    estoque_medio: float,
    estoque_atual: float,
    demanda_dia: float,
    lead_time_dias: float = 3.0,
) -> dict:
    """Pacote completo pra `dados_calculados` (tipo='indicador_giro')."""
    cobertura = calcular_cobertura_dias(estoque_atual, demanda_dia)
    return {
        "giro_periodo": calcular_giro(quantidade_saida_periodo, estoque_medio),
        "cobertura_dias": cobertura,
        "risco_ruptura": classificar_risco_ruptura(cobertura, lead_time_dias),
    }
