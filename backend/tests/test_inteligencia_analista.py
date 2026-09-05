from datetime import date, timedelta

from app.modules.inteligencia.analista import anomalias, indicadores, previsao


def _hoje():
    return date(2026, 1, 31)


def test_serie_diaria_saida_densifica_dias_sem_venda():
    hoje = _hoje()
    movimentos = [(hoje, 10.0), (hoje - timedelta(days=2), 5.0)]
    serie = previsao.serie_diaria_saida(movimentos, janela_dias=5, hoje=hoje)
    assert len(serie) == 5
    assert serie[-1] == 10.0  # hoje
    assert serie[-3] == 5.0  # 2 dias atrás
    assert serie.count(0.0) == 3  # dias sem venda viram zero, não somem


def test_media_movel_ponderada_da_mais_peso_pro_recente():
    serie_crescente = [1.0, 1.0, 1.0, 10.0]  # pico no dia mais recente
    serie_decrescente = [10.0, 1.0, 1.0, 1.0]  # pico no dia mais antigo
    assert previsao.media_movel_ponderada(serie_crescente) > previsao.media_movel_ponderada(serie_decrescente)


def test_media_movel_ponderada_lista_vazia():
    assert previsao.media_movel_ponderada([]) == 0.0


def test_coeficiente_tendencia_detecta_alta_e_baixa():
    subindo = [1.0, 2.0, 3.0, 4.0, 5.0]
    descendo = [5.0, 4.0, 3.0, 2.0, 1.0]
    estavel = [3.0, 3.0, 3.0, 3.0, 3.0]
    assert previsao.coeficiente_tendencia(subindo) > 0
    assert previsao.coeficiente_tendencia(descendo) < 0
    assert previsao.coeficiente_tendencia(estavel) == 0.0


def test_classificar_tendencia_relativa_a_demanda():
    # mesmo coeficiente absoluto, mas relevante pra demanda baixa e
    # irrelevante pra demanda alta
    assert previsao.classificar_tendencia(coef=0.5, demanda_media=2.0) == "alta"
    assert previsao.classificar_tendencia(coef=0.5, demanda_media=200.0) == "estavel"
    assert previsao.classificar_tendencia(coef=0.0, demanda_media=0.0) == "estavel"


def test_calcular_ponto_reposicao():
    ponto = previsao.calcular_ponto_reposicao(demanda_dia=5.0, lead_time_dias=3.0, estoque_seguranca_dias=2.0)
    assert ponto == 25.0  # 5 * (3+2)


def test_sugerir_quantidade_compra_nunca_negativo():
    assert previsao.sugerir_quantidade_compra(estoque_atual=100.0, demanda_dia=1.0, cobertura_alvo_dias=20.0) == 0.0


def test_sugerir_quantidade_compra_positivo_quando_precisa():
    qtd = previsao.sugerir_quantidade_compra(estoque_atual=10.0, demanda_dia=5.0, cobertura_alvo_dias=20.0)
    assert qtd == 90.0  # (5*20) - 10


def test_precisa_repor():
    assert previsao.precisa_repor(estoque_atual=5.0, demanda_dia=5.0, lead_time_dias=3.0) is True
    assert previsao.precisa_repor(estoque_atual=1000.0, demanda_dia=5.0, lead_time_dias=3.0) is False


def test_calcular_giro_estoque_medio_zero():
    assert indicadores.calcular_giro(quantidade_saida_periodo=50.0, estoque_medio=0.0) == 0.0


def test_calcular_giro_normal():
    assert indicadores.calcular_giro(quantidade_saida_periodo=60.0, estoque_medio=30.0) == 2.0


def test_calcular_cobertura_dias_sem_demanda():
    assert indicadores.calcular_cobertura_dias(estoque_atual=50.0, demanda_dia=0.0) is None


def test_calcular_cobertura_dias_normal():
    assert indicadores.calcular_cobertura_dias(estoque_atual=50.0, demanda_dia=5.0) == 10.0


def test_classificar_risco_ruptura():
    assert indicadores.classificar_risco_ruptura(cobertura_dias=1.0, lead_time_dias=3.0) == "alto"
    assert indicadores.classificar_risco_ruptura(cobertura_dias=4.0, lead_time_dias=3.0) == "medio"
    assert indicadores.classificar_risco_ruptura(cobertura_dias=20.0, lead_time_dias=3.0) == "baixo"
    assert indicadores.classificar_risco_ruptura(cobertura_dias=None, lead_time_dias=3.0) == "baixo"


def test_z_score_historico_insuficiente():
    assert anomalias.calcular_z_score(valor_atual=100.0, historico=[10.0, 12.0]) is None


def test_z_score_sem_variacao():
    assert anomalias.calcular_z_score(valor_atual=10.0, historico=[10.0, 10.0, 10.0]) is None


def test_z_score_detecta_pico():
    historico = [10.0, 12.0, 11.0, 9.0, 10.0]
    resultado = anomalias.detectar_anomalia_semanal(semana_atual=50.0, historico_semanas_anteriores=historico)
    assert resultado["classificacao"] == "pico"
    assert resultado["z_score"] > 2.0


def test_z_score_detecta_queda():
    historico = [10.0, 12.0, 11.0, 9.0, 10.0]
    resultado = anomalias.detectar_anomalia_semanal(semana_atual=0.0, historico_semanas_anteriores=historico)
    assert resultado["classificacao"] == "queda"


def test_z_score_normal_nao_dispara():
    historico = [10.0, 12.0, 11.0, 9.0, 10.0]
    resultado = anomalias.detectar_anomalia_semanal(semana_atual=11.0, historico_semanas_anteriores=historico)
    assert resultado["classificacao"] == "normal"


def test_dead_stock_nao_qualifica_se_recente():
    hoje = _hoje()
    resultado = anomalias.avaliar_dead_stock(
        ultima_movimentacao=hoje - timedelta(days=10), hoje=hoje, saldo_atual=20.0, custo_medio=5.0,
    )
    assert resultado is None


def test_dead_stock_nao_qualifica_sem_saldo():
    hoje = _hoje()
    resultado = anomalias.avaliar_dead_stock(
        ultima_movimentacao=hoje - timedelta(days=90), hoje=hoje, saldo_atual=0.0, custo_medio=5.0,
    )
    assert resultado is None


def test_dead_stock_qualifica_e_calcula_valor_em_risco():
    hoje = _hoje()
    resultado = anomalias.avaliar_dead_stock(
        ultima_movimentacao=hoje - timedelta(days=60), hoje=hoje, saldo_atual=10.0, custo_medio=5.0,
    )
    assert resultado is not None
    assert resultado["dias_parado"] == 60
    assert resultado["valor_em_risco"] == 50.0


def test_dead_stock_nunca_movimentado():
    hoje = _hoje()
    assert anomalias.avaliar_dead_stock(ultima_movimentacao=None, hoje=hoje, saldo_atual=10.0, custo_medio=5.0) is None
