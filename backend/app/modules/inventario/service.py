"""
Fechar um inventário gera automaticamente movimentações de ajuste para
cada divergência — reaproveitando o mesmo `estoque.service.registrar()`
usado pelo módulo de Estoque, em vez de duplicar a lógica de saldo aqui.
Isso é o princípio da arquitetura modular aplicado na prática: um módulo
novo reaproveita o núcleo em vez de reescrever regra de negócio.
"""
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Deposito, Inventario, InventarioItem, Movimentacao, Produto
from app.modules.estoque import service as estoque_service
from app.modules.estoque.schemas import MovimentacaoCreate
from app.modules.inventario.schemas import InventarioFechar

ORDENAVEIS_PAINEL = {
    "ciclo": Inventario.ciclo,
    "status": Inventario.status,
    "criado_em": Inventario.criado_em,
}


async def abrir(db: AsyncSession, *, tenant_id: UUID, deposito_id: UUID | None, ciclo: str) -> Inventario:
    # Regra: só um inventário "aberto" por depósito por vez, evita duas contagens conflitantes
    stmt = select(Inventario).where(
        Inventario.tenant_id == tenant_id, Inventario.deposito_id == deposito_id, Inventario.status == "aberto"
    )
    existente = (await db.execute(stmt)).scalar_one_or_none()
    if existente:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Já existe um inventário aberto para este depósito.",
        )

    inventario = Inventario(tenant_id=tenant_id, deposito_id=deposito_id, ciclo=ciclo, status="aberto")
    db.add(inventario)
    await db.commit()
    await db.refresh(inventario)
    return inventario


async def fechar(
    db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, inventario_id: UUID, dados: InventarioFechar
) -> Inventario:
    inventario = await db.get(Inventario, inventario_id)
    if not inventario or inventario.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventário não encontrado.")
    if inventario.status == "fechado":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Inventário já está fechado.")

    for item in dados.itens:
        produto = await db.get(Produto, item.produto_id)
        if not produto or produto.tenant_id != tenant_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Produto {item.produto_id} não encontrado."
            )

        saldo_sistema = await estoque_service.calcular_saldo_atual(
            db, tenant_id=tenant_id, produto_id=item.produto_id
        )
        divergencia = item.qtd_contada - saldo_sistema

        db.add(
            InventarioItem(
                inventario_id=inventario_id,
                produto_id=item.produto_id,
                qtd_sistema=saldo_sistema,
                qtd_contada=item.qtd_contada,
                divergencia=divergencia,
            )
        )

        if divergencia != 0:
            await estoque_service.registrar(
                db,
                tenant_id=tenant_id,
                usuario_id=usuario_id,
                dados=MovimentacaoCreate(
                    produto_id=item.produto_id,
                    tipo="ajuste",
                    quantidade=abs(divergencia),
                    direcao="positivo" if divergencia > 0 else "negativo",
                    origem=f"Ajuste automático — fechamento de inventário {inventario.ciclo}",
                ),
            )

    inventario.status = "fechado"
    await db.commit()
    await db.refresh(inventario)
    return inventario


async def listar_itens(db: AsyncSession, *, tenant_id: UUID, inventario_id: UUID):
    inventario = await db.get(Inventario, inventario_id)
    if not inventario or inventario.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventário não encontrado.")
    stmt = select(InventarioItem).where(InventarioItem.inventario_id == inventario_id)
    result = await db.execute(stmt)
    return result.scalars().all()


async def listar(
    db: AsyncSession, *, tenant_id: UUID, status_filtro: str | None = None, pagina: int = 1, tamanho: int = 25
) -> list[Inventario]:
    stmt = select(Inventario).where(Inventario.tenant_id == tenant_id)  # defesa em profundidade além do RLS
    if status_filtro:
        stmt = stmt.where(Inventario.status == status_filtro)
    stmt = stmt.order_by(Inventario.criado_em.desc()).offset((pagina - 1) * tamanho).limit(tamanho)
    return (await db.execute(stmt)).scalars().all()


async def obter_aberto(db: AsyncSession, *, tenant_id: UUID, deposito_id: UUID | None) -> Inventario | None:
    """Usado pelo frontend ao carregar a tela de Inventário, para retomar uma
    contagem em andamento em vez de perdê-la caso a página seja recarregada."""
    stmt = select(Inventario).where(
        Inventario.tenant_id == tenant_id, Inventario.deposito_id == deposito_id, Inventario.status == "aberto"
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def painel(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    status_filtro: str | None = None,
    deposito_id: UUID | None = None,
    busca: str | None = None,
    ordenar_por: str = "criado_em",
    direcao: str = "desc",
    pagina: int = 1,
    tamanho: int = 25,
) -> dict:
    """
    Alimenta a tela de Inventário com o kit de UX. Mantido separado de
    listar()/GET /inventario (usado como listagem crua) — mesmo padrão já
    usado em /estoque/painel, /compras/painel, /notas-fiscais/painel etc.

    IMPORTANTE: InventarioItem não tem tenant_id próprio (gap conhecido no
    backlog) — todo filtro de tenant nas subqueries abaixo passa pelo join
    implícito com Inventario.id, nunca por uma coluna tenant_id direta em
    InventarioItem.
    """
    qtd_itens_subq = (
        select(func.count(InventarioItem.id))
        .where(InventarioItem.inventario_id == Inventario.id)
        .correlate(Inventario)
        .scalar_subquery()
    )
    qtd_divergentes_subq = (
        select(func.count(InventarioItem.id))
        .where(
            InventarioItem.inventario_id == Inventario.id,
            InventarioItem.divergencia.isnot(None),
            InventarioItem.divergencia != 0,
        )
        .correlate(Inventario)
        .scalar_subquery()
    )

    stmt = (
        select(Inventario, Deposito.nome, qtd_itens_subq, qtd_divergentes_subq)
        .outerjoin(Deposito, Deposito.id == Inventario.deposito_id)
        .where(Inventario.tenant_id == tenant_id)
    )
    if status_filtro:
        stmt = stmt.where(Inventario.status == status_filtro)
    if deposito_id:
        stmt = stmt.where(Inventario.deposito_id == deposito_id)
    if busca:
        stmt = stmt.where(Inventario.ciclo.ilike(f"%{busca}%"))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    coluna = ORDENAVEIS_PAINEL.get(ordenar_por, Inventario.criado_em)
    stmt = stmt.order_by(coluna.desc() if direcao == "desc" else coluna.asc())
    stmt = stmt.offset((pagina - 1) * tamanho).limit(tamanho)

    linhas = (await db.execute(stmt)).all()
    itens = [
        {
            "id": inv.id,
            "status": inv.status,
            "ciclo": inv.ciclo,
            "deposito_id": inv.deposito_id,
            "deposito_nome": deposito_nome,
            "qtd_itens_contados": qtd_itens,
            "qtd_divergentes": qtd_divergentes,
            "criado_em": inv.criado_em,
        }
        for inv, deposito_nome, qtd_itens, qtd_divergentes in linhas
    ]

    # KPIs sempre sobre o total do tenant, sem aplicar busca/status_filtro —
    # mesmo princípio já usado nos demais paineis com kit de UX.
    total_inventarios = (
        await db.execute(select(func.count()).select_from(Inventario).where(Inventario.tenant_id == tenant_id))
    ).scalar_one()
    inventarios_abertos = (
        await db.execute(
            select(func.count())
            .select_from(Inventario)
            .where(Inventario.tenant_id == tenant_id, Inventario.status == "aberto")
        )
    ).scalar_one()
    itens_divergentes = (
        await db.execute(
            select(func.count())
            .select_from(InventarioItem)
            .join(Inventario, Inventario.id == InventarioItem.inventario_id)
            .where(
                Inventario.tenant_id == tenant_id,
                InventarioItem.divergencia.isnot(None),
                InventarioItem.divergencia != 0,
            )
        )
    ).scalar_one()
    depositos_distintos = (
        await db.execute(
            select(func.count(func.distinct(Inventario.deposito_id))).where(
                Inventario.tenant_id == tenant_id, Inventario.deposito_id.isnot(None)
            )
        )
    ).scalar_one()

    depositos = (
        await db.execute(select(Deposito.id, Deposito.nome).where(Deposito.tenant_id == tenant_id).order_by(Deposito.nome))
    ).all()

    return {
        "kpis": {
            "total_inventarios": total_inventarios,
            "inventarios_abertos": inventarios_abertos,
            "itens_divergentes": itens_divergentes,
            "depositos_distintos": depositos_distintos,
        },
        "filtros": {"depositos": [{"id": i, "nome": n} for i, n in depositos]},
        "itens": itens,
        "total": total,
        "pagina": pagina,
        "tamanho": tamanho,
    }
