"""
Etapa 39 — Fluxo de encerramento e aprovação do Inventário.

Antes desta etapa, `fechar()` recebia um payload em lote e ajustava o
estoque na hora. Isso foi substituído por um fluxo de duas etapas:

  1) Operador conta item a item (contagem cega — nunca vê qtd_sistema) e
     "envia para análise". Nada toca o estoque real ainda.
  2) Supervisor/admin concilia (vê qtd_sistema vs qtd_contada + impacto
     financeiro), decide item a item, e só ao "aprovar e ajustar estoque
     real" é que as movimentações são gravadas.

Continua reaproveitando `estoque.service.registrar()` para as movimentações
de ajuste (tipo="ajuste") em vez de duplicar a lógica de saldo aqui — mesmo
princípio arquitetural de sempre.
"""
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Categoria, Deposito, Inventario, InventarioItem, Produto, User
from app.modules.estoque import service as estoque_service
from app.modules.estoque.schemas import MovimentacaoCreate
from app.modules.inventario.schemas import InventarioItemContagemIn

ORDENAVEIS_PAINEL = {
    "ciclo": Inventario.ciclo,
    "status": Inventario.status,
    "criado_em": Inventario.criado_em,
}

# Estados de item que significam "decisão já tomada, não bloqueia aprovação final"
STATUS_ITEM_RESOLVIDOS = ("contado", "aprovado")


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

    # Pré-popula um InventarioItem "pendente" por produto ativo do tenant,
    # com qtd_sistema e custo_unitario já congelados no momento da abertura
    # (situação "anterior" para a conciliação). Isso é o que permite a tela
    # do operador mostrar "45/100 itens" e os filtros Pendente/Contados
    # como consulta direta, em vez de derivar isso do catálogo no frontend.
    produtos = (
        await db.execute(select(Produto).where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True)))
    ).scalars().all()

    for produto in produtos:
        if deposito_id:
            saldo = await estoque_service.calcular_saldo_por_deposito(
                db, tenant_id=tenant_id, produto_id=produto.id, deposito_id=deposito_id
            )
        else:
            saldo = await estoque_service.calcular_saldo_atual(db, tenant_id=tenant_id, produto_id=produto.id)
        db.add(
            InventarioItem(
                inventario_id=inventario.id,
                produto_id=produto.id,
                qtd_sistema=saldo,
                custo_unitario=produto.custo_medio,
                status_item="pendente",
            )
        )

    await db.commit()
    return inventario


async def _obter_inventario_ou_404(db: AsyncSession, *, tenant_id: UUID, inventario_id: UUID) -> Inventario:
    inventario = await db.get(Inventario, inventario_id)
    if not inventario or inventario.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventário não encontrado.")
    return inventario


async def _obter_item_ou_404(db: AsyncSession, *, inventario_id: UUID, produto_id: UUID) -> InventarioItem:
    stmt = select(InventarioItem).where(
        InventarioItem.inventario_id == inventario_id, InventarioItem.produto_id == produto_id
    )
    item = (await db.execute(stmt)).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item não encontrado neste inventário.")
    return item


# --- Etapa A: contagem do operador ------------------------------------------

async def registrar_contagem_item(
    db: AsyncSession, *, tenant_id: UUID, inventario_id: UUID, produto_id: UUID, dados: InventarioItemContagemIn
) -> InventarioItem:
    inventario = await _obter_inventario_ou_404(db, tenant_id=tenant_id, inventario_id=inventario_id)
    item = await _obter_item_ou_404(db, inventario_id=inventario_id, produto_id=produto_id)

    # Contagem só é permitida com o ciclo aberto, OU quando o supervisor
    # pediu recontagem daquele item específico (o ciclo pode estar
    # em_analise enquanto só aquele item volta pro operador).
    pode_contar = inventario.status == "aberto" or (
        inventario.status == "em_analise" and item.status_item == "recontagem_solicitada"
    )
    if not pode_contar:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este item não está disponível para contagem no momento.",
        )

    divergencia = dados.qtd_contada - float(item.qtd_sistema)
    item.qtd_contada = dados.qtd_contada
    item.divergencia = divergencia
    item.motivo = dados.motivo
    item.anexo_url = dados.anexo_url
    item.status_item = "divergente" if divergencia != 0 else "contado"
    # Recontagem resolvida: limpa a decisão anterior do supervisor sobre esse item
    item.decidido_por = None
    item.decidido_em = None

    await db.commit()
    await db.refresh(item)
    return item


async def painel_operador(db: AsyncSession, *, tenant_id: UUID, inventario_id: UUID) -> dict:
    inventario = await _obter_inventario_ou_404(db, tenant_id=tenant_id, inventario_id=inventario_id)

    stmt = (
        select(InventarioItem, Produto.nome, Produto.codigo_barras, Categoria.nome)
        .join(Produto, Produto.id == InventarioItem.produto_id)
        .outerjoin(Categoria, Categoria.id == Produto.categoria_id)
        .where(InventarioItem.inventario_id == inventario_id)
        .order_by(Produto.nome)
    )
    linhas = (await db.execute(stmt)).all()

    itens = [
        {
            "produto_id": item.produto_id,
            "produto_nome": nome,
            "codigo_barras": codigo_barras,
            "categoria_nome": categoria_nome,
            "qtd_contada": item.qtd_contada,
            "divergencia": item.divergencia,
            "status_item": item.status_item,
            "motivo": item.motivo,
            "anexo_url": item.anexo_url,
        }
        for item, nome, codigo_barras, categoria_nome in linhas
    ]

    total = len(itens)
    contados = sum(1 for i in itens if i["status_item"] != "pendente")
    sem_divergencia = sum(1 for i in itens if i["status_item"] in ("contado", "aprovado"))
    com_divergencia = sum(1 for i in itens if i["status_item"] in ("divergente", "recontagem_solicitada"))
    pendentes = total - contados

    return {
        "inventario": inventario,
        "progresso": {
            "total": total,
            "contados": contados,
            "percentual": round((contados / total) * 100, 1) if total else 0.0,
        },
        "resumo": {
            "sem_divergencia": sem_divergencia,
            "com_divergencia": com_divergencia,
            "pendentes": pendentes,
        },
        "itens": itens,
    }


async def enviar_para_analise(db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, inventario_id: UUID) -> dict:
    inventario = await _obter_inventario_ou_404(db, tenant_id=tenant_id, inventario_id=inventario_id)
    if inventario.status != "aberto":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Só é possível enviar para análise um inventário em contagem.",
        )

    contagem = (
        await db.execute(
            select(
                func.count(InventarioItem.id),
                func.count(InventarioItem.id).filter(InventarioItem.status_item == "pendente"),
            ).where(InventarioItem.inventario_id == inventario_id)
        )
    ).one()
    total, pendentes = contagem

    inventario.status = "em_analise"
    inventario.enviado_por = usuario_id
    inventario.enviado_em = datetime.utcnow()
    await db.commit()
    await db.refresh(inventario)

    return {"inventario": inventario, "itens_contados": total - pendentes, "itens_pendentes": pendentes}


# --- Etapa B: conciliação do supervisor -------------------------------------

async def obter_conciliacao(db: AsyncSession, *, tenant_id: UUID, inventario_id: UUID) -> dict:
    inventario = await _obter_inventario_ou_404(db, tenant_id=tenant_id, inventario_id=inventario_id)

    enviado_por_nome = None
    if inventario.enviado_por:
        usuario = await db.get(User, inventario.enviado_por)
        enviado_por_nome = usuario.nome if usuario else None

    stmt = (
        select(InventarioItem, Produto.nome, Produto.codigo_barras, User.nome)
        .join(Produto, Produto.id == InventarioItem.produto_id)
        .outerjoin(User, User.id == InventarioItem.decidido_por)
        .where(InventarioItem.inventario_id == inventario_id)
        .order_by(Produto.nome)
    )
    linhas = (await db.execute(stmt)).all()

    itens = []
    impacto_total = 0.0
    divergentes = 0
    aguardando = 0
    for item, produto_nome, codigo_barras, decidido_por_nome in linhas:
        impacto = None
        if item.divergencia and item.custo_unitario is not None:
            impacto = round(float(item.divergencia) * float(item.custo_unitario), 2)
            impacto_total += impacto
        if item.divergencia and item.divergencia != 0:
            divergentes += 1
        if item.status_item in ("divergente", "recontagem_solicitada"):
            aguardando += 1
        itens.append(
            {
                "produto_id": item.produto_id,
                "produto_nome": produto_nome,
                "codigo_barras": codigo_barras,
                "qtd_anterior": item.qtd_sistema,
                "qtd_contada": item.qtd_contada,
                "divergencia": item.divergencia,
                "impacto_financeiro": impacto,
                "status_item": item.status_item,
                "motivo": item.motivo,
                "anexo_url": item.anexo_url,
                "decidido_por_nome": decidido_por_nome,
                "decidido_em": item.decidido_em,
            }
        )

    return {
        "inventario": inventario,
        "enviado_por_nome": enviado_por_nome,
        "kpis": {
            "itens_divergentes": divergentes,
            "itens_aguardando_decisao": aguardando,
            "impacto_financeiro_total": round(impacto_total, 2),
        },
        "itens": itens,
    }


async def decidir_item(
    db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, inventario_id: UUID, produto_id: UUID, acao: str
) -> InventarioItem:
    inventario = await _obter_inventario_ou_404(db, tenant_id=tenant_id, inventario_id=inventario_id)
    if inventario.status != "em_analise":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Só é possível decidir itens de um inventário em análise.",
        )
    item = await _obter_item_ou_404(db, inventario_id=inventario_id, produto_id=produto_id)
    if item.status_item not in ("divergente", "recontagem_solicitada"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Só itens divergentes podem ser aprovados ou mandados para recontagem.",
        )

    item.status_item = "aprovado" if acao == "aprovar" else "recontagem_solicitada"
    item.decidido_por = usuario_id
    item.decidido_em = datetime.utcnow()
    await db.commit()
    await db.refresh(item)
    return item


async def aprovar_final(db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, inventario_id: UUID) -> dict:
    inventario = await _obter_inventario_ou_404(db, tenant_id=tenant_id, inventario_id=inventario_id)
    if inventario.status != "em_analise":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Só é possível aprovar o ajuste final de um inventário em análise.",
        )

    itens = (
        (await db.execute(select(InventarioItem).where(InventarioItem.inventario_id == inventario_id)))
        .scalars()
        .all()
    )

    pendentes = [i for i in itens if i.status_item not in STATUS_ITEM_RESOLVIDOS]
    if pendentes:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Ainda há {len(pendentes)} item(ns) sem decisão (pendente, divergente ou "
                "aguardando recontagem). Decida todos antes de aprovar o ajuste final."
            ),
        )

    itens_ajustados = 0
    impacto_total = 0.0
    for item in itens:
        if item.divergencia and item.divergencia != 0 and item.status_item == "aprovado":
            await estoque_service.registrar(
                db,
                tenant_id=tenant_id,
                usuario_id=usuario_id,
                dados=MovimentacaoCreate(
                    produto_id=item.produto_id,
                    tipo="ajuste",
                    quantidade=abs(float(item.divergencia)),
                    direcao="positivo" if item.divergencia > 0 else "negativo",
                    origem=f"Ajuste de inventário {inventario.ciclo} — aprovado pela supervisão",
                ),
            )
            itens_ajustados += 1
            if item.custo_unitario is not None:
                impacto_total += float(item.divergencia) * float(item.custo_unitario)

    inventario.status = "fechado"
    inventario.aprovado_por = usuario_id
    inventario.aprovado_em = datetime.utcnow()
    await db.commit()
    await db.refresh(inventario)

    return {
        "inventario": inventario,
        "itens_ajustados": itens_ajustados,
        "impacto_financeiro_total": round(impacto_total, 2),
    }


# --- Listagens gerais (mantidas da Etapa 20) --------------------------------

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
    Alimenta o histórico de ciclos de inventário (não confundir com o
    painel do operador/supervisor dentro de um ciclo específico). Mantido
    separado de listar()/GET /inventario — mesmo padrão já usado em
    /estoque/painel, /compras/painel, /notas-fiscais/painel etc.
    """
    qtd_itens_subq = (
        select(func.count(InventarioItem.id))
        .where(InventarioItem.inventario_id == Inventario.id, InventarioItem.status_item != "pendente")
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
