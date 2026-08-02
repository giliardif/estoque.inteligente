import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_receber_quantidade_maior_que_pedido_e_rejeitado(client_tenant_a: AsyncClient, pedido_com_item_10un: dict):
    response = await client_tenant_a.post(
        f"/api/v1/compras/pedidos/{pedido_com_item_10un['pedido_id']}/receber",
        json={"item_id": pedido_com_item_10un["item_id"], "quantidade_recebida": 15},
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_receber_item_de_pedido_de_outro_tenant_e_bloqueado(client_tenant_a: AsyncClient, pedido_tenant_b: dict):
    response = await client_tenant_a.post(
        f"/api/v1/compras/pedidos/{pedido_tenant_b['pedido_id']}/receber",
        json={"item_id": pedido_tenant_b["item_id"], "quantidade_recebida": 1},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_perfil_leitura_nao_cria_pedido(client_leitura: AsyncClient, produto_com_saldo_10: str):
    response = await client_leitura.post(
        "/api/v1/compras/pedidos",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 10, "custo_unitario": 5.0}]},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_recebimento_gera_entrada_de_estoque(client_tenant_a: AsyncClient, pedido_com_item_10un: dict):
    saldo_antes = await client_tenant_a.get(
        f"/api/v1/estoque/produtos/{pedido_com_item_10un['produto_id']}/saldo"
    )
    await client_tenant_a.post(
        f"/api/v1/compras/pedidos/{pedido_com_item_10un['pedido_id']}/receber",
        json={"item_id": pedido_com_item_10un["item_id"], "quantidade_recebida": 4},
    )
    saldo_depois = await client_tenant_a.get(
        f"/api/v1/estoque/produtos/{pedido_com_item_10un['produto_id']}/saldo"
    )
    assert saldo_depois.json()["saldo"] == saldo_antes.json()["saldo"] + 4


@pytest.mark.asyncio
async def test_sugestao_reposicao_nao_inclui_produto_com_saldo_suficiente(
    client_tenant_a: AsyncClient, produto_com_saldo_acima_do_minimo: str
):
    response = await client_tenant_a.get("/api/v1/compras/sugestao-reposicao")
    ids = [s["produto_id"] for s in response.json()]
    assert produto_com_saldo_acima_do_minimo not in ids
