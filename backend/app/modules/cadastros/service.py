"""
CRUD simples pros três cadastros de apoio que até a Etapa 11 só existiam no
schema do banco, sem nenhum jeito de criar/editar/excluir via API — o que
deixava os filtros de categoria/depósito/fornecedor do painel de Estoque
praticamente inutilizáveis em produção (só apareciam se alguém inserisse
linha direto no banco).

Sem soft-delete aqui (nenhuma das três tabelas tem coluna `ativo`) — exclusão
é física. Isso é seguro porque nenhuma das FKs que apontam pra essas tabelas
tem ON DELETE CASCADE/SET NULL: o Postgres recusa a exclusão com uma
violação de integridade se a categoria/depósito/fornecedor ainda estiver em
uso, e nós traduzimos isso pra um 409 amigável em vez de deixar vazar um 500.
"""
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Categoria, Deposito, Fornecedor
from app.modules.cadastros.schemas import (
    CategoriaCreate, CategoriaUpdate, DepositoCreate, DepositoUpdate,
    FornecedorCreate, FornecedorUpdate,
)


async def _excluir_com_tratamento(db: AsyncSession, registro, *, nome_entidade: str) -> None:
    await db.delete(registro)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Não é possível excluir: {nome_entidade} ainda está em uso por outro cadastro.",
        )


# --- Categoria ---------------------------------------------------------

async def criar_categoria(db: AsyncSession, *, tenant_id: UUID, dados: CategoriaCreate) -> Categoria:
    categoria = Categoria(tenant_id=tenant_id, nome=dados.nome, categoria_pai_id=dados.categoria_pai_id)
    db.add(categoria)
    await db.commit()
    await db.refresh(categoria)
    return categoria


async def listar_categorias(db: AsyncSession, *, tenant_id: UUID) -> list[Categoria]:
    stmt = select(Categoria).where(Categoria.tenant_id == tenant_id).order_by(Categoria.nome)
    return (await db.execute(stmt)).scalars().all()


async def atualizar_categoria(db: AsyncSession, *, tenant_id: UUID, categoria_id: UUID, dados: CategoriaUpdate) -> Categoria:
    categoria = await db.get(Categoria, categoria_id)
    if not categoria or categoria.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Categoria não encontrada.")
    if dados.nome is not None:
        categoria.nome = dados.nome
    if dados.categoria_pai_id is not None:
        categoria.categoria_pai_id = dados.categoria_pai_id
    await db.commit()
    await db.refresh(categoria)
    return categoria


async def excluir_categoria(db: AsyncSession, *, tenant_id: UUID, categoria_id: UUID) -> None:
    categoria = await db.get(Categoria, categoria_id)
    if not categoria or categoria.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Categoria não encontrada.")
    await _excluir_com_tratamento(db, categoria, nome_entidade="a categoria")


# --- Depósito ------------------------------------------------------------

async def criar_deposito(db: AsyncSession, *, tenant_id: UUID, dados: DepositoCreate) -> Deposito:
    deposito = Deposito(tenant_id=tenant_id, nome=dados.nome, endereco=dados.endereco)
    db.add(deposito)
    await db.commit()
    await db.refresh(deposito)
    return deposito


async def listar_depositos(db: AsyncSession, *, tenant_id: UUID) -> list[Deposito]:
    stmt = select(Deposito).where(Deposito.tenant_id == tenant_id).order_by(Deposito.nome)
    return (await db.execute(stmt)).scalars().all()


async def atualizar_deposito(db: AsyncSession, *, tenant_id: UUID, deposito_id: UUID, dados: DepositoUpdate) -> Deposito:
    deposito = await db.get(Deposito, deposito_id)
    if not deposito or deposito.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Depósito não encontrado.")
    if dados.nome is not None:
        deposito.nome = dados.nome
    if dados.endereco is not None:
        deposito.endereco = dados.endereco
    await db.commit()
    await db.refresh(deposito)
    return deposito


async def excluir_deposito(db: AsyncSession, *, tenant_id: UUID, deposito_id: UUID) -> None:
    deposito = await db.get(Deposito, deposito_id)
    if not deposito or deposito.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Depósito não encontrado.")
    await _excluir_com_tratamento(db, deposito, nome_entidade="o depósito")


# --- Fornecedor ------------------------------------------------------------

async def criar_fornecedor(db: AsyncSession, *, tenant_id: UUID, dados: FornecedorCreate) -> Fornecedor:
    fornecedor = Fornecedor(tenant_id=tenant_id, nome=dados.nome, documento=dados.documento, contato=dados.contato)
    db.add(fornecedor)
    await db.commit()
    await db.refresh(fornecedor)
    return fornecedor


async def listar_fornecedores(db: AsyncSession, *, tenant_id: UUID) -> list[Fornecedor]:
    stmt = select(Fornecedor).where(Fornecedor.tenant_id == tenant_id).order_by(Fornecedor.nome)
    return (await db.execute(stmt)).scalars().all()


async def atualizar_fornecedor(db: AsyncSession, *, tenant_id: UUID, fornecedor_id: UUID, dados: FornecedorUpdate) -> Fornecedor:
    fornecedor = await db.get(Fornecedor, fornecedor_id)
    if not fornecedor or fornecedor.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fornecedor não encontrado.")
    if dados.nome is not None:
        fornecedor.nome = dados.nome
    if dados.documento is not None:
        fornecedor.documento = dados.documento
    if dados.contato is not None:
        fornecedor.contato = dados.contato
    await db.commit()
    await db.refresh(fornecedor)
    return fornecedor


async def excluir_fornecedor(db: AsyncSession, *, tenant_id: UUID, fornecedor_id: UUID) -> None:
    fornecedor = await db.get(Fornecedor, fornecedor_id)
    if not fornecedor or fornecedor.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fornecedor não encontrado.")
    await _excluir_com_tratamento(db, fornecedor, nome_entidade="o fornecedor")
