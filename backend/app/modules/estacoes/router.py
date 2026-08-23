from collections.abc import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db_auth, get_db_for_tenant
from app.core.security import CurrentEstacao, CurrentUser, get_current_user, require_perfil
from app.modules.estacoes import service
from app.modules.estacoes.schemas import (
    EstacaoImpressaoCreate,
    EstacaoImpressaoOut,
    EstacaoImpressaoRegistradaOut,
    EstacaoImpressaoUpdate,
    FilaImpressaoCreate,
    FilaImpressaoOut,
    FilaImpressaoPendenteOut,
)

router = APIRouter(prefix="/estacoes", tags=["estacoes"])

# Header próprio (não é o Authorization: Bearer do usuário) — a estação
# nunca tem um JWT de usuário, só a própria credencial de dispositivo.
_estacao_token_header = APIKeyHeader(name="X-Estacao-Token", auto_error=True)


async def get_tenant_db(user: CurrentUser = Depends(get_current_user)) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(user.tenant_id):
        yield session


async def get_current_estacao(
    token: str = Security(_estacao_token_header),
) -> CurrentEstacao:
    """Resolve o token opaco de estação via sessão auth_service (bypass
    RLS) — mesma exceção estrutural do login, pois o tenant_id só é
    conhecido depois de encontrar a estação dona do token."""
    async for db_auth in get_db_auth():
        estacao = await service.resolver_estacao_por_token(db_auth, token_bruto=token)
        if not estacao:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Token de estação inválido ou revogado."
            )
        await service.registrar_heartbeat(db_auth, estacao_id=estacao.id)
        return CurrentEstacao(id=estacao.id, tenant_id=estacao.tenant_id, nome=estacao.nome)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token de estação inválido.")


async def get_estacao_tenant_db(
    estacao: CurrentEstacao = Depends(get_current_estacao),
) -> AsyncGenerator[AsyncSession, None]:
    async for session in get_db_for_tenant(estacao.tenant_id):
        yield session


# ------------------------------------------------------------------
# Gestão de estações — usuário autenticado (admin gerencia, qualquer
# perfil pode visualizar, mesmo padrão de "operador vê Usuários em modo
# leitura" já usado no resto do sistema).
# ------------------------------------------------------------------


@router.get("", response_model=list[EstacaoImpressaoOut])
async def listar_estacoes(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.listar_estacoes(db, tenant_id=user.tenant_id)


@router.post("", response_model=EstacaoImpressaoRegistradaOut, status_code=status.HTTP_201_CREATED)
async def registrar_estacao(
    payload: EstacaoImpressaoCreate,
    user: CurrentUser = Depends(require_perfil("admin")),
    db: AsyncSession = Depends(get_tenant_db),
):
    estacao, token = await service.registrar(db, tenant_id=user.tenant_id, criado_por=user.id, dados=payload)
    return {**service.serializar_estacao(estacao), "token": token}


@router.patch("/{estacao_id}", response_model=EstacaoImpressaoOut)
async def atualizar_estacao(
    estacao_id: UUID,
    payload: EstacaoImpressaoUpdate,
    user: CurrentUser = Depends(require_perfil("admin")),
    db: AsyncSession = Depends(get_tenant_db),
):
    estacao = await service.atualizar(db, tenant_id=user.tenant_id, estacao_id=estacao_id, dados=payload)
    if not estacao:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Estação de impressão não encontrada.")
    return service.serializar_estacao(estacao)


@router.post("/{estacao_id}/revogar", status_code=status.HTTP_204_NO_CONTENT)
async def revogar_estacao(
    estacao_id: UUID,
    user: CurrentUser = Depends(require_perfil("admin")),
    db: AsyncSession = Depends(get_tenant_db),
):
    ok = await service.revogar(db, tenant_id=user.tenant_id, estacao_id=estacao_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Estação de impressão não encontrada.")


# ------------------------------------------------------------------
# Fila — usuário autenticado envia/consulta/reimprime. Leitura pode ver,
# só admin/operador enviam (mesmo padrão de etiquetas/modelos).
# ------------------------------------------------------------------


@router.get("/fila", response_model=list[FilaImpressaoOut])
async def listar_fila(
    status_filtro: str | None = None,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.listar_fila(db, tenant_id=user.tenant_id, status_filtro=status_filtro)


@router.post("/fila", response_model=FilaImpressaoOut, status_code=status.HTTP_201_CREATED)
async def criar_job_impressao(
    payload: FilaImpressaoCreate,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    return await service.criar_job(db, tenant_id=user.tenant_id, enviado_por=user.id, dados=payload)


@router.post("/fila/{job_id}/reimprimir", response_model=FilaImpressaoOut, status_code=status.HTTP_201_CREATED)
async def reimprimir_job(
    job_id: UUID,
    user: CurrentUser = Depends(require_perfil("admin", "operador")),
    db: AsyncSession = Depends(get_tenant_db),
):
    novo = await service.reimprimir(db, tenant_id=user.tenant_id, enviado_por=user.id, job_id=job_id)
    if not novo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job de impressão não encontrado.")
    return novo


# ------------------------------------------------------------------
# Endpoints da PRÓPRIA estação — autenticados por X-Estacao-Token, nunca
# por sessão de usuário. GET /fila/pendentes também serve de heartbeat
# (get_current_estacao já registra a atividade antes de chegar aqui).
# ------------------------------------------------------------------


@router.get("/fila/pendentes", response_model=list[FilaImpressaoPendenteOut])
async def listar_pendentes(
    estacao: CurrentEstacao = Depends(get_current_estacao),
    db: AsyncSession = Depends(get_estacao_tenant_db),
):
    return await service.listar_pendentes_da_estacao(db, estacao_id=estacao.id)


@router.post("/fila/{job_id}/concluir", response_model=FilaImpressaoOut)
async def concluir_job(
    job_id: UUID,
    estacao: CurrentEstacao = Depends(get_current_estacao),
    db: AsyncSession = Depends(get_estacao_tenant_db),
):
    job = await service.marcar_status(db, estacao_id=estacao.id, job_id=job_id, novo_status="impresso")
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job de impressão não encontrado.")
    return await service.serializar_job(db, job)


@router.post("/fila/{job_id}/erro", response_model=FilaImpressaoOut)
async def marcar_erro_job(
    job_id: UUID,
    estacao: CurrentEstacao = Depends(get_current_estacao),
    db: AsyncSession = Depends(get_estacao_tenant_db),
):
    job = await service.marcar_status(db, estacao_id=estacao.id, job_id=job_id, novo_status="erro")
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job de impressão não encontrado.")
    return await service.serializar_job(db, job)
