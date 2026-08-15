from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user
from app.modules.painel import service
from app.modules.painel.schemas import PainelGeralOut

router = APIRouter(prefix="/painel", tags=["painel"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


@router.get("", response_model=PainelGeralOut)
async def painel_geral(
    dias: int = Query(default=7, ge=1, le=90),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.painel_geral(db, tenant_id=user.tenant_id, dias=dias)
