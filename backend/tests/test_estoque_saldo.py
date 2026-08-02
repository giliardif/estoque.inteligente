"""
Testa a regra de negócio mais crítica do módulo de Estoque: o saldo de
um produto nunca pode ficar negativo, mesmo sob concorrência.
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_saida_maior_que_saldo_e_rejeitada(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    response = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto_com_saldo_10, "tipo": "saida", "quantidade": 15},
    )
    assert response.status_code == 409  # conflito: saldo insuficiente
    saldo = await client_tenant_a.get(f"/api/v1/estoque/produtos/{produto_com_saldo_10}/saldo")
    assert saldo.json()["saldo"] == 10  # saldo não foi alterado pela tentativa rejeitada


@pytest.mark.asyncio
async def test_saldo_geral_reflete_produto_abaixo_do_minimo(client_tenant_a: AsyncClient):
    produto = await client_tenant_a.post(
        "/api/v1/produtos", json={"nome": "Produto Baixo Estoque", "estoque_minimo": 20}
    )
    produto_id = produto.json()["id"]
    entrada = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 5}
    )
    assert entrada.status_code == 201

    saldo = await client_tenant_a.get("/api/v1/estoque/saldo")
    assert saldo.status_code == 200
    item = next((s for s in saldo.json() if s["produto_id"] == produto_id), None)
    assert item is not None
    assert item["saldo"] == 5
    assert item["abaixo_do_minimo"] is True
    # Sem depósito informado na movimentação, a lista de posições vem vazia —
    # é assim que a tela de Estoque decide esconder a coluna "Posição" pra
    # quem não usa múltiplos depósitos.
    assert item["posicoes"] == []


@pytest.mark.asyncio
async def test_saldo_geral_nao_vaza_produto_de_outro_tenant(
    client_tenant_a: AsyncClient, produto_tenant_b_id: str
):
    saldo_a = await client_tenant_a.get("/api/v1/estoque/saldo")
    ids_a = [s["produto_id"] for s in saldo_a.json()]
    assert produto_tenant_b_id not in ids_a


@pytest.mark.asyncio
async def test_ajuste_negativo_maior_que_saldo_e_rejeitado(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    response = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={
            "produto_id": produto_com_saldo_10, "tipo": "ajuste",
            "quantidade": 20, "direcao": "negativo",
        },
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_quantidade_negativa_e_rejeitada_na_validacao(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    """Usuário não pode contornar a regra enviando quantidade negativa diretamente."""
    response = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto_com_saldo_10, "tipo": "entrada", "quantidade": -5},
    )
    assert response.status_code == 422  # Pydantic rejeita antes de chegar na regra de negócio


@pytest.mark.asyncio
async def test_perfil_leitura_nao_registra_movimentacao(client_leitura: AsyncClient, produto_com_saldo_10: str):
    response = await client_leitura.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto_com_saldo_10, "tipo": "entrada", "quantidade": 5},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_duas_saidas_concorrentes_nao_zeram_estoque_abaixo_de_zero(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    """
    Simula corrida: duas saídas de 8 unidades cada, quase simultâneas, num
    produto com saldo 10. Sem o lock de linha (FOR UPDATE), ambas poderiam
    ler saldo=10 antes de qualquer commit e passar na validação — resultando
    em saldo final de -6. Com o lock, a segunda deve ser rejeitada.
    """
    import asyncio

    payload = {"produto_id": produto_com_saldo_10, "tipo": "saida", "quantidade": 8}
    r1, r2 = await asyncio.gather(
        client_tenant_a.post("/api/v1/estoque/movimentacoes", json=payload),
        client_tenant_a.post("/api/v1/estoque/movimentacoes", json=payload),
    )
    status_codes = sorted([r1.status_code, r2.status_code])
    assert status_codes == [201, 409]  # uma passa, a outra é bloqueada por saldo insuficiente
