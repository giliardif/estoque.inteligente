"""
Etapa 39 — Fluxo de encerramento e aprovação do Inventário.
Etapa 39.1 — Recontagem com limite de 3 tentativas + log de auditoria.

Antes desta etapa, `fechar()` recebia um payload em lote e ajustava o
estoque na hora. Isso foi substituído por um fluxo de duas etapas:

  1) Operador conta item a item (contagem cega — nunca vê qtd_sistema nem
     divergencia) e "envia para análise". Nada toca o estoque real ainda.
  2) Supervisor/admin concilia (vê qtd_sistema vs qtd_contada + impacto
     financeiro), decide item a item, e só ao "aprovar e ajustar estoque
     real" é que as movimentações são gravadas.

A Etapa 39.1 fechou um furo da contagem cega: mostrar a divergência com
sinal/magnitude pro operador (ex: "Perda -3") deixava ele calcular o saldo
do sistema na hora (contagem ± diferença = saldo). Agora:
  - cada tentativa de contagem é logada (InventarioItemTentativa), até 3;
  - o operador nunca recebe o valor da divergência, só um alerta genérico
    de "diverge" com a opção de recontar ou manter;
  - a justificativa (motivo/foto) só é pedida depois que o item já foi
    finalizado como divergente, nunca durante a digitação.

Continua reaproveitando `estoque_service.registrar()` (tipo="ajuste") para
o ajuste real em vez de duplicar a lógica de saldo aqui.
"""
from datetime import datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Categoria, Deposito, Inventario, InventarioItem, InventarioItemTentativa, Produto, User
from app.modules.estoque import service as estoque_service
from app.modules.estoque.schemas import MovimentacaoCreate
from app.modules.inventario.schemas import LIMITE_TENTATIVAS, InventarioItemContagemIn, JustificativaIn

ORDENAVEIS_PAINEL = {
    "ciclo": Inventario.ciclo,
    "status": Inventario.status,
    "criado_em": Inventario.criado_em,
}

STATUS_ITEM_RESOLVIDOS = ("contado", "aprovado")
STATUS_ITEM_CONTAVEIS = ("contado", "divergente", "aprovado", "recontagem_solicitada")


async def abrir(db: AsyncSession, *, tenant_id: UUID, deposito_id: UUID | None, ciclo: str) -> Inventario:
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


async def registrar_contagem_item(
    db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, inventario_id: UUID, produto_id: UUID,
    dados: InventarioItemContagemIn,
) -> InventarioItem:
    inventario = await _obter_inventario_ou_404(db, tenant_id=tenant_id, inventario_id=inventario_id)
    item = await _obter_item_ou_404(db, inventario_id=inventario_id, produto_id=produto_id)

    pode_contar = inventario.status == "aberto" or (
        inventario.status == "em_analise" and item.status_item == "recontagem_solicitada"
    )
    if not pode_contar:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este item não está disponível para contagem no momento.",
        )
    if item.status_item not in ("pendente", "aguardando_confirmacao", "recontagem_solicitada"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este item já foi finalizado — recontagem só é possível se a supervisão solicitar.",
        )

    item.tentativas += 1
    db.add(
        InventarioItemTentativa(
            inventario_item_id=item.id,
            numero_tentativa=item.tentativas,
            qtd_contada=dados.qtd_contada,
            usuario_id=usuario_id,
        )
    )

    divergencia = dados.qtd_contada - float(item.qtd_sistema)
    item.qtd_contada = dados.qtd_contada
    item.divergencia = divergencia

    if divergencia == 0:
        item.status_item = "contado"
    elif item.tentativas >= LIMITE_TENTATIVAS:
        item.status_item = "divergente"
    else:
        item.status_item = "aguardando_confirmacao"

    await db.commit()
    await db.refresh(item)
    return item


async def manter_divergencia(
    db: AsyncSession, *, tenant_id: UUID, inventario_id: UUID, produto_id: UUID
) -> InventarioItem:
    await _obter_inventario_ou_404(db, tenant_id=tenant_id, inventario_id=inventario_id)
    item = await _obter_item_ou_404(db, inventario_id=inventario_id, produto_id=produto_id)
    if item.status_item != "aguardando_confirmacao":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esse item não está aguardando confirmação de divergência.",
        )
    item.status_item = "divergente"
    await db.commit()
    await db.refresh(item)
    return item


async def registrar_justificativa(
    db: AsyncSession, *, tenant_id: UUID, inventario_id: UUID, produto_id: UUID, dados: JustificativaIn
) -> InventarioItem:
    await _obter_inventario_ou_404(db, tenant_id=tenant_id, inventario_id=inventario_id)
    item = await _obter_item_ou_404(db, inventario_id=inventario_id, produto_id=produto_id)
    if item.status_item != "divergente":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Só é possível justificar um item já finalizado como divergente.",
        )
    item.motivo = dados.motivo
    item.anexo_url = dados.anexo_url
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
            "status_item": item.status_item,
            "tentativas": item.tentativas,
            "motivo": item.motivo,
            "anexo_url": item.anexo_url,
        }
        for item, nome, codigo_barras, categoria_nome in linhas
    ]

    total = len(itens)
    contados = sum(1 for i in itens if i["status_item"] not in ("pendente", "aguardando_confirmacao"))
    sem_divergencia = sum(1 for i in itens if i["status_item"] in ("contado", "aprovado"))
    com_divergencia = sum(1 for i in itens if i["status_item"] in ("divergente", "recontagem_solicitada"))
    pendentes = total - contados - sum(1 for i in itens if i["status_item"] == "aguardando_confirmacao")

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
                func.count(InventarioItem.id).filter(InventarioItem.status_item.in_(STATUS_ITEM_CONTAVEIS)),
            ).where(InventarioItem.inventario_id == inventario_id)
        )
    ).one()
    total, contados = contagem

    inventario.status = "em_analise"
    inventario.enviado_por = usuario_id
    inventario.enviado_em = datetime.utcnow()
    await db.commit()
    await db.refresh(inventario)

    return {"inventario": inventario, "itens_contados": contados, "itens_pendentes": total - contados}


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
        if item.status_item in ("divergente", "recontagem_solicitada", "pendente"):
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
                "tentativas": item.tentativas,
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
    if acao == "aprovar":
        if item.status_item != "divergente":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Só itens divergentes podem ter o ajuste aprovado.",
            )
    else:
        # 'pendente' entra aqui de propósito: um item nunca contado pelo
        # operador não tem outro jeito de ser resolvido — sem isso, ele
        # trava o ciclo pra sempre (nem o operador consegue mais contá-lo
        # fora do fluxo de recontagem, nem o supervisor tinha como agir).
        if item.status_item not in ("divergente", "recontagem_solicitada", "pendente"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Esse item não está disponível pra recontagem no momento.",
            )

    if acao == "aprovar":
        item.status_item = "aprovado"
    else:
        item.status_item = "recontagem_solicitada"
        item.tentativas = 0
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
                f"Ainda há {len(pendentes)} item(ns) sem decisão (pendente, aguardando confirmação, "
                "divergente ou aguardando recontagem). Decida todos antes de aprovar o ajuste final."
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


async def obter_detalhe_ciclo(db: AsyncSession, *, tenant_id: UUID, inventario_id: UUID) -> dict:
    base = await obter_conciliacao(db, tenant_id=tenant_id, inventario_id=inventario_id)

    aprovado_por_nome = None
    if base["inventario"].aprovado_por:
        usuario = await db.get(User, base["inventario"].aprovado_por)
        aprovado_por_nome = usuario.nome if usuario else None

    tentativas_stmt = (
        select(InventarioItemTentativa, User.nome, InventarioItem.produto_id)
        .join(InventarioItem, InventarioItem.id == InventarioItemTentativa.inventario_item_id)
        .outerjoin(User, User.id == InventarioItemTentativa.usuario_id)
        .where(InventarioItem.inventario_id == inventario_id)
        .order_by(InventarioItemTentativa.numero_tentativa)
    )
    linhas_tentativas = (await db.execute(tentativas_stmt)).all()

    tentativas_por_produto: dict[UUID, list[dict]] = {}
    for tentativa, usuario_nome, produto_id in linhas_tentativas:
        tentativas_por_produto.setdefault(produto_id, []).append(
            {
                "numero_tentativa": tentativa.numero_tentativa,
                "qtd_contada": tentativa.qtd_contada,
                "usuario_nome": usuario_nome,
                "criado_em": tentativa.criado_em,
            }
        )

    itens_com_log = [
        {**item, "tentativas_log": tentativas_por_produto.get(item["produto_id"], [])} for item in base["itens"]
    ]

    return {
        "inventario": base["inventario"],
        "enviado_por_nome": base["enviado_por_nome"],
        "aprovado_por_nome": aprovado_por_nome,
        "kpis": base["kpis"],
        "itens": itens_com_log,
    }


async def cancelar_ciclo(db: AsyncSession, *, tenant_id: UUID, inventario_id: UUID) -> Inventario:
    """Descarta um ciclo aberto sem contagem — só permitido se NENHUM item
    ainda foi tocado (nenhuma tentativa registrada). Se já existe contagem
    real, o caminho é o fluxo normal (enviar-analise -> aprovar-final), não
    cancelamento — evita perder trabalho por engano."""
    inventario = await _obter_inventario_ou_404(db, tenant_id=tenant_id, inventario_id=inventario_id)
    if inventario.status != "aberto":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Só é possível cancelar um ciclo que ainda está em contagem.",
        )

    itens_contados = (
        await db.execute(
            select(func.count())
            .select_from(InventarioItem)
            .where(InventarioItem.inventario_id == inventario_id, InventarioItem.status_item != "pendente")
        )
    ).scalar_one()
    if itens_contados > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Este ciclo já tem {itens_contados} item(ns) contado(s) — cancelar descartaria essa contagem. "
                "Use 'Concluir Contagem' para enviar para análise em vez de cancelar."
            ),
        )

    inventario.status = "cancelado"
    await db.commit()
    await db.refresh(inventario)
    return inventario


async def contar_notificacoes(db: AsyncSession, *, tenant_id: UUID) -> dict:
    """Contagem leve pro badge do menu — quantos itens estão com recontagem
    solicitada pela supervisão, esperando o operador agir. Somado no
    tenant inteiro (não filtra por depósito — é só um indicador de 'tem
    algo esperando', não um número operacional preciso)."""
    itens_recontagem_pendente = (
        await db.execute(
            select(func.count())
            .select_from(InventarioItem)
            .join(Inventario, Inventario.id == InventarioItem.inventario_id)
            .where(
                Inventario.tenant_id == tenant_id,
                Inventario.status.in_(("aberto", "em_analise")),
                InventarioItem.status_item == "recontagem_solicitada",
            )
        )
    ).scalar_one()
    return {"itens_recontagem_pendente": itens_recontagem_pendente}


async def listar(
    db: AsyncSession, *, tenant_id: UUID, status_filtro: str | None = None, pagina: int = 1, tamanho: int = 25
) -> list[Inventario]:
    stmt = select(Inventario).where(Inventario.tenant_id == tenant_id)
    if status_filtro:
        stmt = stmt.where(Inventario.status == status_filtro)
    stmt = stmt.order_by(Inventario.criado_em.desc()).offset((pagina - 1) * tamanho).limit(tamanho)
    return (await db.execute(stmt)).scalars().all()


async def obter_aberto(db: AsyncSession, *, tenant_id: UUID, deposito_id: UUID | None) -> Inventario | None:
    stmt = select(Inventario).where(
        Inventario.tenant_id == tenant_id,
        Inventario.deposito_id == deposito_id,
        Inventario.status.in_(("aberto", "em_analise")),
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
    qtd_itens_subq = (
        select(func.count(InventarioItem.id))
        .where(InventarioItem.inventario_id == Inventario.id, InventarioItem.status_item.in_(STATUS_ITEM_CONTAVEIS))
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
