"""
Recebimento de pedido de compra gera ENTRADA de estoque automaticamente,
reaproveitando estoque.service.registrar() — quinto módulo a seguir esse
mesmo princípio (depois de Inventário, Venda, Notas Fiscais e Alertas).

Sugestão de reposição: regra simples e auditável (sem "IA" nesta fase) —
sugere repor até o estoque_maximo quando o saldo está abaixo do mínimo.
Documentado como ponto de evolução futura (Fase 3 do escopo: previsão com
sazonalidade), mas a versão atual já é útil e 100% explicável ao usuário.
"""
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Fornecedor, PedidoCompra, PedidoCompraItem, Produto
from app.modules.compras.schemas import PedidoCompraCreate, ReceberItemInput
from app.modules.estoque import service as estoque_service
from app.modules.estoque.schemas import MovimentacaoCreate

ORDENAVEIS_PAINEL = {
    "status": PedidoCompra.status,
    "criado_em": PedidoCompra.criado_em,
}
PEDIDOS_EM_ABERTO = ("rascunho", "recebido_parcial")


async def criar_pedido(db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, dados: PedidoCompraCreate) -> PedidoCompra:
    for item in dados.itens:
        produto = await db.get(Produto, item.produto_id)
        if not produto or produto.tenant_id != tenant_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Produto {item.produto_id} não encontrado."
            )

    pedido = PedidoCompra(tenant_id=tenant_id, fornecedor_id=dados.fornecedor_id, usuario_id=usuario_id, status="rascunho")
    db.add(pedido)
    await db.flush()

    for item in dados.itens:
        db.add(
            PedidoCompraItem(
                tenant_id=tenant_id, pedido_id=pedido.id, produto_id=item.produto_id,
                quantidade=item.quantidade, custo_unitario=item.custo_unitario,
            )
        )

    await db.commit()

    # Recarrega com itens já carregados (selectinload) — ver nota em obter().
    return await obter(db, tenant_id=tenant_id, pedido_id=pedido.id)


async def obter(db: AsyncSession, *, tenant_id: UUID, pedido_id: UUID) -> PedidoCompra | None:
    # selectinload(PedidoCompra.itens) é obrigatório aqui: o schema de resposta
    # (PedidoCompraOut) inclui `itens`, e relacionamentos lazy não podem ser
    # acessados depois que a função async retorna — quebra com MissingGreenlet
    # durante a serialização. Mesmo princípio aplicado em vendas/service.py.
    stmt = (
        select(PedidoCompra)
        .where(PedidoCompra.id == pedido_id, PedidoCompra.tenant_id == tenant_id)
        .options(selectinload(PedidoCompra.itens))
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def listar(db: AsyncSession, *, tenant_id: UUID):
    stmt = (
        select(PedidoCompra)
        .where(PedidoCompra.tenant_id == tenant_id)
        .options(selectinload(PedidoCompra.itens))
        .order_by(PedidoCompra.criado_em.desc())
    )
    return (await db.execute(stmt)).scalars().all()


async def receber_item(
    db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, pedido_id: UUID, dados: ReceberItemInput
) -> PedidoCompraItem:
    pedido = await obter(db, tenant_id=tenant_id, pedido_id=pedido_id)
    if not pedido:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")
    if pedido.status == "cancelado":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Pedido cancelado não pode receber itens.")

    item = await db.get(PedidoCompraItem, dados.item_id)
    if not item or item.tenant_id != tenant_id or item.pedido_id != pedido_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item do pedido não encontrado.")

    restante = item.quantidade - item.quantidade_recebida
    if dados.quantidade_recebida > restante:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Quantidade recebida ({dados.quantidade_recebida}) maior que o restante do pedido ({restante}).",
        )

    # Colunas Numeric do Postgres chegam como decimal.Decimal via SQLAlchemy;
    # dados.quantidade_recebida é float (vindo do Pydantic). Python não permite
    # aritmética direta entre Decimal e float (`+=` levanta TypeError) — só
    # comparação (>, <) funciona sem conversão. Por isso o cast explícito aqui.
    item.quantidade_recebida = float(item.quantidade_recebida) + dados.quantidade_recebida

    await estoque_service.registrar(
        db, tenant_id=tenant_id, usuario_id=usuario_id,
        dados=MovimentacaoCreate(
            produto_id=item.produto_id, tipo="entrada", quantidade=dados.quantidade_recebida,
            referencia_externa=f"Recebimento pedido {pedido_id}",
        ),
    )

    # Atualiza status do pedido conforme o total recebido de todos os itens
    itens_pedido = (
        await db.execute(select(PedidoCompraItem).where(PedidoCompraItem.pedido_id == pedido_id))
    ).scalars().all()
    todos_completos = all(i.quantidade_recebida >= i.quantidade for i in itens_pedido)
    algum_recebido = any(i.quantidade_recebida > 0 for i in itens_pedido)
    pedido.status = "recebido" if todos_completos else ("recebido_parcial" if algum_recebido else pedido.status)

    await db.commit()
    await db.refresh(item)
    return item


async def painel(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    status_filtro: str | None = None,
    fornecedor_id: UUID | None = None,
    busca: str | None = None,
    ordenar_por: str = "criado_em",
    direcao: str = "desc",
    pagina: int = 1,
    tamanho: int = 25,
) -> dict:
    """
    Alimenta a tela de Compras com o kit de UX. Mantido separado de
    listar()/GET /compras/pedidos (usado como listagem crua) — mesmo padrão
    já usado em /estoque/painel, /produtos/painel, /vendas/painel e
    /notas-fiscais/painel.
    """
    valor_total_subq = (
        select(func.coalesce(func.sum(PedidoCompraItem.quantidade * PedidoCompraItem.custo_unitario), 0))
        .where(PedidoCompraItem.pedido_id == PedidoCompra.id)
        .correlate(PedidoCompra)
        .scalar_subquery()
    )
    qtd_itens_subq = (
        select(func.count(PedidoCompraItem.id))
        .where(PedidoCompraItem.pedido_id == PedidoCompra.id)
        .correlate(PedidoCompra)
        .scalar_subquery()
    )
    pendente_subq = (
        select(func.coalesce(func.sum(PedidoCompraItem.quantidade - PedidoCompraItem.quantidade_recebida), 0))
        .where(PedidoCompraItem.pedido_id == PedidoCompra.id)
        .correlate(PedidoCompra)
        .scalar_subquery()
    )

    stmt = (
        select(PedidoCompra, Fornecedor.nome, valor_total_subq, qtd_itens_subq, pendente_subq)
        .outerjoin(Fornecedor, Fornecedor.id == PedidoCompra.fornecedor_id)
        .where(PedidoCompra.tenant_id == tenant_id)
    )
    if status_filtro:
        stmt = stmt.where(PedidoCompra.status == status_filtro)
    if fornecedor_id:
        stmt = stmt.where(PedidoCompra.fornecedor_id == fornecedor_id)
    if busca:
        stmt = stmt.where(Fornecedor.nome.ilike(f"%{busca}%"))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    coluna = ORDENAVEIS_PAINEL.get(ordenar_por, PedidoCompra.criado_em)
    stmt = stmt.order_by(coluna.desc() if direcao == "desc" else coluna.asc())
    stmt = stmt.offset((pagina - 1) * tamanho).limit(tamanho)

    linhas = (await db.execute(stmt)).all()
    itens = [
        {
            "id": pedido.id,
            "status": pedido.status,
            "fornecedor_nome": fornecedor_nome,
            "valor_total": float(valor_total),
            "qtd_itens": qtd_itens,
            "quantidade_pendente": float(pendente),
            "criado_em": pedido.criado_em,
        }
        for pedido, fornecedor_nome, valor_total, qtd_itens, pendente in linhas
    ]

    # KPIs sempre sobre o total do tenant, sem aplicar busca/status_filtro —
    # mesmo princípio já usado nos demais paineis com kit de UX.
    total_pedidos = (
        await db.execute(select(func.count()).select_from(PedidoCompra).where(PedidoCompra.tenant_id == tenant_id))
    ).scalar_one()
    pedidos_em_aberto = (
        await db.execute(
            select(func.count())
            .select_from(PedidoCompra)
            .where(PedidoCompra.tenant_id == tenant_id, PedidoCompra.status.in_(PEDIDOS_EM_ABERTO))
        )
    ).scalar_one()
    valor_total_pedidos = (
        await db.execute(
            select(func.coalesce(func.sum(PedidoCompraItem.quantidade * PedidoCompraItem.custo_unitario), 0)).where(
                PedidoCompraItem.tenant_id == tenant_id
            )
        )
    ).scalar_one()
    fornecedores_distintos = (
        await db.execute(
            select(func.count(func.distinct(PedidoCompra.fornecedor_id))).where(PedidoCompra.tenant_id == tenant_id)
        )
    ).scalar_one()

    fornecedores = (
        await db.execute(
            select(Fornecedor.id, Fornecedor.nome).where(Fornecedor.tenant_id == tenant_id).order_by(Fornecedor.nome)
        )
    ).all()

    return {
        "kpis": {
            "total_pedidos": total_pedidos,
            "pedidos_em_aberto": pedidos_em_aberto,
            "valor_total_pedidos": float(valor_total_pedidos),
            "fornecedores_distintos": fornecedores_distintos,
        },
        "filtros": {"fornecedores": [{"id": i, "nome": n} for i, n in fornecedores]},
        "itens": itens,
        "total": total,
        "pagina": pagina,
        "tamanho": tamanho,
    }


async def sugestao_reposicao(db: AsyncSession, *, tenant_id: UUID) -> list[dict]:
    produtos = (
        await db.execute(select(Produto).where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True)))
    ).scalars().all()

    sugestoes = []
    for produto in produtos:
        saldo = await estoque_service.calcular_saldo_atual(db, tenant_id=tenant_id, produto_id=produto.id)
        if saldo >= produto.estoque_minimo:
            continue
        alvo = float(produto.estoque_maximo) if produto.estoque_maximo else float(produto.estoque_minimo) * 2
        sugestoes.append(
            {
                "produto_id": produto.id,
                "produto_nome": produto.nome,
                "saldo_atual": saldo,
                "estoque_minimo": produto.estoque_minimo,
                "quantidade_sugerida": max(alvo - saldo, 0),
            }
        )
    return sugestoes
