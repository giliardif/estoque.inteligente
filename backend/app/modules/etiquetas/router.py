from collections.abc import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.modules.etiquetas import service
from app.modules.etiquetas.schemas import EtiquetaModeloCreate, EtiquetaModeloOut, EtiquetaModeloUpdate

router = APIRouter(prefix="/etiquetas", tags=["etiquetas"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


@router.get("/modelos", response_model=list[EtiquetaModeloOut])
async def listar_modelos(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.listar(db, tenant_id=user.tenant_id)


@router.post("/modelos", response_model=EtiquetaModeloOut, status_code=status.HTTP_201_CREATED)
async def criar_modelo(
    payload: EtiquetaModeloCreate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.criar(db, tenant_id=user.tenant_id, dados=payload)


@router.patch("/modelos/{modelo_id}", response_model=EtiquetaModeloOut)
async def atualizar_modelo(
    modelo_id: UUID,
    payload: EtiquetaModeloUpdate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    modelo = await service.atualizar(db, tenant_id=user.tenant_id, modelo_id=modelo_id, dados=payload)
    if not modelo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Modelo de etiqueta não encontrado.")
    return modelo


@router.delete("/modelos/{modelo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover_modelo(
    modelo_id: UUID,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    ok = await service.remover(db, tenant_id=user.tenant_id, modelo_id=modelo_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Modelo de etiqueta não encontrado.")
