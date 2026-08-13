"""
Motor de regras de alertas. Em produção, `executar_motor()` roda via job
agendado (ex: Railway Cron ou worker separado) — aqui exposto também via
endpoint HTTP para permitir execução manual/teste. Reaproveita
estoque.service.calcular_saldo_atual em vez de duplicar lógica de saldo,
mesmo princípio já aplicado no Inventário e na Venda.
"""
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AlertaGerado, Lote, Movimentacao, Produto, RegraAlerta
from app.modules.estoque import service as estoque_service
from app.modules.alertas.schemas import RegraAlertaCreate, RegraAlertaUpdate

TIPOS_ALERTA = ("validade", "estoque_baixo", "produto_parado")

DEFAULTS = {
    "validade": {"dias_antes": 5},
    "estoque_baixo": {},  # sempre compara contra produtos.estoque_minimo
    "produto_parado": {"dias_sem_movimento": 30},
}


async def criar_regra(db: AsyncSession, *, tenant_id: UUID, dados: RegraAlertaCreate) -> RegraAlerta:
    regra = RegraAlerta(tenant_id=tenant_id, tipo=dados.tipo, parametros=dados.parametros, ativo=dados.ativo)
    db.add(regra)
    await db.commit()
    await db.refresh(regra)
    return regra


async def listar_regras(db: AsyncSession, *, tenant_id: UUID):
    stmt = select(RegraAlerta).where(RegraAlerta.tenant_id == tenant_id)
    return (await db.execute(stmt)).scalars().all()


async def atualizar_regra(
    db: AsyncSession, *, tenant_id: UUID, regra_id: UUID, dados: RegraAlertaUpdate
) -> RegraAlerta:
    regra = await db.get(RegraAlerta, regra_id)
    if not regra or regra.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regra não encontrada.")

    # exclude_unset: só altera os campos que vieram no PATCH — mantém os demais como estão
    dados_informados = dados.model_dump(exclude_unset=True)
    for campo, valor in dados_informados.items():
        setattr(regra, campo, valor)

    await db.commit()
    await db.refresh(regra)
    return regra


async def _ja_existe_alerta_aberto(db: AsyncSession, *, tenant_id: UUID, produto_id: UUID, tipo: str) -> bool:
    stmt = select(AlertaGerado).where(
        AlertaGerado.tenant_id == tenant_id,
        AlertaGerado.produto_id == produto_id,
        AlertaGerado.tipo == tipo,
        AlertaGerado.lido.is_(False),
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def _checar_validade(db: AsyncSession, *, tenant_id: UUID, parametros: dict) -> list[AlertaGerado]:
    dias_antes = parametros.get("dias_antes", DEFAULTS["validade"]["dias_antes"])
    limite = date.today() + timedelta(days=dias_antes)
    stmt = select(Lote).where(Lote.tenant_id == tenant_id, Lote.validade.is_not(None), Lote.validade <= limite)
    lotes = (await db.execute(stmt)).scalars().all()

    novos = []
    for lote in lotes:
        if await _ja_existe_alerta_aberto(db, tenant_id=tenant_id, produto_id=lote.produto_id, tipo="validade"):
            continue
        alerta = AlertaGerado(
            tenant_id=tenant_id, tipo="validade", produto_id=lote.produto_id,
            mensagem=f"Lote {lote.codigo_lote} vence em {lote.validade.strftime('%d/%m/%Y')}.",
        )
        db.add(alerta)
        novos.append(alerta)
    return novos


async def _checar_estoque_baixo(db: AsyncSession, *, tenant_id: UUID) -> list[AlertaGerado]:
    stmt = select(Produto).where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True))
    produtos = (await db.execute(stmt)).scalars().all()

    novos = []
    for produto in produtos:
        saldo = await estoque_service.calcular_saldo_atual(db, tenant_id=tenant_id, produto_id=produto.id)
        if saldo >= produto.estoque_minimo:
            continue
        if await _ja_existe_alerta_aberto(db, tenant_id=tenant_id, produto_id=produto.id, tipo="estoque_baixo"):
            continue
        alerta = AlertaGerado(
            tenant_id=tenant_id, tipo="estoque_baixo", produto_id=produto.id,
            mensagem=f"Estoque de '{produto.nome}' abaixo do mínimo ({saldo}/{produto.estoque_minimo}).",
        )
        db.add(alerta)
        novos.append(alerta)
    return novos


async def _checar_produto_parado(db: AsyncSession, *, tenant_id: UUID, parametros: dict) -> list[AlertaGerado]:
    dias = parametros.get("dias_sem_movimento", DEFAULTS["produto_parado"]["dias_sem_movimento"])
    limite = datetime.now(timezone.utc) - timedelta(days=dias)

    produtos = (
        await db.execute(select(Produto).where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True)))
    ).scalars().all()

    novos = []
    for produto in produtos:
        ultima = (
            await db.execute(
                select(Movimentacao)
                .where(Movimentacao.tenant_id == tenant_id, Movimentacao.produto_id == produto.id)
                .order_by(Movimentacao.criado_em.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        sem_movimento = ultima is None or ultima.criado_em < limite
        if not sem_movimento:
            continue
        if await _ja_existe_alerta_aberto(db, tenant_id=tenant_id, produto_id=produto.id, tipo="produto_parado"):
            continue

        alerta = AlertaGerado(
            tenant_id=tenant_id, tipo="produto_parado", produto_id=produto.id,
            mensagem=f"'{produto.nome}' sem movimentação há mais de {dias} dias.",
        )
        db.add(alerta)
        novos.append(alerta)
    return novos


async def executar_motor(db: AsyncSession, *, tenant_id: UUID) -> list[AlertaGerado]:
    regras = await listar_regras(db, tenant_id=tenant_id)
    regras_por_tipo = {r.tipo: r for r in regras if r.ativo}

    gerados: list[AlertaGerado] = []
    if "validade" in regras_por_tipo or not regras:
        params = regras_por_tipo.get("validade").parametros if "validade" in regras_por_tipo else DEFAULTS["validade"]
        gerados += await _checar_validade(db, tenant_id=tenant_id, parametros=params)

    if "estoque_baixo" in regras_por_tipo or not regras:
        gerados += await _checar_estoque_baixo(db, tenant_id=tenant_id)

    if "produto_parado" in regras_por_tipo or not regras:
        params = (
            regras_por_tipo.get("produto_parado").parametros
            if "produto_parado" in regras_por_tipo
            else DEFAULTS["produto_parado"]
        )
        gerados += await _checar_produto_parado(db, tenant_id=tenant_id, parametros=params)

    await db.commit()
    return gerados


async def listar_alertas(db: AsyncSession, *, tenant_id: UUID, apenas_nao_lidos: bool):
    stmt = select(AlertaGerado).where(AlertaGerado.tenant_id == tenant_id)
    if apenas_nao_lidos:
        stmt = stmt.where(AlertaGerado.lido.is_(False))
    stmt = stmt.order_by(AlertaGerado.criado_em.desc())
    return (await db.execute(stmt)).scalars().all()


async def marcar_lido(db: AsyncSession, *, tenant_id: UUID, alerta_id: UUID) -> AlertaGerado | None:
    alerta = await db.get(AlertaGerado, alerta_id)
    if not alerta or alerta.tenant_id != tenant_id:
        return None
    alerta.lido = True
    await db.commit()
    await db.refresh(alerta)
    return alerta


async def painel(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    tipo_filtro: str | None = None,
    status_filtro: str | None = None,  # "lido" | "nao_lido" | None (todos)
    busca: str | None = None,
    pagina: int = 1,
    tamanho: int = 25,
) -> dict:
    """
    Alimenta a tela de Alertas com o kit de UX. Mantido separado de
    listar_alertas()/GET /alertas (usado como listagem crua) — mesmo padrão
    já usado em /estoque/painel, /inventario/painel etc.
    """
    stmt = (
        select(AlertaGerado, Produto.nome)
        .outerjoin(Produto, Produto.id == AlertaGerado.produto_id)
        .where(AlertaGerado.tenant_id == tenant_id)
    )
    if tipo_filtro:
        stmt = stmt.where(AlertaGerado.tipo == tipo_filtro)
    if status_filtro == "lido":
        stmt = stmt.where(AlertaGerado.lido.is_(True))
    elif status_filtro == "nao_lido":
        stmt = stmt.where(AlertaGerado.lido.is_(False))
    if busca:
        termo = f"%{busca}%"
        stmt = stmt.where(or_(AlertaGerado.mensagem.ilike(termo), Produto.nome.ilike(termo)))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    stmt = stmt.order_by(AlertaGerado.criado_em.desc())
    stmt = stmt.offset((pagina - 1) * tamanho).limit(tamanho)

    linhas = (await db.execute(stmt)).all()
    itens = [
        {
            "id": alerta.id,
            "tipo": alerta.tipo,
            "produto_id": alerta.produto_id,
            "produto_nome": produto_nome,
            "mensagem": alerta.mensagem,
            "lido": alerta.lido,
            "criado_em": alerta.criado_em,
        }
        for alerta, produto_nome in linhas
    ]

    # KPIs sempre sobre os alertas ATIVOS (não lidos) do tenant, sem aplicar
    # busca/filtro — mesmo princípio já usado nos demais paineis (embora aqui
    # o "universo" seja não-lidos, não o total geral, já que alerta lido é
    # considerado resolvido/arquivado).
    contagens = dict(
        (
            await db.execute(
                select(AlertaGerado.tipo, func.count())
                .where(AlertaGerado.tenant_id == tenant_id, AlertaGerado.lido.is_(False))
                .group_by(AlertaGerado.tipo)
            )
        ).all()
    )
    kpis = {tipo: contagens.get(tipo, 0) for tipo in TIPOS_ALERTA}
    kpis["total_ativos"] = sum(kpis.values())

    return {
        "kpis": kpis,
        "itens": itens,
        "total": total,
        "pagina": pagina,
        "tamanho": tamanho,
    }
