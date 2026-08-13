"""
Testa GET /alertas/painel (KPIs + filtros/busca/paginação), adicionado na
Etapa 21 junto com a aplicação do kit de UX na tela de Alertas. Mesmo
padrão de test_inventario_painel.py / test_compras_painel.py.
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_painel_kpis_refletem_alerta_gerado(client_tenant_a: AsyncClient, produto_estoque_zerado: str):
    antes = await client_tenant_a.get("/api/v1/alertas/painel")
    total_antes = antes.json()["kpis"]["total_ativos"]
    estoque_baixo_antes = antes.json()["kpis"]["estoque_baixo"]

    executar = await client_tenant_a.post("/api/v1/alertas/executar")
    assert executar.status_code == 200

    depois = await client_tenant_a.get("/api/v1/alertas/painel")
    kpis = depois.json()["kpis"]
    assert kpis["total_ativos"] >= total_antes + 1
    assert kpis["estoque_baixo"] >= estoque_baixo_antes + 1


@pytest.mark.asyncio
async def test_painel_itens_contem_alerta_gerado_com_nome_do_produto(
    client_tenant_a: AsyncClient, produto_estoque_zerado: str
):
    await client_tenant_a.post("/api/v1/alertas/executar")

    resp = await client_tenant_a.get("/api/v1/alertas/painel")
    assert resp.status_code == 200, resp.text
    # produto sem movimentação e sem saldo dispara também "produto_parado" —
    # filtra por tipo pra não depender de qual alerta veio primeiro na lista.
    item = next(
        i for i in resp.json()["itens"]
        if i["produto_id"] == produto_estoque_zerado and i["tipo"] == "estoque_baixo"
    )
    assert item["produto_nome"] == "Produto zerado"
    assert item["lido"] is False


@pytest.mark.asyncio
async def test_painel_kpi_nao_conta_alerta_ja_lido(client_tenant_a: AsyncClient, produto_estoque_zerado: str):
    await client_tenant_a.post("/api/v1/alertas/executar")
    lista = await client_tenant_a.get("/api/v1/alertas/painel")
    alerta_id = next(i["id"] for i in lista.json()["itens"] if i["produto_id"] == produto_estoque_zerado)

    antes = lista.json()["kpis"]["total_ativos"]
    await client_tenant_a.post(f"/api/v1/alertas/{alerta_id}/marcar-lido")

    depois = await client_tenant_a.get("/api/v1/alertas/painel")
    assert depois.json()["kpis"]["total_ativos"] == antes - 1


@pytest.mark.asyncio
async def test_painel_filtra_por_status_lido(client_tenant_a: AsyncClient, produto_estoque_zerado: str):
    await client_tenant_a.post("/api/v1/alertas/executar")
    lista = await client_tenant_a.get("/api/v1/alertas/painel")
    alerta_id = next(i["id"] for i in lista.json()["itens"] if i["produto_id"] == produto_estoque_zerado)
    await client_tenant_a.post(f"/api/v1/alertas/{alerta_id}/marcar-lido")

    resp_lidos = await client_tenant_a.get("/api/v1/alertas/painel", params={"status": "lido"})
    assert resp_lidos.status_code == 200, resp_lidos.text
    ids_lidos = [i["id"] for i in resp_lidos.json()["itens"]]
    assert alerta_id in ids_lidos
    assert all(i["lido"] for i in resp_lidos.json()["itens"])

    resp_nao_lidos = await client_tenant_a.get("/api/v1/alertas/painel", params={"status": "nao_lido"})
    ids_nao_lidos = [i["id"] for i in resp_nao_lidos.json()["itens"]]
    assert alerta_id not in ids_nao_lidos


@pytest.mark.asyncio
async def test_painel_filtra_por_tipo(client_tenant_a: AsyncClient, produto_estoque_zerado: str):
    await client_tenant_a.post("/api/v1/alertas/executar")

    resp = await client_tenant_a.get("/api/v1/alertas/painel", params={"tipo": "estoque_baixo"})
    assert resp.status_code == 200, resp.text
    assert all(i["tipo"] == "estoque_baixo" for i in resp.json()["itens"])

    resp_vazio = await client_tenant_a.get("/api/v1/alertas/painel", params={"tipo": "validade"})
    assert all(i["tipo"] == "validade" for i in resp_vazio.json()["itens"])


@pytest.mark.asyncio
async def test_painel_busca_por_nome_de_produto(client_tenant_a: AsyncClient, produto_estoque_zerado: str):
    await client_tenant_a.post("/api/v1/alertas/executar")

    resp = await client_tenant_a.get("/api/v1/alertas/painel", params={"busca": "zerado"})
    assert resp.status_code == 200, resp.text
    ids = [i["produto_id"] for i in resp.json()["itens"]]
    assert produto_estoque_zerado in ids

    resp_sem_match = await client_tenant_a.get("/api/v1/alertas/painel", params={"busca": "produto-que-nao-existe-xyz"})
    assert resp_sem_match.json()["itens"] == []


@pytest.mark.asyncio
async def test_painel_nao_vaza_alerta_de_outro_tenant(client_tenant_a: AsyncClient, alerta_tenant_b_id: str):
    resp = await client_tenant_a.get("/api/v1/alertas/painel")
    assert resp.status_code == 200, resp.text
    ids = [i["id"] for i in resp.json()["itens"]]
    assert alerta_tenant_b_id not in ids
