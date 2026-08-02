"""
Regra: toda query filtra por tenant_id explicitamente, mesmo já havendo RLS
no banco. RLS é a última linha de defesa — o filtro explícito aqui evita
depender só dela e deixa a intenção clara no código (defesa em profundidade).
"""
from uuid import UUID

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Categoria, Produto  # SQLAlchemy model (núcleo genérico)
from app.modules.produtos.schemas import ProdutoCreate, ProdutoUpdate


async def listar(db: AsyncSession, *, tenant_id: UUID, busca: str | None, pagina: int, tamanho: int):
    stmt = select(Produto).where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True))
    if busca:
        # ilike parametrizado — nunca concatenar string em SQL.
        # Busca unificada: nome, sku ou código de barras num só campo,
        # já que na prática o usuário digita qualquer um dos três sem
        # saber (ou se importar) qual é qual.
        termo = f"%{busca}%"
        stmt = stmt.where(
            or_(
                Produto.nome.ilike(termo),
                Produto.sku.ilike(termo),
                Produto.codigo_barras.ilike(termo),
            )
        )
    stmt = stmt.offset((pagina - 1) * tamanho).limit(tamanho)
    result = await db.execute(stmt)
    return result.scalars().all()


async def obter(db: AsyncSession, *, tenant_id: UUID, produto_id: UUID):
    stmt = select(Produto).where(Produto.id == produto_id, Produto.tenant_id == tenant_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def criar(db: AsyncSession, *, tenant_id: UUID, dados: ProdutoCreate):
    produto = Produto(tenant_id=tenant_id, **dados.model_dump())
    db.add(produto)
    await db.commit()
    await db.refresh(produto)
    return produto


async def atualizar(db: AsyncSession, *, tenant_id: UUID, produto_id: UUID, dados: ProdutoUpdate):
    produto = await obter(db, tenant_id=tenant_id, produto_id=produto_id)
    if not produto:
        return None
    for campo, valor in dados.model_dump(exclude_unset=True).items():
        setattr(produto, campo, valor)
    await db.commit()
    await db.refresh(produto)
    return produto


async def desativar(db: AsyncSession, *, tenant_id: UUID, produto_id: UUID) -> bool:
    stmt = (
        update(Produto)
        .where(Produto.id == produto_id, Produto.tenant_id == tenant_id)
        .values(ativo=False)
    )
    result = await db.execute(stmt)
    await db.commit()
    return result.rowcount > 0


ORDENAVEIS_PAINEL = {
    "nome": Produto.nome,
    "sku": Produto.sku,
    "custo_medio": Produto.custo_medio,
    "estoque_minimo": Produto.estoque_minimo,
    "criado_em": Produto.criado_em,
}


async def painel(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    busca: str | None = None,
    categoria_id: UUID | None = None,
    status_ativo: bool | None = True,
    ordenar_por: str = "nome",
    direcao: str = "asc",
    pagina: int = 1,
    tamanho: int = 25,
) -> dict:
    """
    Alimenta a tela de Produtos com o kit de UX (busca, filtro de categoria,
    ordenação de coluna, paginação real). Mantido separado de `listar()`
    (usado por GET /produtos "cru", que 5 outras telas já consomem como
    dropdown de seleção) — mudar o contrato de lá quebraria todas elas.
    """
    stmt = (
        select(
            Produto.id, Produto.nome, Produto.sku, Produto.categoria_id, Categoria.nome.label("categoria_nome"),
            Produto.codigo_barras, Produto.unidade_medida, Produto.custo_medio, Produto.estoque_minimo,
            Produto.estoque_maximo, Produto.ativo, Produto.criado_em,
        )
        .outerjoin(Categoria, Categoria.id == Produto.categoria_id)
        .where(Produto.tenant_id == tenant_id)
    )
    if status_ativo is not None:
        stmt = stmt.where(Produto.ativo.is_(status_ativo))
    if categoria_id:
        stmt = stmt.where(Produto.categoria_id == categoria_id)
    if busca:
        termo = f"%{busca}%"
        stmt = stmt.where(or_(Produto.nome.ilike(termo), Produto.sku.ilike(termo), Produto.codigo_barras.ilike(termo)))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    coluna = ORDENAVEIS_PAINEL.get(ordenar_por, Produto.nome)
    stmt = stmt.order_by(coluna.desc() if direcao == "desc" else coluna.asc())
    stmt = stmt.offset((pagina - 1) * tamanho).limit(tamanho)

    linhas = (await db.execute(stmt)).all()
    itens = [
        {
            "id": row.id, "nome": row.nome, "sku": row.sku, "categoria_id": row.categoria_id,
            "categoria_nome": row.categoria_nome, "codigo_barras": row.codigo_barras,
            "unidade_medida": row.unidade_medida, "custo_medio": float(row.custo_medio),
            "estoque_minimo": float(row.estoque_minimo),
            "estoque_maximo": float(row.estoque_maximo) if row.estoque_maximo is not None else None,
            "ativo": row.ativo, "criado_em": row.criado_em,
        }
        for row in linhas
    ]

    categorias = (
        await db.execute(select(Categoria.id, Categoria.nome).where(Categoria.tenant_id == tenant_id).order_by(Categoria.nome))
    ).all()

    return {
        "itens": itens,
        "filtros": {"categorias": [{"id": i, "nome": n} for i, n in categorias]},
        "total": total, "pagina": pagina, "tamanho": tamanho,
    }
