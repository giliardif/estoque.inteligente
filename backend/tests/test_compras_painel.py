"""
Testa GET /compras/painel (KPIs + filtros/ordenação/paginação), adicionado
na Etapa 19 junto com a aplicação do kit de UX na tela de Compras. Mesmo
padrão de test_notas_fiscais_painel.py / test_vendas_painel.py.
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_painel_kpis_refletem_pedido_criado(client_tenant_a: AsyncClient, pedido_com_item_10un: dict):
    resp = await client_tenant_a.get("/api/v1/compras/painel")
    assert resp.status_code == 200, resp.text
    kpis = resp.json()["kpis"]
    assert kpis["total_pedidos"] >= 1
    assert kpis["pedidos_em_aberto"] >= 1
    assert kpis["valor_total_pedidos"] >= 25.0  # 10un * 2.5


@pytest.mark.asyncio
async def test_painel_itens_contem_pedido_criado(client_tenant_a: AsyncClient, pedido_com_item_10un: dict):
    resp = await client_tenant_a.get("/api/v1/compras/painel")
    assert resp.status_code == 200, resp.text
    ids = [i["id"] for i in resp.json()["itens"]]
    assert pedido_com_item_10un["pedido_id"] in ids


@pytest.mark.asyncio
async def test_painel_reflete_recebimento_parcial(client_tenant_a: AsyncClient, pedido_com_item_10un: dict):
    await client_tenant_a.post(
        f"/api/v1/compras/pedidos/{pedido_com_item_10un['pedido_id']}/receber",
        json={"item_id": pedido_com_item_10un["item_id"], "quantidade_recebida": 4},
    )
    resp = await client_tenant_a.get("/api/v1/compras/painel")
    item = next(i for i in resp.json()["itens"] if i["id"] == pedido_com_item_10un["pedido_id"])
    assert item["status"] == "recebido_parcial"
    assert item["quantidade_pendente"] == 6


@pytest.mark.asyncio
async def test_painel_nao_vaza_pedido_de_outro_tenant(
    client_tenant_a: AsyncClient, pedido_tenant_b: dict
):
    resp = await client_tenant_a.get("/api/v1/compras/painel")
    assert resp.status_code == 200, resp.text
    ids = [i["id"] for i in resp.json()["itens"]]
    assert pedido_tenant_b["pedido_id"] not in ids


@pytest.mark.asyncio
async def test_painel_filtra_por_status(client_tenant_a: AsyncClient, pedido_com_item_10un: dict):
    resp = await client_tenant_a.get("/api/v1/compras/painel", params={"status": "rascunho"})
    assert resp.status_code == 200, resp.text
    assert all(i["status"] == "rascunho" for i in resp.json()["itens"])

    resp_vazio = await client_tenant_a.get("/api/v1/compras/painel", params={"status": "recebido"})
    assert pedido_com_item_10un["pedido_id"] not in [i["id"] for i in resp_vazio.json()["itens"]]


@pytest.mark.asyncio
async def test_painel_retorna_total_para_paginacao(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    for _ in range(3):
        resp = await client_tenant_a.post(
            "/api/v1/compras/pedidos",
            json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 1, "custo_unitario": 1.0}]},
        )
        assert resp.status_code == 201, resp.text

    resp = await client_tenant_a.get("/api/v1/compras/painel", params={"tamanho": 2})
    assert resp.status_code == 200, resp.text
    corpo = resp.json()
    assert len(corpo["itens"]) == 2
    assert corpo["total"] >= 3


@pytest.mark.asyncio
async def test_painel_qtd_itens_e_valor_total_corretos(client_tenant_a: AsyncClient, pedido_com_item_10un: dict):
    resp = await client_tenant_a.get("/api/v1/compras/painel")
    item = next(i for i in resp.json()["itens"] if i["id"] == pedido_com_item_10un["pedido_id"])
    assert item["qtd_itens"] == 1
    assert item["valor_total"] == 25.0
