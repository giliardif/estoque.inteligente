"""
Venda finalizada = baixa automática de estoque, um item por vez, reaproveitando
estoque.service.registrar() (mesma regra de saldo nunca-negativo se aplica aqui).

Limitação conhecida (documentada, não escondida): como cada movimentação faz
seu próprio commit, uma venda com múltiplos itens não é 100% atômica se o
processo cair no meio. Mitigado validando o saldo de TODOS os itens antes de
registrar qualquer movimentação — reduz a janela de risco a quase zero, mas
não elimina falha catastrófica no meio da gravação. Ação futura: mover
`estoque.service.registrar` para aceitar uma sessão sem commit interno e
commitar só uma vez no fim da venda inteira.
"""
from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Produto, Venda, VendaItem
from app.modules.estoque import service as estoque_service
from app.modules.estoque.schemas import MovimentacaoCreate
from app.modules.vendas.schemas import VendaCreate

# Colunas ordenáveis no painel — mesmo padrão de app/modules/produtos/service.py
ORDENAVEIS_PAINEL = {
    "criado_em": Venda.criado_em,
    "valor_total": Venda.valor_total,
}


async def finalizar(db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, dados: VendaCreate) -> Venda:
    # 1) validação prévia: todo item precisa existir e ter saldo suficiente
    for item in dados.itens:
        produto = await db.get(Produto, item.produto_id)
        if not produto or produto.tenant_id != tenant_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Produto {item.produto_id} não encontrado."
            )
        saldo = await estoque_service.calcular_saldo_atual(db, tenant_id=tenant_id, produto_id=item.produto_id)
        if saldo < item.quantidade:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Saldo insuficiente para {produto.nome}. Disponível: {saldo}, solicitado: {item.quantidade}.",
            )

    # 2) cria a venda e os itens
    #
    # BUG REAL corrigido na Etapa 16: `finalizado_em` existe no modelo desde
    # sempre mas nunca era preenchido aqui — toda venda finalizada ficava com
    # esse campo None para sempre. Passou despercebido porque nada exibia ou
    # validava esse campo até o painel (Etapa 16) precisar dele.
    valor_total = sum(item.quantidade * item.preco_unitario for item in dados.itens)
    venda = Venda(
        tenant_id=tenant_id, status="finalizada", valor_total=valor_total, usuario_id=usuario_id,
        finalizado_em=datetime.now(timezone.utc),
    )
    db.add(venda)
    await db.flush()

    for item in dados.itens:
        db.add(
            VendaItem(
                tenant_id=tenant_id, venda_id=venda.id, produto_id=item.produto_id,
                quantidade=item.quantidade, preco_unitario=item.preco_unitario,
            )
        )

    await db.commit()

    # 3) baixa de estoque — uma movimentação de saída por item, já validada acima
    for item in dados.itens:
        await estoque_service.registrar(
            db, tenant_id=tenant_id, usuario_id=usuario_id,
            dados=MovimentacaoCreate(
                produto_id=item.produto_id, tipo="saida", quantidade=item.quantidade,
                origem="Venda / PDV", referencia_externa=f"Venda {venda.id}",
            ),
        )

    # Carrega venda.itens explicitamente (selectinload) antes de retornar.
    # SEM isso, o Pydantic tenta acessar venda.itens durante a serialização da
    # resposta — fora do contexto assíncrono do SQLAlchemy — e quebra com
    # "MissingGreenlet". Relacionamentos lazy nunca podem ser acessados após
    # a função async terminar; sempre carregar explicitamente antes de retornar.
    venda_completa = await obter(db, tenant_id=tenant_id, venda_id=venda.id)
    return venda_completa


async def obter(db: AsyncSession, *, tenant_id: UUID, venda_id: UUID) -> Venda | None:
    stmt = (
        select(Venda)
        .where(Venda.id == venda_id, Venda.tenant_id == tenant_id)
        .options(selectinload(Venda.itens))
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def listar(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    data_inicio: date | None = None,
    data_fim: date | None = None,
    pagina: int = 1,
    tamanho: int = 25,
) -> list[Venda]:
    # tenant_id sempre no WHERE mesmo com RLS ativo (defesa em profundidade,
    # mesmo padrão usado em produtos.service.listar) — nunca confiar só na
    # sessão/RLS para o filtro de isolamento.
    stmt = select(Venda).where(Venda.tenant_id == tenant_id).options(selectinload(Venda.itens))

    if data_inicio:
        stmt = stmt.where(Venda.criado_em >= datetime.combine(data_inicio, time.min, tzinfo=timezone.utc))
    if data_fim:
        # fim do dia inclusive — filtro por >= início e <= fim do mesmo dia
        stmt = stmt.where(Venda.criado_em <= datetime.combine(data_fim, time.max, tzinfo=timezone.utc))

    stmt = stmt.order_by(Venda.criado_em.desc()).offset((pagina - 1) * tamanho).limit(tamanho)
    return (await db.execute(stmt)).scalars().all()


# --- Painel da tela de Vendas (Etapa 16) ------------------------------------
#
# Endpoint dedicado (GET /vendas/painel), separado do GET /vendas "cru" que já
# é consumido diretamente pela própria tela para o histórico simples — mantido
# por segurança de contrato, mesmo padrão já usado em /produtos/painel e
# /estoque/painel. KPIs refletem sempre "hoje" (resumo fixo, não afetado pelos
# filtros de período/status da grade abaixo) — mesmo princípio do painel de
# Estoque: um resumo estável para orientação rápida, filtros servem só para
# explorar o histórico.

async def painel(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    data_inicio: date | None = None,
    data_fim: date | None = None,
    status_venda: str | None = None,
    busca: str | None = None,
    ordenar_por: str = "criado_em",
    direcao: str = "desc",
    pagina: int = 1,
    tamanho: int = 25,
) -> dict:
    # --- KPIs de hoje (fixos, independentes dos filtros da grade) ----------
    inicio_hoje = datetime.combine(date.today(), time.min, tzinfo=timezone.utc)
    fim_hoje = datetime.combine(date.today(), time.max, tzinfo=timezone.utc)
    stmt_kpi_hoje = select(
        func.count(Venda.id), func.coalesce(func.sum(Venda.valor_total), 0)
    ).where(
        Venda.tenant_id == tenant_id, Venda.status == "finalizada",
        Venda.criado_em >= inicio_hoje, Venda.criado_em <= fim_hoje,
    )
    vendas_hoje, faturamento_hoje = (await db.execute(stmt_kpi_hoje)).one()
    vendas_hoje = int(vendas_hoje)
    faturamento_hoje = float(faturamento_hoje)
    ticket_medio_hoje = round(faturamento_hoje / vendas_hoje, 2) if vendas_hoje > 0 else 0.0

    stmt_canceladas = select(func.count(Venda.id)).where(
        Venda.tenant_id == tenant_id, Venda.status == "cancelada"
    )
    vendas_canceladas_total = int((await db.execute(stmt_canceladas)).scalar_one())

    kpis = {
        "vendas_hoje": vendas_hoje,
        "faturamento_hoje": faturamento_hoje,
        "ticket_medio_hoje": ticket_medio_hoje,
        "vendas_canceladas_total": vendas_canceladas_total,
    }

    # --- Grade filtrada/ordenada/paginada -----------------------------------
    subq_qtd = (
        select(VendaItem.venda_id, func.count(VendaItem.id).label("qtd_itens"))
        .where(VendaItem.tenant_id == tenant_id)
        .group_by(VendaItem.venda_id)
        .subquery()
    )
    stmt = (
        select(
            Venda.id, Venda.status, Venda.valor_total, Venda.criado_em, Venda.finalizado_em,
            func.coalesce(subq_qtd.c.qtd_itens, 0).label("qtd_itens"),
        )
        .outerjoin(subq_qtd, subq_qtd.c.venda_id == Venda.id)
        .where(Venda.tenant_id == tenant_id)
    )
    if data_inicio:
        stmt = stmt.where(Venda.criado_em >= datetime.combine(data_inicio, time.min, tzinfo=timezone.utc))
    if data_fim:
        stmt = stmt.where(Venda.criado_em <= datetime.combine(data_fim, time.max, tzinfo=timezone.utc))
    if status_venda:
        stmt = stmt.where(Venda.status == status_venda)
    if busca:
        # busca por nome de produto dentro dos itens da venda — tenant_id
        # sempre no WHERE da subquery também (defesa em profundidade / RLS)
        termo = f"%{busca}%"
        subq_match = (
            select(VendaItem.venda_id)
            .join(Produto, Produto.id == VendaItem.produto_id)
            .where(VendaItem.tenant_id == tenant_id, or_(Produto.nome.ilike(termo), Produto.sku.ilike(termo)))
        )
        stmt = stmt.where(Venda.id.in_(subq_match))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    coluna = ORDENAVEIS_PAINEL.get(ordenar_por, Venda.criado_em)
    stmt = stmt.order_by(coluna.desc() if direcao == "desc" else coluna.asc())
    stmt = stmt.offset((pagina - 1) * tamanho).limit(tamanho)

    linhas = (await db.execute(stmt)).all()
    itens = [
        {
            "id": row.id, "status": row.status, "valor_total": float(row.valor_total),
            "qtd_itens": int(row.qtd_itens), "criado_em": row.criado_em, "finalizado_em": row.finalizado_em,
        }
        for row in linhas
    ]

    return {"itens": itens, "kpis": kpis, "total": total, "pagina": pagina, "tamanho": tamanho}


# --- Mais vendidos (Etapa 35 — redesign do PDV) -----------------------------

async def mais_vendidos(db: AsyncSession, *, tenant_id: UUID, dias: int = 30, limite: int = 8) -> list[dict]:
    """Ranking por soma de quantidade vendida (vendas finalizadas) nos últimos
    `dias` dias. Produto sem nenhuma venda no período simplesmente não aparece
    — a tela decide o que mostrar no lugar (ex.: produtos ativos recentes)."""
    inicio_periodo = datetime.now(timezone.utc) - timedelta(days=dias)

    subq_giro = (
        select(
            VendaItem.produto_id,
            func.sum(VendaItem.quantidade).label("quantidade_vendida"),
        )
        .join(Venda, Venda.id == VendaItem.venda_id)
        .where(
            VendaItem.tenant_id == tenant_id,
            Venda.status == "finalizada",
            Venda.criado_em >= inicio_periodo,
        )
        .group_by(VendaItem.produto_id)
        .subquery()
    )

    stmt = (
        select(Produto, subq_giro.c.quantidade_vendida)
        .join(subq_giro, subq_giro.c.produto_id == Produto.id)
        .where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True))
        .order_by(subq_giro.c.quantidade_vendida.desc())
        .limit(limite)
    )

    linhas = (await db.execute(stmt)).all()
    return [
        {
            "produto_id": produto.id,
            "nome": produto.nome,
            "sku": produto.sku,
            "codigo_barras": produto.codigo_barras,
            "preco_venda": produto.preco_venda,
            "custo_medio": produto.custo_medio,
            "unidade_medida": produto.unidade_medida,
            "imagem_url": produto.imagem_url,
            "quantidade_vendida": float(quantidade_vendida),
        }
        for produto, quantidade_vendida in linhas
    ]


async def cancelar(db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, venda_id: UUID) -> Venda:
    """
    Cancelamento estorna o estoque automaticamente: uma "entrada" por item
    vendido, ligada à venda via `referencia_externa` (mesmo padrão de
    rastreabilidade usado em `finalizar`). Só vendas com status "finalizada"
    podem ser canceladas — o modelo já previa esse status desde sempre, mas
    não existia nenhum caminho para chegar nele; esse era um gap real (tela
    de Vendas não tinha nenhuma forma de desfazer uma venda enganada).
    """
    venda = await obter(db, tenant_id=tenant_id, venda_id=venda_id)
    if not venda:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Venda não encontrada.")
    if venda.status != "finalizada":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Somente vendas finalizadas podem ser canceladas (status atual: {venda.status}).",
        )

    for item in venda.itens:
        await estoque_service.registrar(
            db, tenant_id=tenant_id, usuario_id=usuario_id,
            dados=MovimentacaoCreate(
                produto_id=item.produto_id, tipo="entrada", quantidade=float(item.quantidade),
                origem="Cancelamento de venda", referencia_externa=f"Venda {venda.id}",
            ),
        )

    venda.status = "cancelada"
    await db.commit()

    return await obter(db, tenant_id=tenant_id, venda_id=venda.id)
