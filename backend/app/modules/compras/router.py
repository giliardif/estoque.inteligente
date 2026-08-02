from collections.abc import AsyncGenerator

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.modules.compras import service
from app.modules.compras.schemas import (
    PedidoCompraCreate,
    PedidoCompraOut,
    ReceberItemInput,
    SugestaoReposicaoOut,
)

router = APIRouter(prefix="/compras", tags=["compras"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


@router.post("/pedidos", response_model=PedidoCompraOut, status_code=201)
async def criar_pedido(
    payload: PedidoCompraCreate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.criar_pedido(db, tenant_id=user.tenant_id, usuario_id=user.id, dados=payload)


@router.get("/pedidos", response_model=list[PedidoCompraOut])
async def listar_pedidos(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.listar(db, tenant_id=user.tenant_id)


@router.get("/pedidos/{pedido_id}", response_model=PedidoCompraOut)
async def obter_pedido(
    pedido_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    pedido = await service.obter(db, tenant_id=user.tenant_id, pedido_id=pedido_id)
    if not pedido:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pedido não encontrado.")
    return pedido


@router.post("/pedidos/{pedido_id}/receber", response_model=PedidoCompraOut)
async def receber_item(
    pedido_id: UUID,
    payload: ReceberItemInput,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    await service.receber_item(db, tenant_id=user.tenant_id, usuario_id=user.id, pedido_id=pedido_id, dados=payload)
    pedido = await service.obter(db, tenant_id=user.tenant_id, pedido_id=pedido_id)
    return pedido


@router.get("/sugestao-reposicao", response_model=list[SugestaoReposicaoOut])
async def sugestao_reposicao(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.sugestao_reposicao(db, tenant_id=user.tenant_id)
