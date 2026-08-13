from collections.abc import AsyncGenerator

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.modules.alertas import service
from app.modules.alertas.schemas import AlertaOut, PainelAlertasOut, RegraAlertaCreate, RegraAlertaOut, RegraAlertaUpdate

router = APIRouter(prefix="/alertas", tags=["alertas"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


# IMPORTANTE: "/painel" precisa vir ANTES de "/{alerta_id}/marcar-lido",
# mesma ordem usada nos demais routers com painel.
@router.get("/painel", response_model=PainelAlertasOut)
async def painel_alertas(
    tipo_filtro: str | None = Query(default=None, alias="tipo"),
    status_filtro: str | None = Query(default=None, alias="status", pattern="^(lido|nao_lido)$"),
    busca: str | None = Query(default=None, max_length=200),
    pagina: int = Query(default=1, ge=1),
    tamanho: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.painel(
        db, tenant_id=user.tenant_id, tipo_filtro=tipo_filtro, status_filtro=status_filtro, busca=busca,
        pagina=pagina, tamanho=tamanho,
    )


@router.post("/regras", response_model=RegraAlertaOut, status_code=201)
async def criar_regra(
    payload: RegraAlertaCreate,
    user: CurrentUser = Depends(require_perfil("admin")),  # só admin configura regras
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.criar_regra(db, tenant_id=user.tenant_id, dados=payload)


@router.get("/regras", response_model=list[RegraAlertaOut])
async def listar_regras(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.listar_regras(db, tenant_id=user.tenant_id)


@router.patch("/regras/{regra_id}", response_model=RegraAlertaOut)
async def atualizar_regra(
    regra_id: UUID,
    payload: RegraAlertaUpdate,
    user: CurrentUser = Depends(require_perfil("admin")),  # mesma restrição da criação
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.atualizar_regra(db, tenant_id=user.tenant_id, regra_id=regra_id, dados=payload)


@router.post("/executar", response_model=list[AlertaOut])
async def executar_motor(
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Em produção isso roda via job agendado; exposto aqui também para execução manual."""
    return await service.executar_motor(db, tenant_id=user.tenant_id)


@router.get("", response_model=list[AlertaOut])
async def listar_alertas(
    apenas_nao_lidos: bool = Query(default=True),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.listar_alertas(db, tenant_id=user.tenant_id, apenas_nao_lidos=apenas_nao_lidos)


@router.post("/{alerta_id}/marcar-lido", response_model=AlertaOut)
async def marcar_lido(
    alerta_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    alerta = await service.marcar_lido(db, tenant_id=user.tenant_id, alerta_id=alerta_id)
    if not alerta:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alerta não encontrado.")
    return alerta
