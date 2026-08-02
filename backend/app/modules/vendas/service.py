"""
Venda finalizada = baixa automática de estoque, um item por vez, reaproveitando
estoque.service.registrar() (mesma regra de saldo nunca-negativo se aplica aqui).

Limitação conhecida (documentada, não escondida): como cada movimentação faz
seu próprio commit, uma venda com múltiplos itens não é 100% atômica se o
processo cair no meio. Mitigado validando o saldo de TODOS os itens antes de
registrar qualquer movimentação — reduz a janela de risco a quase zero, mas
não elimina falha catastrófica no meio da gravação. Ação futura: mover
`estoque.service.registrar` para aceitar uma sessão sem commit interno e
commitar só uma vez no fim da venda inteira.
"""
from datetime import date, datetime, time, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Produto, Venda, VendaItem
from app.modules.estoque import service as estoque_service
from app.modules.estoque.schemas import MovimentacaoCreate
from app.modules.vendas.schemas import VendaCreate


async def finalizar(db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, dados: VendaCreate) -> Venda:
    # 1) validação prévia: todo item precisa existir e ter saldo suficiente
    for item in dados.itens:
        produto = await db.get(Produto, item.produto_id)
        if not produto or produto.tenant_id != tenant_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Produto {item.produto_id} não encontrado."
            )
        saldo = await estoque_service.calcular_saldo_atual(db, tenant_id=tenant_id, produto_id=item.produto_id)
        if saldo < item.quantidade:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Saldo insuficiente para {produto.nome}. Disponível: {saldo}, solicitado: {item.quantidade}.",
            )

    # 2) cria a venda e os itens
    valor_total = sum(item.quantidade * item.preco_unitario for item in dados.itens)
    venda = Venda(tenant_id=tenant_id, status="finalizada", valor_total=valor_total, usuario_id=usuario_id)
    db.add(venda)
    await db.flush()

    for item in dados.itens:
        db.add(
            VendaItem(
                tenant_id=tenant_id, venda_id=venda.id, produto_id=item.produto_id,
                quantidade=item.quantidade, preco_unitario=item.preco_unitario,
            )
        )

    await db.commit()

    # 3) baixa de estoque — uma movimentação de saída por item, já validada acima
    for item in dados.itens:
        await estoque_service.registrar(
            db, tenant_id=tenant_id, usuario_id=usuario_id,
            dados=MovimentacaoCreate(
                produto_id=item.produto_id, tipo="saida", quantidade=item.quantidade,
                origem="Venda / PDV", referencia_externa=f"Venda {venda.id}",
            ),
        )

    # Carrega venda.itens explicitamente (selectinload) antes de retornar.
    # SEM isso, o Pydantic tenta acessar venda.itens durante a serialização da
    # resposta — fora do contexto assíncrono do SQLAlchemy — e quebra com
    # "MissingGreenlet". Relacionamentos lazy nunca podem ser acessados após
    # a função async terminar; sempre carregar explicitamente antes de retornar.
    venda_completa = await obter(db, tenant_id=tenant_id, venda_id=venda.id)
    return venda_completa


async def obter(db: AsyncSession, *, tenant_id: UUID, venda_id: UUID) -> Venda | None:
    stmt = (
        select(Venda)
        .where(Venda.id == venda_id, Venda.tenant_id == tenant_id)
        .options(selectinload(Venda.itens))
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def listar(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    data_inicio: date | None = None,
    data_fim: date | None = None,
    pagina: int = 1,
    tamanho: int = 25,
) -> list[Venda]:
    # tenant_id sempre no WHERE mesmo com RLS ativo (defesa em profundidade,
    # mesmo padrão usado em produtos.service.listar) — nunca confiar só na
    # sessão/RLS para o filtro de isolamento.
    stmt = select(Venda).where(Venda.tenant_id == tenant_id).options(selectinload(Venda.itens))

    if data_inicio:
        stmt = stmt.where(Venda.criado_em >= datetime.combine(data_inicio, time.min, tzinfo=timezone.utc))
    if data_fim:
        # fim do dia inclusive — filtro por >= início e <= fim do mesmo dia
        stmt = stmt.where(Venda.criado_em <= datetime.combine(data_fim, time.max, tzinfo=timezone.utc))

    stmt = stmt.order_by(Venda.criado_em.desc()).offset((pagina - 1) * tamanho).limit(tamanho)
    return (await db.execute(stmt)).scalars().all()
