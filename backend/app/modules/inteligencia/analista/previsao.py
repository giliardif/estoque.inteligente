"""
Camada analista — previsão de demanda.

Regra de arquitetura (não-negociável): tudo aqui é Python puro, determinístico,
sem chamada a banco, API externa ou LLM. Recebe listas/números já buscados
pelo service.py e devolve números calculados. Isso é o que faz o resultado
ser auditável (rodar duas vezes com o mesmo histórico dá exatamente o mesmo
número) e o que garante que o consumo de tokens da narrativa não dependa do
volume de dados do tenant — só do resultado, que é sempre pequeno.
"""
from datetime import date, timedelta


def serie_diaria_saida(movimentos: list[tuple[date, float]], janela_dias: int, hoje: date) -> list[float]:
    """Transforma uma lista de (data, quantidade) de saída em uma série
    diária densa dos últimos `janela_dias` dias (dias sem saída viram 0.0),
    ordenada do mais antigo pro mais recente. Densificar é necessário pra
    média móvel ponderada e pra regressão de tendência funcionarem certo —
    sem isso, um produto que só vendeu em 3 dos últimos 30 pareceria ter
    uma demanda muito maior do que tem de fato.
    """
    inicio = hoje - timedelta(days=janela_dias - 1)
    totais_por_dia = {inicio + timedelta(days=i): 0.0 for i in range(janela_dias)}
    for data_mov, quantidade in movimentos:
        if inicio <= data_mov <= hoje:
            totais_por_dia[data_mov] = totais_por_dia.get(data_mov, 0.0) + quantidade
    return [totais_por_dia[inicio + timedelta(days=i)] for i in range(janela_dias)]


def media_movel_ponderada(serie: list[float]) -> float:
    """Média móvel com peso linear crescente — dias recentes pesam mais que
    dias antigos da mesma janela. Preferida a uma média simples porque reage
    mais rápido a uma mudança real de ritmo, sem precisar de bibliotecas de
    estatística (numpy/scipy) só pra isso."""
    if not serie:
        return 0.0
    pesos = list(range(1, len(serie) + 1))
    soma_pesos = sum(pesos)
    if soma_pesos == 0:
        return 0.0
    return sum(v * p for v, p in zip(serie, pesos)) / soma_pesos


def coeficiente_tendencia(serie: list[float]) -> float:
    """Inclinação de uma regressão linear simples (mínimos quadrados) sobre
    a série diária — positivo indica demanda subindo, negativo indica
    demanda caindo, próximo de zero indica estável. Calculado sem numpy:
    fórmula fechada de mínimos quadrados com x = índice do dia (0..n-1)."""
    n = len(serie)
    if n < 2:
        return 0.0
    xs = list(range(n))
    media_x = sum(xs) / n
    media_y = sum(serie) / n
    numerador = sum((x - media_x) * (y - media_y) for x, y in zip(xs, serie))
    denominador = sum((x - media_x) ** 2 for x in xs)
    if denominador == 0:
        return 0.0
    return numerador / denominador


def classificar_tendencia(coef: float, demanda_media: float) -> str:
    """Classifica a tendência em relação à própria demanda média do produto
    (percentual, não valor absoluto) — um coeficiente de 0.5un/dia é
    relevante pra um produto que vende 2un/dia e irrelevante pra um que
    vende 200un/dia."""
    if demanda_media <= 0:
        return "estavel"
    variacao_relativa = coef / demanda_media
    if variacao_relativa > 0.03:
        return "alta"
    if variacao_relativa < -0.03:
        return "baixa"
    return "estavel"


def calcular_demanda(
    movimentos_saida: list[tuple[date, float]],
    hoje: date,
    janela_dias: int = 30,
) -> dict:
    """Função principal da previsão — devolve o pacote completo que vai pra
    `dados_calculados` na tabela insights_gerados (tipo='reposicao')."""
    serie = serie_diaria_saida(movimentos_saida, janela_dias=janela_dias, hoje=hoje)
    demanda_dia = round(media_movel_ponderada(serie), 3)
    coef = coeficiente_tendencia(serie)
    tendencia = classificar_tendencia(coef, demanda_dia)
    return {
        "demanda_media_dia": demanda_dia,
        "tendencia": tendencia,
        "coeficiente_tendencia_dia": round(coef, 4),
        "janela_dias_analisada": janela_dias,
    }


def calcular_ponto_reposicao(demanda_dia: float, lead_time_dias: float, estoque_seguranca_dias: float = 3.0) -> float:
    """Ponto de reposição = demanda esperada durante o prazo de entrega +
    uma margem de segurança em dias, fórmula padrão de gestão de estoque."""
    return round(demanda_dia * (lead_time_dias + estoque_seguranca_dias), 2)


def sugerir_quantidade_compra(
    estoque_atual: float,
    demanda_dia: float,
    cobertura_alvo_dias: float = 20.0,
) -> float:
    """Quantidade sugerida pra trazer a cobertura até `cobertura_alvo_dias`
    de estoque no ritmo atual de demanda. Nunca sugere negativo (estoque
    já confortável pro alvo definido)."""
    alvo = demanda_dia * cobertura_alvo_dias
    return round(max(alvo - estoque_atual, 0.0), 0)


def precisa_repor(estoque_atual: float, demanda_dia: float, lead_time_dias: float, estoque_seguranca_dias: float = 3.0) -> bool:
    return estoque_atual <= calcular_ponto_reposicao(demanda_dia, lead_time_dias, estoque_seguranca_dias)
