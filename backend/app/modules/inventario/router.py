from collections.abc import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Depends, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import PERFIS_SUPERVISOR, CurrentUser, get_current_user, require_perfil
from app.core.storage import enviar_anexo_inventario
from app.modules.inventario import service
from app.modules.inventario.schemas import (
    AprovacaoFinalOut,
    ConciliacaoOut,
    DecisaoItemIn,
    DetalheCicloOut,
    EnviarAnaliseOut,
    InventarioAbrir,
    InventarioItemContagemIn,
    InventarioOut,
    JustificativaIn,
    PainelInventarioOut,
    PainelOperadorOut,
    ResultadoContagemOut,
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
    return await service.obter_aberto(db, tenant_id=user.tenant_id, deposito_id=deposito_id)


# --- Etapa A: tela de contagem do operador (contagem cega) -----------------

@router.get("/{inventario_id}/operador", response_model=PainelOperadorOut)
async def painel_operador_inventario(
    inventario_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.painel_operador(db, tenant_id=user.tenant_id, inventario_id=inventario_id)


@router.patch("/{inventario_id}/itens/{produto_id}/contagem", response_model=ResultadoContagemOut)
async def registrar_contagem_item(
    inventario_id: UUID,
    produto_id: UUID,
    payload: InventarioItemContagemIn,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Cada chamada é uma tentativa (logada) — o frontend só chama isso
    quando o operador aperta 'Confirmar' na linha, nunca a cada +/-."""
    item = await service.registrar_contagem_item(
        db, tenant_id=user.tenant_id, usuario_id=user.id, inventario_id=inventario_id, produto_id=produto_id,
        dados=payload,
    )
    return {
        "produto_id": item.produto_id,
        "status_item": item.status_item,
        "tentativas": item.tentativas,
        "limite_atingido": item.tentativas >= 3,
    }


@router.post("/{inventario_id}/itens/{produto_id}/manter-divergencia", response_model=ResultadoContagemOut)
async def manter_divergencia_item(
    inventario_id: UUID,
    produto_id: UUID,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Operador decide não recontar mais — aceita a última contagem como
    divergência final, sem consumir mais uma tentativa."""
    item = await service.manter_divergencia(
        db, tenant_id=user.tenant_id, inventario_id=inventario_id, produto_id=produto_id
    )
    return {
        "produto_id": item.produto_id,
        "status_item": item.status_item,
        "tentativas": item.tentativas,
        "limite_atingido": True,
    }


@router.patch("/{inventario_id}/itens/{produto_id}/justificativa", response_model=dict)
async def justificar_item_inventario(
    inventario_id: UUID,
    produto_id: UUID,
    payload: JustificativaIn,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Só pode ser chamado depois do item já estar finalizado como
    divergente — nunca durante a digitação da contagem."""
    item = await service.registrar_justificativa(
        db, tenant_id=user.tenant_id, inventario_id=inventario_id, produto_id=produto_id, dados=payload
    )
    return {"produto_id": item.produto_id, "motivo": item.motivo, "anexo_url": item.anexo_url}


@router.post("/{inventario_id}/itens/{produto_id}/anexo", response_model=dict)
async def enviar_anexo_item_inventario(
    inventario_id: UUID,
    produto_id: UUID,
    arquivo: UploadFile,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
):
    url = await enviar_anexo_inventario(
        tenant_id=user.tenant_id, inventario_id=inventario_id, produto_id=produto_id, arquivo=arquivo
    )
    return {"anexo_url": url}


@router.post("/{inventario_id}/cancelar", response_model=InventarioOut)
async def cancelar_ciclo_inventario(
    inventario_id: UUID,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Descarta um ciclo aberto sem nenhuma contagem — ex: aberto antes de
    existir produto no tenant, ou aberto por engano."""
    return await service.cancelar_ciclo(db, tenant_id=user.tenant_id, inventario_id=inventario_id)


@router.post("/{inventario_id}/enviar-analise", response_model=EnviarAnaliseOut)
async def enviar_inventario_para_analise(
    inventario_id: UUID,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.enviar_para_analise(db, tenant_id=user.tenant_id, usuario_id=user.id, inventario_id=inventario_id)


# --- Etapa B: conciliação e aprovação do supervisor -------------------------

@router.get("/{inventario_id}/conciliacao", response_model=ConciliacaoOut)
async def obter_conciliacao_inventario(
    inventario_id: UUID,
    user: CurrentUser = Depends(require_perfil(*PERFIS_SUPERVISOR)),
    db: AsyncSession = Depends(get_tenant_db),
):
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
        db, tenant_id=user.tenant_id, usuario_id=user.id, inventario_id=inventario_id, produto_id=produto_id,
        acao=payload.acao,
    )
    return {"produto_id": item.produto_id, "status_item": item.status_item}


@router.post("/{inventario_id}/aprovar-final", response_model=AprovacaoFinalOut)
async def aprovar_ajuste_final_inventario(
    inventario_id: UUID,
    user: CurrentUser = Depends(require_perfil(*PERFIS_SUPERVISOR)),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.aprovar_final(db, tenant_id=user.tenant_id, usuario_id=user.id, inventario_id=inventario_id)


# --- Detalhes do ciclo (histórico, qualquer status) -------------------------

@router.get("/{inventario_id}/detalhe", response_model=DetalheCicloOut)
async def obter_detalhe_ciclo(
    inventario_id: UUID,
    user: CurrentUser = Depends(require_perfil(*PERFIS_SUPERVISOR)),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Tela de Detalhes do Ciclo: consultável a qualquer momento (inclusive
    depois de fechado), com o log completo de tentativas por item."""
    return await service.obter_detalhe_ciclo(db, tenant_id=user.tenant_id, inventario_id=inventario_id)
