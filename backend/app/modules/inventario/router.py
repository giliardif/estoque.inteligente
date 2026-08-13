from collections.abc import AsyncGenerator

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.modules.inventario import service
from app.modules.inventario.schemas import (
    InventarioAbrir,
    InventarioFechar,
    InventarioItemOut,
    InventarioOut,
    PainelInventarioOut,
)

router = APIRouter(prefix="/inventario", tags=["inventario"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


# IMPORTANTE: "/painel" precisa vir ANTES de "/aberto" e "/{inventario_id}/...",
# mesma ordem usada nos demais routers com painel.
@router.get("/painel", response_model=PainelInventarioOut)
async def painel_inventario(
    status_filtro: str | None = Query(default=None, alias="status"),
    deposito_id: UUID | None = Query(default=None),
    busca: str | None = Query(default=None, max_length=20),
    ordenar_por: str = Query(default="criado_em"),
    direcao: str = Query(default="desc", pattern="^(asc|desc)$"),
    pagina: int = Query(default=1, ge=1),
    tamanho: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.painel(
        db, tenant_id=user.tenant_id, status_filtro=status_filtro, deposito_id=deposito_id, busca=busca,
        ordenar_por=ordenar_por, direcao=direcao, pagina=pagina, tamanho=tamanho,
    )


@router.post("", response_model=InventarioOut, status_code=201)
async def abrir_inventario(
    payload: InventarioAbrir,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.abrir(db, tenant_id=user.tenant_id, deposito_id=payload.deposito_id, ciclo=payload.ciclo)


@router.get("", response_model=list[InventarioOut])
async def listar_inventarios(
    status_filtro: str | None = Query(default=None, alias="status"),
    pagina: int = Query(default=1, ge=1),
    tamanho: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.listar(db, tenant_id=user.tenant_id, status_filtro=status_filtro, pagina=pagina, tamanho=tamanho)


@router.get("/aberto", response_model=InventarioOut | None)
async def obter_inventario_aberto(
    deposito_id: UUID | None = Query(default=None),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Retorna o inventário em aberto para o depósito informado (ou o inventário
    sem depósito específico), ou null se não houver nenhum — usado pelo
    frontend para retomar uma contagem em andamento ao carregar a tela."""
    return await service.obter_aberto(db, tenant_id=user.tenant_id, deposito_id=deposito_id)


@router.post("/{inventario_id}/fechar", response_model=InventarioOut)
async def fechar_inventario(
    inventario_id: UUID,
    payload: InventarioFechar,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.fechar(
        db, tenant_id=user.tenant_id, usuario_id=user.id, inventario_id=inventario_id, dados=payload
    )


@router.get("/{inventario_id}/itens", response_model=list[InventarioItemOut])
async def listar_itens_inventario(
    inventario_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.listar_itens(db, tenant_id=user.tenant_id, inventario_id=inventario_id)
