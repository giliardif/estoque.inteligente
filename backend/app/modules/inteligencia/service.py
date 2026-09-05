"""
Orquestrador da camada de inteligência — é o ÚNICO lugar que fala com as
duas camadas ao mesmo tempo. `analista/` nunca importa banco; `narrativa/`
nunca importa banco; é este arquivo que busca dado, chama analista, persiste
em insights_gerados, e só então (opcionalmente) chama narrativa.
"""
import hashlib
import json
import logging
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import InsightGerado, Movimentacao, Produto
from app.modules.inteligencia.analista import anomalias, indicadores, previsao
from app.modules.inteligencia.narrativa.cliente_llm import NarrativaIndisponivel, narrar_insight
from app.modules.inteligencia.schemas import (
    AnomaliaOut,
    DeadStockOut,
    IndicadorGiroOut,
    PainelInteligenciaOut,
    ReposicaoOut,
)

logger = logging.getLogger(__name__)

JANELA_DEMANDA_DIAS = 30
JANELA_HISTORICO_SEMANAS = 12
LEAD_TIME_PADRAO_DIAS = 3.0  # não há lead time por fornecedor cadastrado hoje — ver DEVLOG


def _hash_de(dados: dict) -> str:
    return hashlib.sha256(json.dumps(dados, sort_keys=True, default=str).encode()).hexdigest()


async def _produtos_ativos(db: AsyncSession, tenant_id: UUID) -> list[Produto]:
    stmt = select(Produto).where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True))
    return list((await db.execute(stmt)).scalars().all())


async def _saldos_atuais(db: AsyncSession, tenant_id: UUID) -> dict[UUID, float]:
    from app.modules.estoque.service import saldo_geral

    linhas = await saldo_geral(db, tenant_id=tenant_id)
    return {linha["produto_id"]: linha["saldo"] for linha in linhas}


async def _movimentos_saida_por_produto(
    db: AsyncSession, tenant_id: UUID, hoje: date, dias: int
) -> dict[UUID, list[tuple[date, float]]]:
    inicio = datetime.combine(hoje - timedelta(days=dias - 1), datetime.min.time(), tzinfo=timezone.utc)
    stmt = (
        select(
            Movimentacao.produto_id,
            func.date(Movimentacao.criado_em).label("dia"),
            func.sum(Movimentacao.quantidade).label("quantidade"),
        )
        .where(
            Movimentacao.tenant_id == tenant_id,
            Movimentacao.tipo == "saida",
            Movimentacao.criado_em >= inicio,
        )
        .group_by(Movimentacao.produto_id, func.date(Movimentacao.criado_em))
    )
    linhas = (await db.execute(stmt)).all()
    resultado: dict[UUID, list[tuple[date, float]]] = {}
    for produto_id, dia, quantidade in linhas:
        resultado.setdefault(produto_id, []).append((dia, float(quantidade)))
    return resultado


async def _ultima_movimentacao_por_produto(db: AsyncSession, tenant_id: UUID) -> dict[UUID, date]:
    stmt = (
        select(Movimentacao.produto_id, func.max(Movimentacao.criado_em))
        .where(Movimentacao.tenant_id == tenant_id)
        .group_by(Movimentacao.produto_id)
    )
    linhas = (await db.execute(stmt)).all()
    return {produto_id: ultima.date() for produto_id, ultima in linhas if ultima is not None}


def _series_semanais(serie_diaria: list[float]) -> list[float]:
    """Agrupa uma série diária (mais antiga -> mais recente) em totais
    semanais de 7 em 7 dias, mesmo agrupamento pros dois lados (histórico e
    semana atual usam o mesmo tamanho de janela)."""
    semanas = []
    for i in range(0, len(serie_diaria), 7):
        bloco = serie_diaria[i : i + 7]
        if len(bloco) == 7:
            semanas.append(sum(bloco))
    return semanas


async def _upsert_insight(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    tipo: str,
    produto_id: UUID | None,
    dados_calculados: dict,
) -> InsightGerado:
    novo_hash = _hash_de(dados_calculados)
    stmt = select(InsightGerado).where(
        InsightGerado.tenant_id == tenant_id,
        InsightGerado.tipo == tipo,
        InsightGerado.produto_id == produto_id,
    )
    insight = (await db.execute(stmt)).scalar_one_or_none()

    if insight is None:
        insight = InsightGerado(
            tenant_id=tenant_id, tipo=tipo, produto_id=produto_id,
            dados_calculados=dados_calculados, hash_calculo=novo_hash,
        )
        db.add(insight)
        await db.flush()
        precisa_narrar = True
    else:
        precisa_narrar = insight.hash_calculo != novo_hash or insight.narrativa is None
        insight.dados_calculados = dados_calculados
        insight.hash_calculo = novo_hash
        insight.atualizado_em = datetime.utcnow()

    if precisa_narrar:
        try:
            dados_para_narrar = {**dados_calculados, "produto_nome": dados_calculados.get("produto_nome", "")}
            insight.narrativa = narrar_insight(tipo, dados_para_narrar)
            insight.narrativa_gerada_em = datetime.utcnow()
        except NarrativaIndisponivel as exc:
            logger.warning("Narrativa indisponível (tenant=%s tipo=%s produto=%s): %s", tenant_id, tipo, produto_id, exc)
            # Mantém a narrativa anterior (se houver) em vez de apagar — o
            # cálculo novo já foi persistido, só a narração ficou pra trás.

    return insight


async def _remover_insights_que_nao_qualificam_mais(
    db: AsyncSession, *, tenant_id: UUID, tipo: str, produto_ids_qualificados: set[UUID]
) -> None:
    stmt = select(InsightGerado).where(InsightGerado.tenant_id == tenant_id, InsightGerado.tipo == tipo)
    existentes = (await db.execute(stmt)).scalars().all()
    for insight in existentes:
        if insight.produto_id not in produto_ids_qualificados:
            await db.delete(insight)


async def rodar_analise(db: AsyncSession, *, tenant_id: UUID) -> PainelInteligenciaOut:
    hoje = datetime.now(timezone.utc).date()
    produtos = await _produtos_ativos(db, tenant_id)
    saldos = await _saldos_atuais(db, tenant_id)
    movimentos_por_produto = await _movimentos_saida_por_produto(
        db, tenant_id, hoje, dias=JANELA_HISTORICO_SEMANAS * 7
    )
    ultima_mov_por_produto = await _ultima_movimentacao_por_produto(db, tenant_id)

    reposicoes: list[ReposicaoOut] = []
    indicadores_giro: list[IndicadorGiroOut] = []
    anomalias_out: list[AnomaliaOut] = []
    dead_stock_out: list[DeadStockOut] = []

    ids_com_anomalia: set[UUID] = set()
    ids_dead_stock: set[UUID] = set()
    pontos_relevantes: list[str] = []

    for produto in produtos:
        estoque_atual = saldos.get(produto.id, 0.0)
        movimentos_completos = movimentos_por_produto.get(produto.id, [])
        movimentos_janela_demanda = [
            (d, q) for d, q in movimentos_completos if d >= hoje - timedelta(days=JANELA_DEMANDA_DIAS - 1)
        ]

        # --- Reposição (previsão de demanda + tendência) ---
        demanda = previsao.calcular_demanda(movimentos_janela_demanda, hoje=hoje, janela_dias=JANELA_DEMANDA_DIAS)
        demanda_dia = demanda["demanda_media_dia"]
        qtd_sugerida = previsao.sugerir_quantidade_compra(estoque_atual, demanda_dia)
        precisa = previsao.precisa_repor(estoque_atual, demanda_dia, LEAD_TIME_PADRAO_DIAS)
        dados_reposicao = {
            "produto_nome": produto.nome,
            "estoque_atual": estoque_atual,
            **demanda,
            "quantidade_sugerida": qtd_sugerida,
            "precisa_repor": precisa,
        }
        insight_reposicao = await _upsert_insight(
            db, tenant_id=tenant_id, tipo="reposicao", produto_id=produto.id, dados_calculados=dados_reposicao
        )
        reposicoes.append(
            ReposicaoOut(
                produto_id=produto.id, produto_nome=produto.nome, estoque_atual=estoque_atual,
                demanda_media_dia=demanda_dia, tendencia=demanda["tendencia"], quantidade_sugerida=qtd_sugerida,
                precisa_repor=precisa, narrativa=insight_reposicao.narrativa,
            )
        )
        if precisa:
            pontos_relevantes.append(
                f"{produto.nome} precisa de reposição (estoque {estoque_atual}un, sugestão {qtd_sugerida}un)"
            )

        # --- Indicadores de giro/cobertura/ruptura (reaproveita demanda_dia) ---
        serie_diaria = previsao.serie_diaria_saida(movimentos_janela_demanda, JANELA_DEMANDA_DIAS, hoje)
        qtd_saida_periodo = sum(serie_diaria)
        estoque_medio = (estoque_atual + max(estoque_atual - qtd_saida_periodo, 0.0)) / 2
        dados_giro = indicadores.calcular_indicadores_giro(
            quantidade_saida_periodo=qtd_saida_periodo, estoque_medio=estoque_medio,
            estoque_atual=estoque_atual, demanda_dia=demanda_dia, lead_time_dias=LEAD_TIME_PADRAO_DIAS,
        )
        await _upsert_insight(
            db, tenant_id=tenant_id, tipo="indicador_giro", produto_id=produto.id,
            dados_calculados={"produto_nome": produto.nome, **dados_giro},
        )
        indicadores_giro.append(
            IndicadorGiroOut(produto_id=produto.id, produto_nome=produto.nome, **dados_giro)
        )

        # --- Anomalia (z-score semanal) ---
        serie_completa = previsao.serie_diaria_saida(movimentos_completos, JANELA_HISTORICO_SEMANAS * 7, hoje)
        semanas = _series_semanais(serie_completa)
        if len(semanas) >= 4:
            semana_atual, historico_semanas = semanas[-1], semanas[:-1]
            resultado_anomalia = anomalias.detectar_anomalia_semanal(semana_atual, historico_semanas)
            if resultado_anomalia["classificacao"] != "normal":
                ids_com_anomalia.add(produto.id)
                dados_anomalia = {"produto_nome": produto.nome, **resultado_anomalia}
                insight_anomalia = await _upsert_insight(
                    db, tenant_id=tenant_id, tipo="anomalia", produto_id=produto.id, dados_calculados=dados_anomalia
                )
                anomalias_out.append(
                    AnomaliaOut(
                        produto_id=produto.id, produto_nome=produto.nome,
                        classificacao=resultado_anomalia["classificacao"], semana_atual=semana_atual,
                        media_historica=resultado_anomalia["media_historica"], z_score=resultado_anomalia["z_score"],
                        narrativa=insight_anomalia.narrativa,
                    )
                )
                verbo = "pico" if resultado_anomalia["classificacao"] == "pico" else "queda"
                pontos_relevantes.append(f"{produto.nome} teve {verbo} de saída fora do padrão essa semana")

        # --- Dead stock ---
        resultado_dead_stock = anomalias.avaliar_dead_stock(
            ultima_movimentacao=ultima_mov_por_produto.get(produto.id), hoje=hoje,
            saldo_atual=estoque_atual, custo_medio=float(produto.custo_medio),
        )
        if resultado_dead_stock is not None:
            ids_dead_stock.add(produto.id)
            dados_dead_stock = {"produto_nome": produto.nome, **resultado_dead_stock}
            insight_dead_stock = await _upsert_insight(
                db, tenant_id=tenant_id, tipo="dead_stock", produto_id=produto.id, dados_calculados=dados_dead_stock
            )
            dead_stock_out.append(
                DeadStockOut(
                    produto_id=produto.id, produto_nome=produto.nome,
                    dias_parado=resultado_dead_stock["dias_parado"], saldo_parado=resultado_dead_stock["saldo_parado"],
                    valor_em_risco=resultado_dead_stock["valor_em_risco"], narrativa=insight_dead_stock.narrativa,
                )
            )
            pontos_relevantes.append(
                f"{produto.nome} está parado há {resultado_dead_stock['dias_parado']} dias "
                f"(R$ {resultado_dead_stock['valor_em_risco']} em risco)"
            )

    # Anomalias/dead stock que não qualificam mais somem da tela (não ficam
    # eternamente persistidos depois que o comportamento normaliza).
    await _remover_insights_que_nao_qualificam_mais(db, tenant_id=tenant_id, tipo="anomalia", produto_ids_qualificados=ids_com_anomalia)
    await _remover_insights_que_nao_qualificam_mais(db, tenant_id=tenant_id, tipo="dead_stock", produto_ids_qualificados=ids_dead_stock)

    # --- Resumo semanal (narrado só se houver algo relevante pra contar) ---
    resumo_texto = None
    if pontos_relevantes:
        dados_resumo = {"pontos_relevantes": pontos_relevantes[:8]}  # teto pra não inflar o prompt sem limite
        insight_resumo = await _upsert_insight(
            db, tenant_id=tenant_id, tipo="resumo_semanal", produto_id=None, dados_calculados=dados_resumo
        )
        resumo_texto = insight_resumo.narrativa

    await db.commit()

    return PainelInteligenciaOut(
        ultima_analise_em=datetime.now(timezone.utc), resumo_semanal=resumo_texto,
        reposicoes=reposicoes, indicadores_giro=indicadores_giro,
        anomalias=anomalias_out, dead_stock=dead_stock_out,
    )


async def obter_painel(db: AsyncSession, *, tenant_id: UUID) -> PainelInteligenciaOut:
    """Lê o que já está persistido, sem recalcular nada — usado quando o
    usuário só abre a tela, sem clicar em 'Atualizar análise'."""
    stmt = select(InsightGerado).where(InsightGerado.tenant_id == tenant_id)
    insights = (await db.execute(stmt)).scalars().all()

    reposicoes, indicadores_giro, anomalias_out, dead_stock_out = [], [], [], []
    resumo_texto = None
    ultima_analise = None

    for insight in insights:
        ultima_analise = max(filter(None, [ultima_analise, insight.atualizado_em]), default=None)
        dados = insight.dados_calculados
        nome = dados.get("produto_nome", "")
        if insight.tipo == "reposicao":
            reposicoes.append(ReposicaoOut(
                produto_id=insight.produto_id, produto_nome=nome, estoque_atual=dados["estoque_atual"],
                demanda_media_dia=dados["demanda_media_dia"], tendencia=dados["tendencia"],
                quantidade_sugerida=dados["quantidade_sugerida"], precisa_repor=dados["precisa_repor"],
                narrativa=insight.narrativa,
            ))
        elif insight.tipo == "indicador_giro":
            indicadores_giro.append(IndicadorGiroOut(
                produto_id=insight.produto_id, produto_nome=nome, giro_periodo=dados["giro_periodo"],
                cobertura_dias=dados["cobertura_dias"], risco_ruptura=dados["risco_ruptura"],
            ))
        elif insight.tipo == "anomalia":
            anomalias_out.append(AnomaliaOut(
                produto_id=insight.produto_id, produto_nome=nome, classificacao=dados["classificacao"],
                semana_atual=dados["semana_atual"], media_historica=dados["media_historica"],
                z_score=dados["z_score"], narrativa=insight.narrativa,
            ))
        elif insight.tipo == "dead_stock":
            dead_stock_out.append(DeadStockOut(
                produto_id=insight.produto_id, produto_nome=nome, dias_parado=dados["dias_parado"],
                saldo_parado=dados["saldo_parado"], valor_em_risco=dados["valor_em_risco"],
                narrativa=insight.narrativa,
            ))
        elif insight.tipo == "resumo_semanal":
            resumo_texto = insight.narrativa

    return PainelInteligenciaOut(
        ultima_analise_em=ultima_analise, resumo_semanal=resumo_texto, reposicoes=reposicoes,
        indicadores_giro=indicadores_giro, anomalias=anomalias_out, dead_stock=dead_stock_out,
    )
