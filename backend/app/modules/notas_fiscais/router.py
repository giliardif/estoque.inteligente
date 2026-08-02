from collections.abc import AsyncGenerator

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.modules.notas_fiscais import service
from app.modules.notas_fiscais.schemas import ConfirmarItemPayload, NotaFiscalItemOut, NotaFiscalResumoOut

router = APIRouter(prefix="/notas-fiscais", tags=["notas-fiscais"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


@router.post("/importar", status_code=201)
async def importar_nota(
    arquivo: UploadFile = File(...),
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    nota = await service.importar(db, tenant_id=user.tenant_id, usuario_id=user.id, arquivo=arquivo)
    return {"id": nota.id, "numero": nota.numero, "status": nota.status}


@router.get("", response_model=list[NotaFiscalResumoOut])
async def listar_notas(
    status_filtro: str | None = Query(default=None, alias="status"),
    pagina: int = Query(default=1, ge=1),
    tamanho: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.listar(db, tenant_id=user.tenant_id, status_filtro=status_filtro, pagina=pagina, tamanho=tamanho)


@router.get("/{nota_id}/itens", response_model=list[NotaFiscalItemOut])
async def listar_itens(
    nota_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    nota = await service.obter(db, tenant_id=user.tenant_id, nota_id=nota_id)
    if not nota:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nota não encontrada.")
    return await service.listar_itens(db, tenant_id=user.tenant_id, nota_id=nota_id)


@router.post("/itens/{item_id}/confirmar", response_model=NotaFiscalItemOut)
async def confirmar_item(
    item_id: UUID,
    payload: ConfirmarItemPayload,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.confirmar_item(db, tenant_id=user.tenant_id, usuario_id=user.id, item_id=item_id, dados=payload)
