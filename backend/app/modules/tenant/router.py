from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.modules.tenant import service
from app.modules.tenant.schemas import TenantOut, TenantUpdate

router = APIRouter(prefix="/tenant", tags=["tenant"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


@router.get("", response_model=TenantOut)
async def obter_tenant(
    user: CurrentUser = Depends(get_current_user),  # qualquer perfil pode ler (tela de Configurações é comum a todos)
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.obter(db, tenant_id=user.tenant_id)


@router.patch("", response_model=TenantOut)
async def atualizar_tenant(
    payload: TenantUpdate,
    user: CurrentUser = Depends(require_perfil("admin")),  # só admin edita dados da empresa
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.atualizar(db, tenant_id=user.tenant_id, dados=payload)
