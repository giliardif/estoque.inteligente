"""
Templates de prompt por tipo de insight.

Regra: o prompt final é sempre pequeno e de tamanho previsível — nunca cresce
com o volume de dados do tenant, só com o número de campos do dict recebido
(que é fixo por tipo). Isso é o que mantém o consumo de tokens baixo e
previsível, do jeito que foi definido com o Giliardi.
"""

INSTRUCAO_BASE = (
    "Você é o analista de estoque de um sistema de gestão pra pequenos negócios "
    "de varejo/confeitaria. Escreva uma narrativa curta (2 a 3 frases) explicando "
    "o que os dados abaixo significam pra quem toca a loja no dia a dia. "
    "Regras: use APENAS os números fornecidos, nunca invente ou estime valores "
    "que não estão nos dados; tom direto e prático, sem jargão técnico de "
    "estatística (não fale em 'z-score', 'desvio padrão', 'regressão'); "
    "não repita os números crus da forma como já aparecem em tela, interprete-os."
)


def prompt_reposicao(dados: dict) -> str:
    return (
        f"{INSTRUCAO_BASE}\n\n"
        f"Tipo: sugestão de reposição de estoque.\n"
        f"Produto: {dados['produto_nome']}\n"
        f"Estoque atual: {dados['estoque_atual']} un\n"
        f"Demanda média por dia: {dados['demanda_media_dia']} un\n"
        f"Tendência: {dados['tendencia']}\n"
        f"Quantidade sugerida de compra: {dados['quantidade_sugerida']} un\n"
    )


def prompt_anomalia(dados: dict) -> str:
    return (
        f"{INSTRUCAO_BASE}\n\n"
        f"Tipo: anomalia na saída do produto (fora do padrão histórico).\n"
        f"Produto: {dados['produto_nome']}\n"
        f"Classificação: {dados['classificacao']} (pico = saída muito acima do normal, "
        f"queda = saída muito abaixo do normal)\n"
        f"Saída desta semana: {dados['semana_atual']} un\n"
        f"Média histórica: {dados['media_historica']} un\n"
        f"Sugira, em tom de hipótese (não afirmação), uma possível causa comum "
        f"pra esse tipo de desvio.\n"
    )


def prompt_dead_stock(dados: dict) -> str:
    return (
        f"{INSTRUCAO_BASE}\n\n"
        f"Tipo: estoque parado (dead stock).\n"
        f"Produto: {dados['produto_nome']}\n"
        f"Dias sem nenhuma movimentação: {dados['dias_parado']}\n"
        f"Quantidade parada: {dados['saldo_parado']} un\n"
        f"Valor financeiro parado: R$ {dados['valor_em_risco']}\n"
        f"Sugira uma ação prática (ex: promoção, combo, revisar mix) sem "
        f"assumir que já existe uma ferramenta de promoção no sistema.\n"
    )


def prompt_resumo_semanal(dados: dict) -> str:
    itens = "\n".join(f"- {item}" for item in dados.get("pontos_relevantes", []))
    return (
        f"{INSTRUCAO_BASE}\n\n"
        f"Tipo: resumo semanal da loja, juntando os achados mais importantes "
        f"da semana em um só parágrafo curto (3 a 4 frases) pro gestor ler de manhã.\n"
        f"Achados da semana:\n{itens}\n"
    )


MONTADORES_POR_TIPO = {
    "reposicao": prompt_reposicao,
    "anomalia": prompt_anomalia,
    "dead_stock": prompt_dead_stock,
    "resumo_semanal": prompt_resumo_semanal,
}


def montar_prompt(tipo: str, dados: dict) -> str:
    montador = MONTADORES_POR_TIPO.get(tipo)
    if montador is None:
        raise ValueError(f"Tipo de insight sem template de narrativa: {tipo}")
    return montador(dados)
