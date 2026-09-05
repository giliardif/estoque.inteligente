from collections.abc import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.db.models import InsightGerado, Produto
from app.modules.compras import service as compras_service
from app.modules.compras.schemas import ItemPedidoInput, PedidoCompraCreate, PedidoCompraOut
from app.modules.inteligencia import service
from app.modules.inteligencia.schemas import CriarPedidoReposicaoInput, PainelInteligenciaOut

router = APIRouter(prefix="/inteligencia", tags=["inteligencia"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


@router.get("/painel", response_model=PainelInteligenciaOut)
async def painel(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.obter_painel(db, tenant_id=user.tenant_id)


@router.post("/analisar", response_model=PainelInteligenciaOut)
async def analisar(
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.rodar_analise(db, tenant_id=user.tenant_id)


@router.post("/reposicao/criar-pedido", response_model=PedidoCompraOut, status_code=201)
async def criar_pedido_de_reposicao(
    payload: CriarPedidoReposicaoInput,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    """Cria um pedido de compra real a partir da última sugestão calculada
    pela camada analista — não recalcula na hora, usa o que já está
    persistido em insights_gerados (o que o usuário viu na tela)."""
    stmt = select(InsightGerado).where(
        InsightGerado.tenant_id == user.tenant_id,
        InsightGerado.tipo == "reposicao",
        InsightGerado.produto_id == payload.produto_id,
    )
    insight = (await db.execute(stmt)).scalar_one_or_none()
    if insight is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Nenhuma sugestão de reposição calculada para este produto ainda — rode a análise primeiro.",
        )

    quantidade_sugerida = insight.dados_calculados.get("quantidade_sugerida", 0)
    if quantidade_sugerida <= 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Quantidade sugerida é zero para este produto.")

    produto = await db.get(Produto, payload.produto_id)
    if produto is None or produto.tenant_id != user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Produto não encontrado.")

    dados_pedido = PedidoCompraCreate(
        fornecedor_id=payload.fornecedor_id,
        itens=[
            ItemPedidoInput(
                produto_id=produto.id,
                quantidade=quantidade_sugerida,
                custo_unitario=float(produto.custo_medio) or 0.01,
            )
        ],
    )
    return await compras_service.criar_pedido(db, tenant_id=user.tenant_id, usuario_id=user.id, dados=dados_pedido)
