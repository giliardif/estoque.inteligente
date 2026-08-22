from collections.abc import AsyncGenerator

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_for_tenant
from app.core.security import CurrentUser, get_current_user, require_perfil
from app.core.storage import enviar_imagem_produto
from app.modules.produtos import service
from app.modules.produtos.schemas import (
    PainelProdutosOut, ProdutoCreate, ProdutoImportConfirmarIn, ProdutoImportPreviewOut,
    ProdutoImportResultadoOut, ProdutoOut, ProdutoUpdate,
)

router = APIRouter(prefix="/produtos", tags=["produtos"])


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


@router.get("", response_model=list[ProdutoOut])
async def listar_produtos(
    busca: str | None = Query(default=None, max_length=200),
    pagina: int = Query(default=1, ge=1),
    tamanho: int = Query(default=25, ge=1, le=100),  # limite superior evita DoS por paginação gigante
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.listar(db, tenant_id=user.tenant_id, busca=busca, pagina=pagina, tamanho=tamanho)


@router.get("/painel", response_model=PainelProdutosOut)
async def painel_produtos(
    busca: str | None = Query(default=None, max_length=200),
    categoria_id: UUID | None = None,
    status: str | None = Query(default=None, pattern="^(ativo|inativo)$"),
    ordenar_por: str = Query(default="nome"),
    direcao: str = Query(default="asc", pattern="^(asc|desc)$"),
    pagina: int = Query(default=1, ge=1),
    tamanho: int = Query(default=25, ge=1, le=100),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    status_ativo = True if status is None else (status == "ativo")
    return await service.painel(
        db, tenant_id=user.tenant_id, busca=busca, categoria_id=categoria_id, status_ativo=status_ativo,
        ordenar_por=ordenar_por, direcao=direcao, pagina=pagina, tamanho=tamanho,
    )


@router.post("/importar/preview", response_model=ProdutoImportPreviewOut)
async def preview_importacao_produtos(
    arquivo: UploadFile = File(...),
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    settings = get_settings()
    conteudo = await arquivo.read()
    limite_bytes = settings.MAX_IMPORT_PRODUTOS_SIZE_MB * 1024 * 1024
    if len(conteudo) > limite_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Arquivo excede o limite de {settings.MAX_IMPORT_PRODUTOS_SIZE_MB}MB.",
        )
    return await service.preview_importacao(
        db, tenant_id=user.tenant_id, nome_arquivo=arquivo.filename or "",
        conteudo=conteudo, max_linhas=settings.MAX_IMPORT_PRODUTOS_LINHAS,
    )


@router.post("/importar/confirmar", response_model=ProdutoImportResultadoOut)
async def confirmar_importacao_produtos(
    payload: ProdutoImportConfirmarIn,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.confirmar_importacao(db, tenant_id=user.tenant_id, linhas=payload.linhas)


@router.get("/buscar-codigo", response_model=ProdutoOut)
async def buscar_produto_por_codigo(
    codigo: str = Query(min_length=1, max_length=64),
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    # Usado pelo scanner (câmera ou leitor físico) em Vendas/Estoque/
    # Inventário: recebe o código lido bruto e resolve pro produto exato via
    # codigo_barras OU sku (mesma dupla usada na busca unificada de listar(),
    # mas aqui exigindo igualdade exata — ver rationale em service.buscar_por_codigo).
    produto = await service.buscar_por_codigo(db, tenant_id=user.tenant_id, codigo=codigo)
    if not produto:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nenhum produto encontrado para esse código.")
    return produto


@router.get("/{produto_id}", response_model=ProdutoOut)
async def obter_produto(
    produto_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    produto = await service.obter(db, tenant_id=user.tenant_id, produto_id=produto_id)
    if not produto:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Produto não encontrado.")
    return produto


@router.post("", response_model=ProdutoOut, status_code=status.HTTP_201_CREATED)
async def criar_produto(
    payload: ProdutoCreate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),  # leitura não pode escrever
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.criar(db, tenant_id=user.tenant_id, dados=payload)


@router.patch("/{produto_id}", response_model=ProdutoOut)
async def atualizar_produto(
    produto_id: UUID,
    payload: ProdutoUpdate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    produto = await service.atualizar(db, tenant_id=user.tenant_id, produto_id=produto_id, dados=payload)
    if not produto:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Produto não encontrado.")
    return produto


@router.post("/{produto_id}/imagem", response_model=ProdutoOut)
async def enviar_imagem(
    produto_id: UUID,
    arquivo: UploadFile = File(...),
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    produto_existente = await service.obter(db, tenant_id=user.tenant_id, produto_id=produto_id)
    if not produto_existente:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Produto não encontrado.")
    url = await enviar_imagem_produto(tenant_id=user.tenant_id, produto_id=produto_id, arquivo=arquivo)
    return await service.definir_imagem(db, tenant_id=user.tenant_id, produto_id=produto_id, imagem_url=url)


@router.delete("/{produto_id}", status_code=status.HTTP_204_NO_CONTENT)
async def desativar_produto(
    produto_id: UUID,
    user: CurrentUser = Depends(require_perfil("admin")),  # só admin desativa produto
    db: AsyncSession = Depends(get_tenant_db),
):
    ok = await service.desativar(db, tenant_id=user.tenant_id, produto_id=produto_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Produto não encontrado.")
