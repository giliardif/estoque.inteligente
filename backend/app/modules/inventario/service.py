"""
Fechar um inventário gera automaticamente movimentações de ajuste para
cada divergência — reaproveitando o mesmo `estoque.service.registrar()`
usado pelo módulo de Estoque, em vez de duplicar a lógica de saldo aqui.
Isso é o princípio da arquitetura modular aplicado na prática: um módulo
novo reaproveita o núcleo em vez de reescrever regra de negócio.
"""
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Inventario, InventarioItem, Movimentacao, Produto
from app.modules.estoque import service as estoque_service
from app.modules.estoque.schemas import MovimentacaoCreate
from app.modules.inventario.schemas import InventarioFechar


async def abrir(db: AsyncSession, *, tenant_id: UUID, deposito_id: UUID | None, ciclo: str) -> Inventario:
    # Regra: só um inventário "aberto" por depósito por vez, evita duas contagens conflitantes
    stmt = select(Inventario).where(
        Inventario.tenant_id == tenant_id, Inventario.deposito_id == deposito_id, Inventario.status == "aberto"
    )
    existente = (await db.execute(stmt)).scalar_one_or_none()
    if existente:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Já existe um inventário aberto para este depósito.",
        )

    inventario = Inventario(tenant_id=tenant_id, deposito_id=deposito_id, ciclo=ciclo, status="aberto")
    db.add(inventario)
    await db.commit()
    await db.refresh(inventario)
    return inventario


async def fechar(
    db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, inventario_id: UUID, dados: InventarioFechar
) -> Inventario:
    inventario = await db.get(Inventario, inventario_id)
    if not inventario or inventario.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventário não encontrado.")
    if inventario.status == "fechado":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Inventário já está fechado.")

    for item in dados.itens:
        produto = await db.get(Produto, item.produto_id)
        if not produto or produto.tenant_id != tenant_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Produto {item.produto_id} não encontrado."
            )

        saldo_sistema = await estoque_service.calcular_saldo_atual(
            db, tenant_id=tenant_id, produto_id=item.produto_id
        )
        divergencia = item.qtd_contada - saldo_sistema

        db.add(
            InventarioItem(
                inventario_id=inventario_id,
                produto_id=item.produto_id,
                qtd_sistema=saldo_sistema,
                qtd_contada=item.qtd_contada,
                divergencia=divergencia,
            )
        )

        if divergencia != 0:
            await estoque_service.registrar(
                db,
                tenant_id=tenant_id,
                usuario_id=usuario_id,
                dados=MovimentacaoCreate(
                    produto_id=item.produto_id,
                    tipo="ajuste",
                    quantidade=abs(divergencia),
                    direcao="positivo" if divergencia > 0 else "negativo",
                    origem=f"Ajuste automático — fechamento de inventário {inventario.ciclo}",
                ),
            )

    inventario.status = "fechado"
    await db.commit()
    await db.refresh(inventario)
    return inventario


async def listar_itens(db: AsyncSession, *, tenant_id: UUID, inventario_id: UUID):
    inventario = await db.get(Inventario, inventario_id)
    if not inventario or inventario.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventário não encontrado.")
    stmt = select(InventarioItem).where(InventarioItem.inventario_id == inventario_id)
    result = await db.execute(stmt)
    return result.scalars().all()


async def listar(
    db: AsyncSession, *, tenant_id: UUID, status_filtro: str | None = None, pagina: int = 1, tamanho: int = 25
) -> list[Inventario]:
    stmt = select(Inventario).where(Inventario.tenant_id == tenant_id)  # defesa em profundidade além do RLS
    if status_filtro:
        stmt = stmt.where(Inventario.status == status_filtro)
    stmt = stmt.order_by(Inventario.criado_em.desc()).offset((pagina - 1) * tamanho).limit(tamanho)
    return (await db.execute(stmt)).scalars().all()


async def obter_aberto(db: AsyncSession, *, tenant_id: UUID, deposito_id: UUID | None) -> Inventario | None:
    """Usado pelo frontend ao carregar a tela de Inventário, para retomar uma
    contagem em andamento em vez de perdê-la caso a página seja recarregada."""
    stmt = select(Inventario).where(
        Inventario.tenant_id == tenant_id, Inventario.deposito_id == deposito_id, Inventario.status == "aberto"
    )
    return (await db.execute(stmt)).scalar_one_or_none()
