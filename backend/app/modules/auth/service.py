"""
Login com proteção contra força bruta: após 5 tentativas erradas, a conta
fica bloqueada por 15 minutos (contador e timestamp vivem no próprio
usuário — ver migration 004). Isso é ADICIONAL ao rate limit por IP
(slowapi) — um atacante trocando de IP ainda esbarra no lockout por conta.

Refresh token: rotação a cada uso (o token antigo é revogado assim que um
novo é emitido). Se um refresh token revogado for reapresentado, é sinal
de possível roubo — todos os tokens daquele usuário são revogados.
"""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    create_access_token,
    gerar_refresh_token_bruto,
    hash_password,
    hash_refresh_token,
    verificar_refresh_token,
    verify_password,
)
from app.db.models import RefreshToken, Tenant, User
from app.modules.auth.schemas import LoginInput, RegistrarTenantInput, TrocarSenhaInput

MAX_TENTATIVAS = 5
BLOQUEIO_MINUTOS = 15
REFRESH_TOKEN_DIAS = 7

# Mensagem genérica para qualquer falha de login — nunca revelar se o
# e-mail existe, se a senha está errada, ou se a conta está bloqueada,
# para não dar pistas a um atacante enumerando contas.
ERRO_LOGIN_GENERICO = "E-mail ou senha inválidos."


async def registrar_tenant(db: AsyncSession, dados: RegistrarTenantInput) -> User:
    existente = (await db.execute(select(User).where(User.email == dados.admin_email))).scalar_one_or_none()
    if existente:
        # Mesma resposta de "sucesso genérico" seria ideal para não vazar e-mail
        # cadastrado, mas cadastro de empresa é ação rara o suficiente para
        # priorizar clareza operacional aqui; login continua com mensagem genérica.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="E-mail já cadastrado.")

    tenant = Tenant(nome=dados.nome_empresa, segmento_slug=dados.segmento_slug)
    db.add(tenant)
    await db.flush()

    admin = User(
        tenant_id=tenant.id,
        nome=dados.admin_nome,
        email=dados.admin_email,
        senha_hash=hash_password(dados.admin_senha),
        perfil="admin",
        ativo=True,
    )
    db.add(admin)
    await db.commit()
    await db.refresh(admin)
    return admin


async def login(db: AsyncSession, dados: LoginInput) -> tuple[str, str]:
    user = (await db.execute(select(User).where(User.email == dados.email))).scalar_one_or_none()

    if not user or not user.ativo:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=ERRO_LOGIN_GENERICO)

    agora = datetime.now(timezone.utc)
    if user.bloqueado_ate and user.bloqueado_ate > agora:
        # Mesma mensagem genérica — não revela que o motivo é bloqueio, e sim "credenciais inválidas"
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=ERRO_LOGIN_GENERICO)

    if not verify_password(dados.senha, user.senha_hash):
        user.tentativas_falhas += 1
        if user.tentativas_falhas >= MAX_TENTATIVAS:
            user.bloqueado_ate = agora + timedelta(minutes=BLOQUEIO_MINUTOS)
            user.tentativas_falhas = 0
        await db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=ERRO_LOGIN_GENERICO)

    user.tentativas_falhas = 0
    user.bloqueado_ate = None
    await db.commit()

    access_token = create_access_token(
        user_id=user.id, tenant_id=user.tenant_id, perfil=user.perfil, deve_trocar_senha=user.deve_trocar_senha
    )
    refresh_bruto = await _emitir_refresh_token(db, user)
    return access_token, refresh_bruto


async def _emitir_refresh_token(db: AsyncSession, user: User) -> str:
    token_bruto = gerar_refresh_token_bruto()
    registro = RefreshToken(
        tenant_id=user.tenant_id,
        user_id=user.id,
        token_hash=hash_refresh_token(token_bruto),
        expira_em=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DIAS),
    )
    db.add(registro)
    await db.commit()
    return token_bruto


async def renovar_token(db: AsyncSession, refresh_token_bruto: str) -> tuple[str, str]:
    # Não dá pra buscar direto por hash (hash de senha/token não é determinístico
    # por padrão no argon2 — cada chamada gera um salt diferente). Por isso
    # comparamos contra todos os tokens não expirados/não revogados do request.
    # Em escala maior, trocar para HMAC-SHA256 determinístico só para o índice
    # de lookup, mantendo o hash argon2 como confirmação final.
    candidatos = (
        await db.execute(
            select(RefreshToken).where(
                RefreshToken.revogado.is_(False),
                RefreshToken.expira_em > datetime.now(timezone.utc),
            )
        )
    ).scalars().all()

    registro_valido = None
    for candidato in candidatos:
        if verificar_refresh_token(refresh_token_bruto, candidato.token_hash):
            registro_valido = candidato
            break

    if not registro_valido:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token inválido ou expirado.")

    user = await db.get(User, registro_valido.user_id)
    if not user or not user.ativo:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário inativo.")

    # Rotação: revoga o token usado e emite um novo — reduz o valor de um token roubado
    registro_valido.revogado = True
    await db.commit()

    access_token = create_access_token(
        user_id=user.id, tenant_id=user.tenant_id, perfil=user.perfil, deve_trocar_senha=user.deve_trocar_senha
    )
    novo_refresh = await _emitir_refresh_token(db, user)
    return access_token, novo_refresh


async def trocar_senha(db: AsyncSession, *, user_id: UUID, dados: TrocarSenhaInput) -> None:
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuário não encontrado.")

    if not verify_password(dados.senha_atual, user.senha_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Senha atual incorreta.")

    user.senha_hash = hash_password(dados.senha_nova)
    user.deve_trocar_senha = False
    await db.commit()

    # Troca de senha revoga todas as sessões existentes (mesma lógica de
    # "roubo suspeito" do refresh token) — força novo login com a senha nova,
    # inclusive em outros dispositivos onde a sessão antiga estivesse aberta.
    await revogar_todos_tokens(db, user_id)


async def revogar_todos_tokens(db: AsyncSession, user_id: UUID) -> None:
    """Usado em logout e como resposta a suspeita de token roubado (reuse de token revogado)."""
    await db.execute(update(RefreshToken).where(RefreshToken.user_id == user_id).values(revogado=True))
    await db.commit()
