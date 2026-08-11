from collections.abc import AsyncGenerator

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.modules.vendas import service
from app.modules.vendas.schemas import PainelVendasOut, VendaCreate, VendaOut

router = APIRouter(prefix="/vendas", tags=["vendas"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


@router.post("", response_model=VendaOut, status_code=status.HTTP_201_CREATED)
async def finalizar_venda(
    payload: VendaCreate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.finalizar(db, tenant_id=user.tenant_id, usuario_id=user.id, dados=payload)


# IMPORTANTE: "/painel" precisa vir ANTES de "/{venda_id}" — mesma ordem usada
# em produtos/router.py. Como venda_id é tipado UUID, "painel" nunca bateria
# na rota dinâmica por engano, mas a ordem de declaração é o que garante isso.
@router.get("/painel", response_model=PainelVendasOut)
async def painel_vendas(
    data_inicio: date | None = Query(default=None),
    data_fim: date | None = Query(default=None),
    status_venda: str | None = Query(default=None, alias="status", pattern="^(finalizada|cancelada)$"),
    busca: str | None = Query(default=None, max_length=200),
    ordenar_por: str = Query(default="criado_em"),
    direcao: str = Query(default="desc", pattern="^(asc|desc)$"),
    pagina: int = Query(default=1, ge=1),
    tamanho: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.painel(
        db, tenant_id=user.tenant_id, data_inicio=data_inicio, data_fim=data_fim, status_venda=status_venda,
        busca=busca, ordenar_por=ordenar_por, direcao=direcao, pagina=pagina, tamanho=tamanho,
    )


@router.post("/{venda_id}/cancelar", response_model=VendaOut)
async def cancelar_venda(
    venda_id: UUID,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.cancelar(db, tenant_id=user.tenant_id, usuario_id=user.id, venda_id=venda_id)


@router.get("", response_model=list[VendaOut])
async def listar_vendas(
    data_inicio: date | None = Query(default=None),
    data_fim: date | None = Query(default=None),
    pagina: int = Query(default=1, ge=1),
    tamanho: int = Query(default=25, ge=1, le=100),  # teto evita paginação abusiva, mesmo padrão de produtos
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.listar(
        db, tenant_id=user.tenant_id, data_inicio=data_inicio, data_fim=data_fim, pagina=pagina, tamanho=tamanho
    )


@router.get("/{venda_id}", response_model=VendaOut)
async def obter_venda(
    venda_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    venda = await service.obter(db, tenant_id=user.tenant_id, venda_id=venda_id)
    if not venda:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Venda não encontrada.")
    return venda
