"""
Testa GET /vendas/mais-vendidos, adicionado na Etapa 35 (redesign do PDV) para
alimentar a trilha "Mais vendidos" na tela de venda. Ranking real por soma de
quantidade em vendas finalizadas — diferente de "giro de estoque" (Painel
Home), que mede outra coisa (velocidade de saída do saldo).
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_mais_vendidos_ordena_por_quantidade_vendida(client_tenant_a: AsyncClient):
    mais = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Mais vendido", "estoque_minimo": 0})
    menos = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Menos vendido", "estoque_minimo": 0})
    mais_id, menos_id = mais.json()["id"], menos.json()["id"]

    for produto_id, qtd in ((mais_id, 20), (menos_id, 3)):
        await client_tenant_a.post(
            "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 50}
        )
        venda = await client_tenant_a.post(
            "/api/v1/vendas",
            json={"itens": [{"produto_id": produto_id, "quantidade": qtd, "preco_unitario": 5.0}]},
        )
        assert venda.status_code == 201, venda.text

    resp = await client_tenant_a.get("/api/v1/vendas/mais-vendidos")
    assert resp.status_code == 200
    ids_no_ranking = [item["produto_id"] for item in resp.json()]
    assert ids_no_ranking.index(mais_id) < ids_no_ranking.index(menos_id)

    item_mais = next(i for i in resp.json() if i["produto_id"] == mais_id)
    assert item_mais["quantidade_vendida"] == 20.0


@pytest.mark.asyncio
async def test_mais_vendidos_ignora_vendas_canceladas(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    venda = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 5, "preco_unitario": 5.0}]},
    )
    venda_id = venda.json()["id"]
    cancelada = await client_tenant_a.post(f"/api/v1/vendas/{venda_id}/cancelar")
    assert cancelada.status_code == 200

    resp = await client_tenant_a.get("/api/v1/vendas/mais-vendidos")
    assert produto_com_saldo_10 not in [item["produto_id"] for item in resp.json()]


@pytest.mark.asyncio
async def test_mais_vendidos_respeita_limite(client_tenant_a: AsyncClient):
    for i in range(3):
        produto = await client_tenant_a.post("/api/v1/produtos", json={"nome": f"Produto {i}", "estoque_minimo": 0})
        produto_id = produto.json()["id"]
        await client_tenant_a.post(
            "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 10}
        )
        await client_tenant_a.post(
            "/api/v1/vendas",
            json={"itens": [{"produto_id": produto_id, "quantidade": 1, "preco_unitario": 5.0}]},
        )

    resp = await client_tenant_a.get("/api/v1/vendas/mais-vendidos?limite=2")
    assert resp.status_code == 200
    assert len(resp.json()) <= 2


@pytest.mark.asyncio
async def test_mais_vendidos_isola_por_tenant(client_tenant_a: AsyncClient, client_tenant_b: AsyncClient):
    produto_b = await client_tenant_b.post("/api/v1/produtos", json={"nome": "Produto tenant B", "estoque_minimo": 0})
    produto_b_id = produto_b.json()["id"]
    await client_tenant_b.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": produto_b_id, "tipo": "entrada", "quantidade": 10}
    )
    await client_tenant_b.post(
        "/api/v1/vendas", json={"itens": [{"produto_id": produto_b_id, "quantidade": 1, "preco_unitario": 5.0}]}
    )

    resp = await client_tenant_a.get("/api/v1/vendas/mais-vendidos")
    assert produto_b_id not in [item["produto_id"] for item in resp.json()]
