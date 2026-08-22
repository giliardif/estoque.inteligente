"""
Regra: toda query filtra por tenant_id explicitamente, mesmo já havendo RLS
no banco — defesa em profundidade (mesmo padrão dos outros módulos).
"""
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import EtiquetaModelo
from app.modules.etiquetas.schemas import EtiquetaModeloCreate, EtiquetaModeloUpdate


async def listar(db: AsyncSession, *, tenant_id: UUID):
    stmt = (
        select(EtiquetaModelo)
        .where(EtiquetaModelo.tenant_id == tenant_id)
        .order_by(EtiquetaModelo.criado_em.desc())
    )
    result = await db.execute(stmt)
    return result.scalars().all()


async def obter(db: AsyncSession, *, tenant_id: UUID, modelo_id: UUID):
    stmt = select(EtiquetaModelo).where(
        EtiquetaModelo.id == modelo_id, EtiquetaModelo.tenant_id == tenant_id
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def criar(db: AsyncSession, *, tenant_id: UUID, dados: EtiquetaModeloCreate) -> EtiquetaModelo:
    modelo = EtiquetaModelo(tenant_id=tenant_id, nome=dados.nome, config_json=dados.config_json)
    db.add(modelo)
    await db.commit()
    await db.refresh(modelo)
    return modelo


async def atualizar(
    db: AsyncSession, *, tenant_id: UUID, modelo_id: UUID, dados: EtiquetaModeloUpdate
) -> EtiquetaModelo | None:
    modelo = await obter(db, tenant_id=tenant_id, modelo_id=modelo_id)
    if not modelo:
        return None
    if dados.nome is not None:
        modelo.nome = dados.nome
    if dados.config_json is not None:
        modelo.config_json = dados.config_json
    modelo.atualizado_em = datetime.utcnow()
    await db.commit()
    await db.refresh(modelo)
    return modelo


async def remover(db: AsyncSession, *, tenant_id: UUID, modelo_id: UUID) -> bool:
    modelo = await obter(db, tenant_id=tenant_id, modelo_id=modelo_id)
    if not modelo:
        return False
    await db.delete(modelo)
    await db.commit()
    return True
