"""
Regra: toda query filtra por tenant_id explicitamente, mesmo já havendo RLS
no banco — defesa em profundidade (mesmo padrão dos outros módulos).

Regra de negócio: um admin não pode desativar ou rebaixar a própria conta
(evita o tenant ficar sem nenhum admin ativo, um estado sem saída sem
acesso direto ao banco). Não há verificação de "é o único admin restante"
porque isso abriria uma corrida (dois admins se rebaixando ao mesmo tempo)
e adicionaria complexidade para um cenário de borda que a regra mais simples
já cobre na prática: cada admin só pode mexer no PRÓPRIO acesso via convite
de outro admin, nunca no seu.
"""
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import gerar_senha_provisoria, hash_password
from app.db.models import User
from app.modules.usuarios.schemas import UsuarioCreate, UsuarioUpdate


async def listar(db: AsyncSession, *, tenant_id: UUID):
    stmt = select(User).where(User.tenant_id == tenant_id).order_by(User.criado_em.asc())
    result = await db.execute(stmt)
    return result.scalars().all()


async def criar(db: AsyncSession, *, tenant_id: UUID, dados: UsuarioCreate) -> tuple[User, str]:
    existente = (
        await db.execute(select(User).where(User.email == dados.email))
    ).scalar_one_or_none()
    if existente:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="E-mail já cadastrado.")

    senha_provisoria = gerar_senha_provisoria()
    novo = User(
        tenant_id=tenant_id,
        nome=dados.nome,
        email=dados.email,
        senha_hash=hash_password(senha_provisoria),
        perfil=dados.perfil,
        ativo=True,
        deve_trocar_senha=True,
    )
    db.add(novo)
    await db.commit()
    await db.refresh(novo)
    return novo, senha_provisoria


async def atualizar(
    db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, solicitante_id: UUID, dados: UsuarioUpdate
) -> User:
    if dados.perfil is None and dados.ativo is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nenhuma alteração informada.")

    alvo = (
        await db.execute(select(User).where(User.id == usuario_id, User.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if not alvo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")

    if alvo.id == solicitante_id:
        rebaixando = dados.perfil is not None and dados.perfil != "admin"
        desativando = dados.ativo is False
        if rebaixando or desativando:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Você não pode alterar seu próprio perfil ou se desativar.",
            )

    if dados.perfil is not None:
        alvo.perfil = dados.perfil
    if dados.ativo is not None:
        alvo.ativo = dados.ativo

    await db.commit()
    await db.refresh(alvo)
    return alvo
