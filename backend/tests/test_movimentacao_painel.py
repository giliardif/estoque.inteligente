"""
Testa GET /estoque/movimentacoes/painel (KPIs + filtros/ordenação/paginação),
adicionado na Etapa 22 junto com a aplicação do kit de UX na tela de
Movimentação — a última do rollout. Mesmo padrão de
test_alertas_painel.py / test_inventario_painel.py.
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_painel_kpis_refletem_movimentacoes(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    resp = await client_tenant_a.get("/api/v1/estoque/movimentacoes/painel")
    assert resp.status_code == 200, resp.text
    kpis = resp.json()["kpis"]
    assert kpis["entradas"] >= 1
    assert kpis["total_movimentacoes"] >= 1

    saida = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": produto_com_saldo_10, "tipo": "saida", "quantidade": 3}
    )
    assert saida.status_code == 201

    depois = await client_tenant_a.get("/api/v1/estoque/movimentacoes/painel")
    kpis_depois = depois.json()["kpis"]
    assert kpis_depois["saidas"] == kpis["saidas"] + 1
    assert kpis_depois["total_movimentacoes"] == kpis["total_movimentacoes"] + 1


@pytest.mark.asyncio
async def test_painel_itens_traz_nome_do_produto(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    resp = await client_tenant_a.get("/api/v1/estoque/movimentacoes/painel")
    assert resp.status_code == 200, resp.text
    item = next(i for i in resp.json()["itens"] if i["produto_id"] == produto_com_saldo_10)
    assert item["produto_nome"] == "Produto com saldo 10"
    assert item["tipo"] == "entrada"
    assert item["quantidade"] == 10


@pytest.mark.asyncio
async def test_painel_nao_vaza_movimentacao_de_outro_tenant(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient
):
    produto_b = await client_tenant_b.post("/api/v1/produtos", json={"nome": "Produto B", "estoque_minimo": 1})
    mov_b = await client_tenant_b.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto_b.json()["id"], "tipo": "entrada", "quantidade": 5},
    )
    assert mov_b.status_code == 201

    resp = await client_tenant_a.get("/api/v1/estoque/movimentacoes/painel")
    ids = [i["id"] for i in resp.json()["itens"]]
    assert mov_b.json()[0]["id"] not in ids


@pytest.mark.asyncio
async def test_painel_filtra_por_tipo(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": produto_com_saldo_10, "tipo": "saida", "quantidade": 2}
    )

    resp = await client_tenant_a.get("/api/v1/estoque/movimentacoes/painel", params={"tipo": "saida"})
    assert resp.status_code == 200, resp.text
    assert all(i["tipo"] == "saida" for i in resp.json()["itens"])

    resp_entrada = await client_tenant_a.get("/api/v1/estoque/movimentacoes/painel", params={"tipo": "entrada"})
    assert all(i["tipo"] == "entrada" for i in resp_entrada.json()["itens"])


@pytest.mark.asyncio
async def test_painel_busca_por_nome_de_produto(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    resp = await client_tenant_a.get(
        "/api/v1/estoque/movimentacoes/painel", params={"busca": "Produto com saldo 10"}
    )
    assert resp.status_code == 200, resp.text
    ids = [i["produto_id"] for i in resp.json()["itens"]]
    assert produto_com_saldo_10 in ids

    resp_sem_match = await client_tenant_a.get(
        "/api/v1/estoque/movimentacoes/painel", params={"busca": "produto-que-nao-existe-xyz"}
    )
    assert resp_sem_match.json()["itens"] == []


@pytest.mark.asyncio
async def test_painel_filtros_lista_produtos_ativos(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    resp = await client_tenant_a.get("/api/v1/estoque/movimentacoes/painel")
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["filtros"]["produtos"]) >= 1


@pytest.mark.asyncio
async def test_painel_retorna_total_para_paginacao(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    for _ in range(3):
        r = await client_tenant_a.post(
            "/api/v1/estoque/movimentacoes",
            json={"produto_id": produto_com_saldo_10, "tipo": "saida", "quantidade": 1},
        )
        assert r.status_code == 201

    resp = await client_tenant_a.get("/api/v1/estoque/movimentacoes/painel", params={"tamanho": 2})
    assert resp.status_code == 200, resp.text
    corpo = resp.json()
    assert len(corpo["itens"]) == 2
    assert corpo["total"] >= 4  # 1 entrada da fixture + 3 saídas
