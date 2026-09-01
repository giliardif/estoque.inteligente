from collections.abc import AsyncGenerator

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import PERFIS_SUPERVISOR, CurrentUser, get_current_user, require_perfil
from app.modules.inventario import service
from app.modules.inventario.schemas import (
    AprovacaoFinalOut,
    ConciliacaoOut,
    DecisaoItemIn,
    EnviarAnaliseOut,
    InventarioAbrir,
    InventarioItemContagemIn,
    InventarioOut,
    PainelInventarioOut,
    PainelOperadorOut,
)

router = APIRouter(prefix="/inventario", tags=["inventario"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


# IMPORTANTE: rotas fixas ("/painel", "/aberto") precisam vir ANTES de
# "/{inventario_id}/...", mesma ordem usada nos demais routers com painel.
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


# --- Etapa A: tela de contagem do operador (contagem cega) -----------------

@router.get("/{inventario_id}/operador", response_model=PainelOperadorOut)
async def painel_operador_inventario(
    inventario_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Alimenta a tela de contagem: progresso, resumo (sem/com divergência/
    pendentes) e a lista de itens — nunca inclui qtd_sistema (contagem cega)."""
    return await service.painel_operador(db, tenant_id=user.tenant_id, inventario_id=inventario_id)


@router.patch("/{inventario_id}/itens/{produto_id}", response_model=dict)
async def registrar_contagem_item(
    inventario_id: UUID,
    produto_id: UUID,
    payload: InventarioItemContagemIn,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    item = await service.registrar_contagem_item(
        db, tenant_id=user.tenant_id, inventario_id=inventario_id, produto_id=produto_id, dados=payload
    )
    return {
        "produto_id": item.produto_id,
        "qtd_contada": item.qtd_contada,
        "divergencia": item.divergencia,
        "status_item": item.status_item,
    }


@router.post("/{inventario_id}/enviar-analise", response_model=EnviarAnaliseOut)
async def enviar_inventario_para_analise(
    inventario_id: UUID,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Etapa A: operador conclui a contagem. O ciclo vai para 'em_analise' —
    nenhuma movimentação de estoque é gravada ainda."""
    return await service.enviar_para_analise(db, tenant_id=user.tenant_id, usuario_id=user.id, inventario_id=inventario_id)


# --- Etapa B: conciliação e aprovação do supervisor -------------------------

@router.get("/{inventario_id}/conciliacao", response_model=ConciliacaoOut)
async def obter_conciliacao_inventario(
    inventario_id: UUID,
    user: CurrentUser = Depends(require_perfil(*PERFIS_SUPERVISOR)),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Painel de Conciliação: qtd anterior x contada x diferença x impacto
    financeiro. Restrito a admin (perfil supervisor, quando existir, já
    será aceito automaticamente aqui)."""
    return await service.obter_conciliacao(db, tenant_id=user.tenant_id, inventario_id=inventario_id)


@router.patch("/{inventario_id}/itens/{produto_id}/decisao", response_model=dict)
async def decidir_item_inventario(
    inventario_id: UUID,
    produto_id: UUID,
    payload: DecisaoItemIn,
    user: CurrentUser = Depends(require_perfil(*PERFIS_SUPERVISOR)),
    db: AsyncSession = Depends(get_tenant_db),
):
    item = await service.decidir_item(
        db,
        tenant_id=user.tenant_id,
        usuario_id=user.id,
        inventario_id=inventario_id,
        produto_id=produto_id,
        acao=payload.acao,
    )
    return {"produto_id": item.produto_id, "status_item": item.status_item}


@router.post("/{inventario_id}/aprovar-final", response_model=AprovacaoFinalOut)
async def aprovar_ajuste_final_inventario(
    inventario_id: UUID,
    user: CurrentUser = Depends(require_perfil(*PERFIS_SUPERVISOR)),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Etapa B final: grava as movimentações de ajuste reais (tipo='ajuste')
    e fecha o ciclo. Exige que todo item já tenha sido decidido (aprovado ou
    sem divergência) — nenhum pendente/divergente/recontagem em aberto."""
    return await service.aprovar_final(db, tenant_id=user.tenant_id, usuario_id=user.id, inventario_id=inventario_id)
