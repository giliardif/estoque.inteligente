from collections.abc import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.modules.usuarios import service
from app.modules.usuarios.schemas import UsuarioCreate, UsuarioCreateResult, UsuarioOut, UsuarioUpdate

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
