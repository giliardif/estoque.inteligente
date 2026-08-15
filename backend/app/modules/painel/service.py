from datetime import date, datetime, timedelta
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    AlertaGerado, Categoria, Movimentacao, PedidoCompra, Produto, Venda,
)
from app.modules.painel.schemas import (
    AlertasResumoOut, CategoriaResumoOut, KpisPainelOut, MovimentacaoRecenteOut,
    PainelGeralOut, PontoMovimentacaoOut, ProdutoCriticoOut, ProdutoGiroOut,
)

# Mesma regra de "em aberto" usada em compras/service.py (PEDIDOS_EM_ABERTO).
# Duplicado aqui pelo mesmo motivo documentado em estoque/service.py
# (DIAS_VENCIMENTO_PROXIMO): evitar import cruzado entre módulos.
PEDIDOS_EM_ABERTO = ("rascunho", "recebido_parcial")

DIAS_PADRAO_GRAFICO = 7
DIAS_JANELA_GIRO = 30  # janela usada pra calcular a média diária de saída


def _saldo_expr():
    return func.sum(
        case(
            (Movimentacao.tipo == "entrada", Movimentacao.quantidade),
            (Movimentacao.tipo.in_(("saida", "transferencia")), -Movimentacao.quantidade),
            (Movimentacao.tipo == "ajuste", Movimentacao.quantidade),
            else_=0,
        )
    )


async def _saldos_por_produto(db: AsyncSession, *, tenant_id: UUID) -> dict[UUID, float]:
    """Saldo atual de cada produto do tenant, numa única query agregada —
    mesmo princípio de estoque.service.saldo_geral(), reaproveitado aqui em
    vez de importado porque a forma de uso é ligeiramente diferente (dict
    indexado por produto_id, não lista ordenada por nome)."""
    stmt = (
        select(Movimentacao.produto_id, _saldo_expr().label("saldo"))
        .where(Movimentacao.tenant_id == tenant_id)
        .group_by(Movimentacao.produto_id)
    )
    linhas = (await db.execute(stmt)).all()
    return {produto_id: float(saldo or 0) for produto_id, saldo in linhas}


async def _kpis(db: AsyncSession, *, tenant_id: UUID, saldos: dict[UUID, float]) -> KpisPainelOut:
    hoje = date.today()
    inicio_mes = hoje.replace(day=1)

    produtos = (
        await db.execute(
            select(Produto.id, Produto.custo_medio).where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True))
        )
    ).all()
    valor_total_estoque = sum(saldos.get(produto_id, 0.0) * float(custo_medio) for produto_id, custo_medio in produtos)
    produtos_cadastrados = len(produtos)

    entradas_saidas = (
        await db.execute(
            select(
                func.coalesce(func.sum(case((Movimentacao.tipo == "entrada", Movimentacao.quantidade), else_=0)), 0),
                func.coalesce(func.sum(case((Movimentacao.tipo == "saida", Movimentacao.quantidade), else_=0)), 0),
            ).where(Movimentacao.tenant_id == tenant_id, Movimentacao.criado_em >= inicio_mes)
        )
    ).one()
    entradas_mes, saidas_mes = float(entradas_saidas[0]), float(entradas_saidas[1])

    faturamento_mes = (
        await db.execute(
            select(func.coalesce(func.sum(Venda.valor_total), 0)).where(
                Venda.tenant_id == tenant_id, Venda.status == "finalizada", Venda.finalizado_em >= inicio_mes
            )
        )
    ).scalar_one()

    return KpisPainelOut(
        valor_total_estoque=round(valor_total_estoque, 2),
        produtos_cadastrados=produtos_cadastrados,
        entradas_mes=entradas_mes,
        saidas_mes=saidas_mes,
        faturamento_mes=round(float(faturamento_mes), 2),
    )


async def _movimentacoes_periodo(db: AsyncSession, *, tenant_id: UUID, dias: int) -> list[PontoMovimentacaoOut]:
    inicio = date.today() - timedelta(days=dias - 1)
    dia_expr = func.date(Movimentacao.criado_em)
    stmt = (
        select(
            dia_expr.label("dia"),
            func.coalesce(func.sum(case((Movimentacao.tipo == "entrada", Movimentacao.quantidade), else_=0)), 0),
            func.coalesce(func.sum(case((Movimentacao.tipo == "saida", Movimentacao.quantidade), else_=0)), 0),
        )
        .where(Movimentacao.tenant_id == tenant_id, Movimentacao.criado_em >= inicio)
        .group_by(dia_expr)
    )
    linhas = {dia: (float(entradas), float(saidas)) for dia, entradas, saidas in (await db.execute(stmt)).all()}

    # Preenche todos os dias do período, mesmo os sem movimentação — o
    # gráfico do frontend espera uma série contínua, não só os dias com dado.
    pontos = []
    for i in range(dias):
        dia = inicio + timedelta(days=i)
        entradas, saidas = linhas.get(dia, (0.0, 0.0))
        pontos.append(PontoMovimentacaoOut(data=dia, entradas=entradas, saidas=saidas))
    return pontos


async def _giro_estoque_top5(db: AsyncSession, *, tenant_id: UUID, saldos: dict[UUID, float]) -> list[ProdutoGiroOut]:
    inicio_janela = datetime.utcnow() - timedelta(days=DIAS_JANELA_GIRO)
    stmt_saidas = (
        select(Movimentacao.produto_id, func.sum(Movimentacao.quantidade))
        .where(
            Movimentacao.tenant_id == tenant_id, Movimentacao.tipo == "saida", Movimentacao.criado_em >= inicio_janela,
        )
        .group_by(Movimentacao.produto_id)
    )
    saidas_30d = {produto_id: float(qtd) for produto_id, qtd in (await db.execute(stmt_saidas)).all()}

    produtos = (
        await db.execute(select(Produto.id, Produto.nome).where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True)))
    ).all()

    candidatos = []
    for produto_id, nome in produtos:
        saldo = saldos.get(produto_id, 0.0)
        saida_total = saidas_30d.get(produto_id, 0.0)
        if saldo <= 0 or saida_total <= 0:
            continue  # sem saída na janela = giro indefinido, não entra no "mais rápido"
        media_diaria = saida_total / DIAS_JANELA_GIRO
        giro_dias = saldo / media_diaria
        candidatos.append(ProdutoGiroOut(produto_id=produto_id, nome=nome, giro_dias=round(giro_dias, 1), saldo_atual=saldo))

    candidatos.sort(key=lambda c: c.giro_dias)
    return candidatos[:5]


async def _estoque_por_categoria(db: AsyncSession, *, tenant_id: UUID) -> list[CategoriaResumoOut]:
    stmt = (
        select(Categoria.id, Categoria.nome, func.count(Produto.id))
        .select_from(Produto)
        .join(Categoria, Categoria.id == Produto.categoria_id, isouter=True)
        .where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True))
        .group_by(Categoria.id, Categoria.nome)
    )
    linhas = (await db.execute(stmt)).all()
    total = sum(qtd for _, _, qtd in linhas) or 1

    resultado = [
        CategoriaResumoOut(
            categoria_id=categoria_id, nome=nome or "Sem categoria", produtos=qtd, percentual=round(qtd / total * 100, 1)
        )
        for categoria_id, nome, qtd in linhas
    ]
    resultado.sort(key=lambda c: c.produtos, reverse=True)
    return resultado


async def _estoque_critico(db: AsyncSession, *, tenant_id: UUID, saldos: dict[UUID, float]) -> list[ProdutoCriticoOut]:
    stmt = (
        select(Produto.id, Produto.nome, Produto.estoque_minimo, Categoria.nome)
        .select_from(Produto)
        .join(Categoria, Categoria.id == Produto.categoria_id, isouter=True)
        .where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True), Produto.estoque_minimo > 0)
    )
    linhas = (await db.execute(stmt)).all()

    criticos = []
    for produto_id, nome, estoque_minimo, categoria_nome in linhas:
        saldo = saldos.get(produto_id, 0.0)
        minimo = float(estoque_minimo)
        if saldo >= minimo:
            continue
        nivel = "critico" if saldo < minimo * 0.5 else "baixo"
        criticos.append(
            ProdutoCriticoOut(
                produto_id=produto_id, nome=nome, categoria_nome=categoria_nome,
                saldo_atual=saldo, estoque_minimo=minimo, nivel=nivel,
            )
        )
    # Mais crítico primeiro: menor razão saldo/mínimo primeiro.
    criticos.sort(key=lambda c: (c.saldo_atual / c.estoque_minimo) if c.estoque_minimo else 0)
    return criticos[:10]


async def _ultimas_movimentacoes(db: AsyncSession, *, tenant_id: UUID, limite: int = 8) -> list[MovimentacaoRecenteOut]:
    stmt = (
        select(Movimentacao, Produto.nome)
        .join(Produto, Produto.id == Movimentacao.produto_id)
        .where(Movimentacao.tenant_id == tenant_id)
        .order_by(Movimentacao.criado_em.desc())
        .limit(limite)
    )
    linhas = (await db.execute(stmt)).all()
    return [
        MovimentacaoRecenteOut(
            id=mov.id, tipo=mov.tipo, produto_nome=nome, quantidade=float(mov.quantidade),
            origem=mov.origem, criado_em=mov.criado_em,
        )
        for mov, nome in linhas
    ]


async def _alertas_resumo(db: AsyncSession, *, tenant_id: UUID) -> AlertasResumoOut:
    stmt = (
        select(AlertaGerado.tipo, func.count(AlertaGerado.id))
        .where(AlertaGerado.tenant_id == tenant_id, AlertaGerado.lido.is_(False))
        .group_by(AlertaGerado.tipo)
    )
    contagens = dict((await db.execute(stmt)).all())

    pedidos_em_aberto = (
        await db.execute(
            select(func.count(PedidoCompra.id)).where(
                PedidoCompra.tenant_id == tenant_id, PedidoCompra.status.in_(PEDIDOS_EM_ABERTO)
            )
        )
    ).scalar_one()

    return AlertasResumoOut(
        total_ativos=sum(contagens.values()),
        estoque_baixo=contagens.get("estoque_baixo", 0),
        validade=contagens.get("validade", 0),
        produto_parado=contagens.get("produto_parado", 0),
        pedidos_em_aberto=pedidos_em_aberto,
    )


async def painel_geral(db: AsyncSession, *, tenant_id: UUID, dias: int = DIAS_PADRAO_GRAFICO) -> PainelGeralOut:
    # Saldo por produto é usado em três blocos diferentes (KPI de valor de
    # estoque, giro e estoque crítico) — calculado uma vez só aqui e passado
    # adiante, em vez de cada função repetir a mesma agregação sobre
    # Movimentacao.
    saldos = await _saldos_por_produto(db, tenant_id=tenant_id)

    return PainelGeralOut(
        kpis=await _kpis(db, tenant_id=tenant_id, saldos=saldos),
        movimentacoes_periodo=await _movimentacoes_periodo(db, tenant_id=tenant_id, dias=dias),
        giro_estoque_top5=await _giro_estoque_top5(db, tenant_id=tenant_id, saldos=saldos),
        estoque_por_categoria=await _estoque_por_categoria(db, tenant_id=tenant_id),
        estoque_critico=await _estoque_critico(db, tenant_id=tenant_id, saldos=saldos),
        ultimas_movimentacoes=await _ultimas_movimentacoes(db, tenant_id=tenant_id),
        alertas=await _alertas_resumo(db, tenant_id=tenant_id),
    )
