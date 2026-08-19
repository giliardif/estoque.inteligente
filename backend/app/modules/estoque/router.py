from collections.abc import AsyncGenerator

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.modules.estoque import service
from app.modules.estoque.schemas import (
    MovimentacaoCreate,
    MovimentacaoOut,
    PainelEstoqueOut,
    PainelMovimentacaoOut,
    SaldoProdutoOut,
)

router = APIRouter(prefix="/estoque", tags=["estoque"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


@router.post("/movimentacoes", response_model=list[MovimentacaoOut], status_code=201)
async def registrar_movimentacao(
    payload: MovimentacaoCreate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.registrar(db, tenant_id=user.tenant_id, usuario_id=user.id, dados=payload)


# IMPORTANTE: "/movimentacoes/painel" precisa vir ANTES de qualquer rota
# parametrizada equivalente — mesma ordem usada nos demais routers com painel.
@router.get("/movimentacoes/painel", response_model=PainelMovimentacaoOut)
async def painel_movimentacoes(
    tipo_filtro: str | None = Query(default=None, alias="tipo"),
    produto_id: UUID | None = Query(default=None),
    busca: str | None = Query(default=None, max_length=200),
    ordenar_por: str = Query(default="criado_em"),
    direcao: str = Query(default="desc", pattern="^(asc|desc)$"),
    pagina: int = Query(default=1, ge=1),
    tamanho: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.painel_movimentacoes(
        db, tenant_id=user.tenant_id, tipo_filtro=tipo_filtro, produto_id=produto_id, busca=busca,
        ordenar_por=ordenar_por, direcao=direcao, pagina=pagina, tamanho=tamanho,
    )


@router.get("/movimentacoes", response_model=list[MovimentacaoOut])
async def listar_movimentacoes(
    produto_id: UUID | None = None,
    pagina: int = Query(default=1, ge=1),
    tamanho: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.historico(db, tenant_id=user.tenant_id, produto_id=produto_id, pagina=pagina, tamanho=tamanho)


@router.get("/saldo", response_model=list[SaldoProdutoOut])
async def saldo_geral(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.saldo_geral(db, tenant_id=user.tenant_id)


ORDENAVEIS = {"nome", "sku", "saldo", "custo_medio", "preco_venda", "valor_total_custo", "estoque_minimo", "criado_em"}


@router.get("/painel", response_model=PainelEstoqueOut)
async def painel_estoque(
    busca: str | None = Query(default=None, max_length=200),
    categoria_id: UUID | None = None,
    deposito_id: UUID | None = None,
    fornecedor_id: UUID | None = None,
    status: str | None = Query(default=None, pattern="^(ativo|inativo)$"),
    somente_abaixo_minimo: bool = False,
    somente_vencimento_proximo: bool = False,
    somente_sem_estoque: bool = False,
    ordenar_por: str = Query(default="nome"),
    direcao: str = Query(default="asc", pattern="^(asc|desc)$"),
    pagina: int = Query(default=1, ge=1),
    tamanho: int = Query(default=50, ge=1, le=200),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    if ordenar_por not in ORDENAVEIS:
        ordenar_por = "nome"
    # Mesmo padrão já usado em produtos.listar(): só produtos ativos por
    # padrão. "status=inativo" é a forma explícita de ver os desativados.
    status_ativo = True if status is None else (status == "ativo")
    return await service.painel(
        db, tenant_id=user.tenant_id, busca=busca, categoria_id=categoria_id,
        deposito_id=deposito_id, fornecedor_id=fornecedor_id, status_ativo=status_ativo,
        somente_abaixo_minimo=somente_abaixo_minimo, somente_vencimento_proximo=somente_vencimento_proximo,
        somente_sem_estoque=somente_sem_estoque, ordenar_por=ordenar_por, direcao=direcao,
        pagina=pagina, tamanho=tamanho,
    )


@router.get("/produtos/{produto_id}/saldo")
async def saldo_produto(
    produto_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    saldo = await service.calcular_saldo_atual(db, tenant_id=user.tenant_id, produto_id=produto_id)
    return {"produto_id": produto_id, "saldo": saldo}
