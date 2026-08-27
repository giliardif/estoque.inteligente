from collections.abc import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Depends, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.core.storage import enviar_imagem_usuario
from app.modules.usuarios import service
from app.modules.usuarios.schemas import (
    UsuarioCreate,
    UsuarioCreateResult,
    UsuarioMeUpdate,
    UsuarioOut,
    UsuarioUpdate,
)

router = APIRouter(prefix="/usuarios", tags=["usuarios"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


@router.get("", response_model=list[UsuarioOut])
async def listar_usuarios(
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.listar(db, tenant_id=user.tenant_id)


@router.post("", response_model=UsuarioCreateResult, status_code=201)
async def criar_usuario(
    payload: UsuarioCreate,
    user: CurrentUser = Depends(require_perfil("admin")),  # só admin convida
    db: AsyncSession = Depends(get_tenant_db),
):
    novo, senha_provisoria = await service.criar(db, tenant_id=user.tenant_id, dados=payload)
    return UsuarioCreateResult(usuario=UsuarioOut.model_validate(novo), senha_provisoria=senha_provisoria)


@router.get("/me", response_model=UsuarioOut)
async def obter_meus_dados(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    # Existe separado do JWT de propósito: avatar_url pode mudar bem mais
    # frequentemente que nome/perfil, e colocar no payload do token exigiria
    # reemitir o JWT a cada troca de foto — mesmo trade-off que já levou
    # nome/deve_trocar_senha a irem por dentro do token não se aplica aqui.
    return await service.obter_por_id(db, tenant_id=user.tenant_id, usuario_id=user.id)


@router.patch("/me", response_model=UsuarioOut)
async def atualizar_meus_dados(
    payload: UsuarioMeUpdate,
    user: CurrentUser = Depends(get_current_user),  # qualquer perfil pode editar o próprio nome
    db: AsyncSession = Depends(get_tenant_db),
):
    # Nota: o nome no JWT atual da sessão só atualiza no próximo login/refresh
    # (mesma limitação já documentada pra outros campos do token).
    return await service.atualizar_meus_dados(db, tenant_id=user.tenant_id, usuario_id=user.id, dados=payload)


@router.post("/me/foto", response_model=UsuarioOut)
async def enviar_minha_foto(
    arquivo: UploadFile,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    url = await enviar_imagem_usuario(tenant_id=user.tenant_id, usuario_id=user.id, arquivo=arquivo)
    return await service.definir_avatar(db, tenant_id=user.tenant_id, usuario_id=user.id, avatar_url=url)


@router.patch("/{usuario_id}", response_model=UsuarioOut)
async def atualizar_usuario(
    usuario_id: UUID,
    payload: UsuarioUpdate,
    user: CurrentUser = Depends(require_perfil("admin")),  # só admin gerencia
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.atualizar(
        db, tenant_id=user.tenant_id, usuario_id=usuario_id, solicitante_id=user.id, dados=payload
    )
