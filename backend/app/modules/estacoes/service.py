"""
Regra: toda query filtra por tenant_id explicitamente (defesa em
profundidade, mesmo padrão do resto do sistema), exceto
`resolver_estacao_por_token`, que roda ANTES de sabermos o tenant_id —
mesma situação estrutural do login (ver core/database.get_db_auth).

Reimpressão é sempre manual (nunca automática): um job com erro ou
pendente-sem-resposta nunca é reenviado sozinho pelo backend — só quando
alguém aciona reimprimir() explicitamente. Evita imprimir a mesma etiqueta
duas vezes se a confirmação de "impresso" simplesmente se perdeu (a
estação pode ter imprimido de verdade e só a resposta de volta falhou).
"""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import gerar_token_estacao_bruto, hash_lookup_token_estacao
from app.db.models import EstacaoImpressao, FilaImpressao, User
from app.modules.estacoes.schemas import (
    JANELA_ONLINE_SEGUNDOS,
    EstacaoImpressaoCreate,
    EstacaoImpressaoUpdate,
    FilaImpressaoCreate,
)


def _online(estacao: EstacaoImpressao) -> bool:
    if not estacao.ultima_atividade_em:
        return False
    limite = datetime.now(timezone.utc) - timedelta(seconds=JANELA_ONLINE_SEGUNDOS)
    ultima = estacao.ultima_atividade_em
    if ultima.tzinfo is None:
        ultima = ultima.replace(tzinfo=timezone.utc)
    return ultima > limite


def serializar_estacao(estacao: EstacaoImpressao) -> dict:
    return {
        "id": estacao.id,
        "nome": estacao.nome,
        "impressora_nome": estacao.impressora_nome,
        "online": _online(estacao),
        "ultima_atividade_em": estacao.ultima_atividade_em,
        "criado_em": estacao.criado_em,
    }


async def listar_estacoes(db: AsyncSession, *, tenant_id: UUID) -> list[dict]:
    stmt = (
        select(EstacaoImpressao)
        .where(EstacaoImpressao.tenant_id == tenant_id, EstacaoImpressao.revogado.is_(False))
        .order_by(EstacaoImpressao.criado_em.asc())
    )
    estacoes = (await db.execute(stmt)).scalars().all()
    return [serializar_estacao(e) for e in estacoes]


async def registrar(
    db: AsyncSession, *, tenant_id: UUID, criado_por: UUID, dados: EstacaoImpressaoCreate
) -> tuple[EstacaoImpressao, str]:
    token_bruto = gerar_token_estacao_bruto()
    nova = EstacaoImpressao(
        tenant_id=tenant_id,
        nome=dados.nome,
        impressora_nome=dados.impressora_nome,
        token_lookup_hash=hash_lookup_token_estacao(token_bruto),
        criado_por=criado_por,
    )
    db.add(nova)
    await db.commit()
    await db.refresh(nova)
    return nova, token_bruto


async def atualizar(
    db: AsyncSession, *, tenant_id: UUID, estacao_id: UUID, dados: EstacaoImpressaoUpdate
) -> EstacaoImpressao | None:
    estacao = (
        await db.execute(
            select(EstacaoImpressao).where(
                EstacaoImpressao.id == estacao_id,
                EstacaoImpressao.tenant_id == tenant_id,
                EstacaoImpressao.revogado.is_(False),
            )
        )
    ).scalar_one_or_none()
    if not estacao:
        return None
    if dados.nome is not None:
        estacao.nome = dados.nome
    if dados.impressora_nome is not None:
        estacao.impressora_nome = dados.impressora_nome
    await db.commit()
    await db.refresh(estacao)
    return estacao


async def revogar(db: AsyncSession, *, tenant_id: UUID, estacao_id: UUID) -> bool:
    estacao = (
        await db.execute(
            select(EstacaoImpressao).where(
                EstacaoImpressao.id == estacao_id, EstacaoImpressao.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if not estacao or estacao.revogado:
        return False
    estacao.revogado = True
    estacao.revogado_em = datetime.now(timezone.utc)
    await db.commit()
    return True


async def resolver_estacao_por_token(db_auth: AsyncSession, *, token_bruto: str) -> EstacaoImpressao | None:
    """Lookup indexado O(1) via HMAC — roda na sessão auth_service
    (bypass RLS), única exceção estrutural igual ao login de usuário,
    porque o tenant_id só é conhecido DEPOIS de resolver o token."""
    lookup_hash = hash_lookup_token_estacao(token_bruto)
    estacao = (
        await db_auth.execute(
            select(EstacaoImpressao).where(
                EstacaoImpressao.token_lookup_hash == lookup_hash,
                EstacaoImpressao.revogado.is_(False),
            )
        )
    ).scalar_one_or_none()
    return estacao


async def registrar_heartbeat(db_auth: AsyncSession, *, estacao_id: UUID) -> None:
    await db_auth.execute(
        update(EstacaoImpressao)
        .where(EstacaoImpressao.id == estacao_id)
        .values(ultima_atividade_em=datetime.now(timezone.utc))
    )
    await db_auth.commit()


async def serializar_job(db: AsyncSession, job: FilaImpressao) -> dict:
    estacao = await db.get(EstacaoImpressao, job.estacao_id)
    enviado_por_nome = None
    if job.enviado_por:
        usuario = await db.get(User, job.enviado_por)
        enviado_por_nome = usuario.nome if usuario else None
    return {
        "id": job.id,
        "estacao_id": job.estacao_id,
        "estacao_nome": estacao.nome if estacao else "—",
        "produto_id": job.produto_id,
        "titulo": job.titulo,
        "quantidade": job.quantidade,
        "status": job.status,
        "enviado_por_nome": enviado_por_nome,
        "criado_em": job.criado_em,
        "atualizado_em": job.atualizado_em,
    }


async def criar_job(
    db: AsyncSession, *, tenant_id: UUID, enviado_por: UUID, dados: FilaImpressaoCreate
) -> dict:
    estacao = (
        await db.execute(
            select(EstacaoImpressao).where(
                EstacaoImpressao.id == dados.estacao_id,
                EstacaoImpressao.tenant_id == tenant_id,
                EstacaoImpressao.revogado.is_(False),
            )
        )
    ).scalar_one_or_none()
    if not estacao:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Estação de impressão não encontrada.")

    job = FilaImpressao(
        tenant_id=tenant_id,
        estacao_id=dados.estacao_id,
        produto_id=dados.produto_id,
        titulo=dados.titulo,
        quantidade=dados.quantidade,
        payload_json=dados.payload_json,
        status="pendente",
        enviado_por=enviado_por,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return await serializar_job(db, job)


async def listar_fila(db: AsyncSession, *, tenant_id: UUID, status_filtro: str | None = None) -> list[dict]:
    stmt = select(FilaImpressao).where(FilaImpressao.tenant_id == tenant_id)
    if status_filtro:
        stmt = stmt.where(FilaImpressao.status == status_filtro)
    stmt = stmt.order_by(FilaImpressao.criado_em.desc()).limit(200)
    jobs = (await db.execute(stmt)).scalars().all()
    return [await serializar_job(db, j) for j in jobs]


async def listar_pendentes_da_estacao(db: AsyncSession, *, estacao_id: UUID) -> list[FilaImpressao]:
    stmt = (
        select(FilaImpressao)
        .where(FilaImpressao.estacao_id == estacao_id, FilaImpressao.status == "pendente")
        .order_by(FilaImpressao.criado_em.asc())
    )
    return (await db.execute(stmt)).scalars().all()


async def marcar_status(
    db: AsyncSession, *, estacao_id: UUID, job_id: UUID, novo_status: str
) -> FilaImpressao | None:
    job = (
        await db.execute(
            select(FilaImpressao).where(FilaImpressao.id == job_id, FilaImpressao.estacao_id == estacao_id)
        )
    ).scalar_one_or_none()
    if not job:
        return None
    job.status = novo_status
    await db.commit()
    await db.refresh(job)
    return job


async def reimprimir(db: AsyncSession, *, tenant_id: UUID, enviado_por: UUID, job_id: UUID) -> dict | None:
    original = (
        await db.execute(
            select(FilaImpressao).where(FilaImpressao.id == job_id, FilaImpressao.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not original:
        return None
    if original.status == "impresso":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Este job já foi impresso — reimpressão é manual para evitar duplicidade.",
        )

    novo = FilaImpressao(
        tenant_id=tenant_id,
        estacao_id=original.estacao_id,
        produto_id=original.produto_id,
        titulo=original.titulo,
        quantidade=original.quantidade,
        payload_json=original.payload_json,
        status="pendente",
        enviado_por=enviado_por,
        job_origem_id=original.id,
    )
    db.add(novo)
    await db.commit()
    await db.refresh(novo)
    return await serializar_job(db, novo)
