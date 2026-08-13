"""
Fluxo: importar XML -> parsear (parser_xml.py) -> tentar casar cada item
com um produto existente (por código de barras, depois por nome exato) ->
itens reconhecidos geram ENTRADA de estoque automaticamente (reaproveitando
estoque.service.registrar); itens não reconhecidos ficam "pendente_cadastro"
até o operador confirmar manualmente — nunca criamos produto novo sem
confirmação humana, para evitar poluir o cadastro com erros de leitura do XML.
"""
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Fornecedor, NotaFiscal, NotaFiscalItem, Produto
from app.modules.estoque import service as estoque_service
from app.modules.estoque.schemas import MovimentacaoCreate
from app.modules.notas_fiscais.parser_xml import parse_nfe_xml
from app.modules.notas_fiscais.schemas import ConfirmarItemPayload

ORDENAVEIS_PAINEL = {
    "numero": NotaFiscal.numero,
    "status": NotaFiscal.status,
    "criado_em": NotaFiscal.criado_em,
}


async def _buscar_produto_correspondente(db: AsyncSession, *, tenant_id: UUID, codigo_ean: str | None, descricao: str):
    if codigo_ean:
        stmt = select(Produto).where(Produto.tenant_id == tenant_id, Produto.codigo_barras == codigo_ean)
        produto = (await db.execute(stmt)).scalar_one_or_none()
        if produto:
            return produto
    # fallback: nome exato (case-insensitive) — evita falso positivo de match parcial
    stmt = select(Produto).where(Produto.tenant_id == tenant_id, Produto.nome.ilike(descricao))
    return (await db.execute(stmt)).scalar_one_or_none()


async def importar(db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, arquivo: UploadFile) -> NotaFiscal:
    dados = await parse_nfe_xml(arquivo)

    fornecedor = (
        await db.execute(
            select(Fornecedor).where(
                Fornecedor.tenant_id == tenant_id, Fornecedor.documento == dados.fornecedor_documento
            )
        )
    ).scalar_one_or_none()
    if not fornecedor:
        fornecedor = Fornecedor(tenant_id=tenant_id, nome=dados.fornecedor_nome, documento=dados.fornecedor_documento)
        db.add(fornecedor)
        await db.flush()

    nota = NotaFiscal(
        tenant_id=tenant_id,
        numero=dados.numero,
        fornecedor_id=fornecedor.id,
        xml_raw="",  # o XML bruto não é retido após o parsing bem-sucedido — reduz superfície de dados sensíveis armazenados
        status="processada",
    )
    db.add(nota)
    await db.flush()

    for item in dados.itens:
        produto = await _buscar_produto_correspondente(
            db, tenant_id=tenant_id, codigo_ean=item.codigo_ean, descricao=item.descricao
        )
        nota_item = NotaFiscalItem(
            tenant_id=tenant_id,
            nota_id=nota.id,
            descricao_xml=item.descricao,
            codigo_ean_xml=item.codigo_ean,
            produto_id=produto.id if produto else None,
            quantidade=item.quantidade,
            valor_unitario=item.valor_unitario,
            status_match="reconhecido" if produto else "pendente_cadastro",
        )
        db.add(nota_item)

        if produto:
            await estoque_service.registrar(
                db, tenant_id=tenant_id, usuario_id=usuario_id,
                dados=MovimentacaoCreate(
                    produto_id=produto.id, tipo="entrada", quantidade=item.quantidade,
                    referencia_externa=f"NF-e {dados.numero}",
                ),
            )

    await db.commit()
    await db.refresh(nota)
    return nota


async def confirmar_item(
    db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, item_id: UUID, dados: ConfirmarItemPayload
) -> NotaFiscalItem:
    item = await db.get(NotaFiscalItem, item_id)
    if not item or item.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item não encontrado.")
    if item.status_match == "reconhecido":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Item já foi reconhecido anteriormente.")

    if dados.ignorar:
        item.status_match = "ignorado"
    elif dados.produto_id:
        produto = await db.get(Produto, dados.produto_id)
        if not produto or produto.tenant_id != tenant_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Produto informado não encontrado.")
        item.produto_id = produto.id
        item.status_match = "reconhecido"
        await estoque_service.registrar(
            db, tenant_id=tenant_id, usuario_id=usuario_id,
            dados=MovimentacaoCreate(
                produto_id=produto.id, tipo="entrada", quantidade=item.quantidade,
                referencia_externa=f"NF-e (confirmação manual) — item {item.id}",
            ),
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Informe produto_id para vincular, ou ignorar=true para descartar o item.",
        )

    await db.commit()
    await db.refresh(item)
    return item


async def obter(db: AsyncSession, *, tenant_id: UUID, nota_id: UUID) -> NotaFiscal | None:
    nota = await db.get(NotaFiscal, nota_id)
    if not nota or nota.tenant_id != tenant_id:
        return None
    return nota


async def listar_itens(db: AsyncSession, *, tenant_id: UUID, nota_id: UUID):
    stmt = select(NotaFiscalItem).where(NotaFiscalItem.tenant_id == tenant_id, NotaFiscalItem.nota_id == nota_id)
    return (await db.execute(stmt)).scalars().all()


async def listar(
    db: AsyncSession, *, tenant_id: UUID, status_filtro: str | None = None, pagina: int = 1, tamanho: int = 25
) -> list[dict]:
    # Subquery correlacionada em vez de JOIN + GROUP BY: evita duplicar a linha
    # da nota por item e mantém a query simples de ler. Custo aceitável para o
    # volume de notas por página (máx. 100, mesmo teto usado nos outros módulos).
    pendentes_subq = (
        select(func.count(NotaFiscalItem.id))
        .where(NotaFiscalItem.nota_id == NotaFiscal.id, NotaFiscalItem.status_match == "pendente_cadastro")
        .correlate(NotaFiscal)
        .scalar_subquery()
    )

    stmt = (
        select(NotaFiscal, Fornecedor.nome, pendentes_subq)
        .outerjoin(Fornecedor, Fornecedor.id == NotaFiscal.fornecedor_id)
        .where(NotaFiscal.tenant_id == tenant_id)  # defesa em profundidade, além do RLS na sessão
    )
    if status_filtro:
        stmt = stmt.where(NotaFiscal.status == status_filtro)

    stmt = stmt.order_by(NotaFiscal.criado_em.desc()).offset((pagina - 1) * tamanho).limit(tamanho)
    linhas = (await db.execute(stmt)).all()

    return [
        {
            "id": nota.id,
            "numero": nota.numero,
            "status": nota.status,
            "criado_em": nota.criado_em,
            "fornecedor_nome": fornecedor_nome,
            "itens_pendentes": itens_pendentes,
        }
        for nota, fornecedor_nome, itens_pendentes in linhas
    ]


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
    Alimenta a tela de Notas Fiscais com o kit de UX (busca, filtro de status,
    ordenação de coluna, paginação real, KPIs). Mantido separado de `listar()`
    (usado por GET /notas-fiscais "cru") — mesmo padrão já usado em
    /estoque/painel, /produtos/painel e /vendas/painel.
    """
    pendentes_subq = (
        select(func.count(NotaFiscalItem.id))
        .where(NotaFiscalItem.nota_id == NotaFiscal.id, NotaFiscalItem.status_match == "pendente_cadastro")
        .correlate(NotaFiscal)
        .scalar_subquery()
    )

    stmt = (
        select(NotaFiscal, Fornecedor.nome, pendentes_subq)
        .outerjoin(Fornecedor, Fornecedor.id == NotaFiscal.fornecedor_id)
        .where(NotaFiscal.tenant_id == tenant_id)
    )
    if status_filtro:
        stmt = stmt.where(NotaFiscal.status == status_filtro)
    if fornecedor_id:
        stmt = stmt.where(NotaFiscal.fornecedor_id == fornecedor_id)
    if busca:
        termo = f"%{busca}%"
        stmt = stmt.where(or_(NotaFiscal.numero.ilike(termo), Fornecedor.nome.ilike(termo)))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    coluna = ORDENAVEIS_PAINEL.get(ordenar_por, NotaFiscal.criado_em)
    stmt = stmt.order_by(coluna.desc() if direcao == "desc" else coluna.asc())
    stmt = stmt.offset((pagina - 1) * tamanho).limit(tamanho)

    linhas = (await db.execute(stmt)).all()
    itens = [
        {
            "id": nota.id,
            "numero": nota.numero,
            "status": nota.status,
            "criado_em": nota.criado_em,
            "fornecedor_nome": fornecedor_nome,
            "itens_pendentes": itens_pendentes,
        }
        for nota, fornecedor_nome, itens_pendentes in linhas
    ]

    # KPIs sempre sobre o total do tenant, sem aplicar busca/status_filtro —
    # mesmo princípio já usado nos paineis de Estoque/Produtos/Vendas.
    total_notas = (
        await db.execute(select(func.count()).select_from(NotaFiscal).where(NotaFiscal.tenant_id == tenant_id))
    ).scalar_one()
    itens_pendentes_confirmacao = (
        await db.execute(
            select(func.count())
            .select_from(NotaFiscalItem)
            .where(NotaFiscalItem.tenant_id == tenant_id, NotaFiscalItem.status_match == "pendente_cadastro")
        )
    ).scalar_one()
    valor_total_importado = (
        await db.execute(
            select(func.coalesce(func.sum(NotaFiscalItem.quantidade * NotaFiscalItem.valor_unitario), 0)).where(
                NotaFiscalItem.tenant_id == tenant_id, NotaFiscalItem.status_match != "ignorado"
            )
        )
    ).scalar_one()
    fornecedores_distintos = (
        await db.execute(
            select(func.count(func.distinct(NotaFiscal.fornecedor_id))).where(NotaFiscal.tenant_id == tenant_id)
        )
    ).scalar_one()

    fornecedores = (
        await db.execute(
            select(Fornecedor.id, Fornecedor.nome)
            .where(Fornecedor.tenant_id == tenant_id)
            .order_by(Fornecedor.nome)
        )
    ).all()

    return {
        "kpis": {
            "total_notas": total_notas,
            "itens_pendentes_confirmacao": itens_pendentes_confirmacao,
            "valor_total_importado": float(valor_total_importado),
            "fornecedores_distintos": fornecedores_distintos,
        },
        "filtros": {"fornecedores": [{"id": i, "nome": n} for i, n in fornecedores]},
        "itens": itens,
        "total": total,
        "pagina": pagina,
        "tamanho": tamanho,
    }
