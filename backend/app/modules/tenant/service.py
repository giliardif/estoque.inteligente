"""
IMPORTANTE: a tabela `tenants` não tem Row Level Security (decisão já
registrada — SQL desenhado mas não aplicado, ver DEVLOG). Isso significa
que, diferente de todo outro módulo do sistema, não existe uma rede de
segurança do banco aqui: se uma query neste service esquecer o filtro por
`id`, ela pode retornar ou alterar dados de QUALQUER tenant, não só do
tenant autenticado. Por isso toda query abaixo filtra por
`Tenant.id == tenant_id` explicitamente, mesmo parecendo redundante já
que só existe um tenant por vez neste fluxo.
"""
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Tenant
from app.modules.tenant.schemas import TenantUpdate


async def obter(db: AsyncSession, *, tenant_id: UUID) -> Tenant:
    tenant = (
        await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant não encontrado.")
    return tenant


async def atualizar(db: AsyncSession, *, tenant_id: UUID, dados: TenantUpdate) -> Tenant:
    if dados.nome is None and dados.cnpj is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nenhuma alteração informada.")

    tenant = await obter(db, tenant_id=tenant_id)

    # Limitação conhecida: como cnpj="" é normalizado para None no schema
    # (ver TenantUpdate.cnpj_valido), não dá pra distinguir "não enviei
    # cnpj neste PATCH" de "quero limpar o cnpj" — os dois chegam aqui
    # como None. Não é um caso de uso pedido até agora; se precisar,
    # trocar TenantUpdate.cnpj para um sentinel (ex.: PydanticUndefined
    # via model_fields_set) em vez de None.
    if dados.nome is not None:
        tenant.nome = dados.nome
    if dados.cnpj is not None:
        tenant.cnpj = dados.cnpj

    await db.commit()
    await db.refresh(tenant)
    return tenant
