from collections.abc import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.modules.cadastros import service
from app.modules.cadastros.schemas import (
    CategoriaCreate, CategoriaOut, CategoriaUpdate, DepositoCreate, DepositoOut, DepositoUpdate,
    FornecedorCreate, FornecedorOut, FornecedorUpdate,
)

router = APIRouter(tags=["cadastros"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


# --- Categorias ---------------------------------------------------------

@router.get("/categorias", response_model=list[CategoriaOut])
async def listar_categorias(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_tenant_db)):
    return await service.listar_categorias(db, tenant_id=user.tenant_id)


@router.post("/categorias", response_model=CategoriaOut, status_code=status.HTTP_201_CREATED)
async def criar_categoria(
    payload: CategoriaCreate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.criar_categoria(db, tenant_id=user.tenant_id, dados=payload)


@router.patch("/categorias/{categoria_id}", response_model=CategoriaOut)
async def atualizar_categoria(
    categoria_id: UUID,
    payload: CategoriaUpdate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.atualizar_categoria(db, tenant_id=user.tenant_id, categoria_id=categoria_id, dados=payload)


@router.delete("/categorias/{categoria_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_categoria(
    categoria_id: UUID,
    user: CurrentUser = Depends(require_perfil("admin")),
    db: AsyncSession = Depends(get_tenant_db),
):
    await service.excluir_categoria(db, tenant_id=user.tenant_id, categoria_id=categoria_id)


# --- Depósitos ------------------------------------------------------------

@router.get("/depositos", response_model=list[DepositoOut])
async def listar_depositos(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_tenant_db)):
    return await service.listar_depositos(db, tenant_id=user.tenant_id)


@router.post("/depositos", response_model=DepositoOut, status_code=status.HTTP_201_CREATED)
async def criar_deposito(
    payload: DepositoCreate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.criar_deposito(db, tenant_id=user.tenant_id, dados=payload)


@router.patch("/depositos/{deposito_id}", response_model=DepositoOut)
async def atualizar_deposito(
    deposito_id: UUID,
    payload: DepositoUpdate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.atualizar_deposito(db, tenant_id=user.tenant_id, deposito_id=deposito_id, dados=payload)


@router.delete("/depositos/{deposito_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_deposito(
    deposito_id: UUID,
    user: CurrentUser = Depends(require_perfil("admin")),
    db: AsyncSession = Depends(get_tenant_db),
):
    await service.excluir_deposito(db, tenant_id=user.tenant_id, deposito_id=deposito_id)


# --- Fornecedores ------------------------------------------------------------

@router.get("/fornecedores", response_model=list[FornecedorOut])
async def listar_fornecedores(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_tenant_db)):
    return await service.listar_fornecedores(db, tenant_id=user.tenant_id)


@router.post("/fornecedores", response_model=FornecedorOut, status_code=status.HTTP_201_CREATED)
async def criar_fornecedor(
    payload: FornecedorCreate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.criar_fornecedor(db, tenant_id=user.tenant_id, dados=payload)


@router.patch("/fornecedores/{fornecedor_id}", response_model=FornecedorOut)
async def atualizar_fornecedor(
    fornecedor_id: UUID,
    payload: FornecedorUpdate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.atualizar_fornecedor(db, tenant_id=user.tenant_id, fornecedor_id=fornecedor_id, dados=payload)


@router.delete("/fornecedores/{fornecedor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_fornecedor(
    fornecedor_id: UUID,
    user: CurrentUser = Depends(require_perfil("admin")),
    db: AsyncSession = Depends(get_tenant_db),
):
    await service.excluir_fornecedor(db, tenant_id=user.tenant_id, fornecedor_id=fornecedor_id)
