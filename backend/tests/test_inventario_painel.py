"""
Testa GET /inventario/painel (KPIs + filtros/ordenação/paginação), adicionado
na Etapa 20 junto com a aplicação do kit de UX na tela de Inventário. Mesmo
padrão de test_compras_painel.py / test_notas_fiscais_painel.py.
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_painel_kpis_refletem_inventario_aberto(client_tenant_a: AsyncClient):
    antes = await client_tenant_a.get("/api/v1/inventario/painel")
    total_antes = antes.json()["kpis"]["total_inventarios"]
    abertos_antes = antes.json()["kpis"]["inventarios_abertos"]

    aberto = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-08"})
    assert aberto.status_code == 201

    depois = await client_tenant_a.get("/api/v1/inventario/painel")
    kpis = depois.json()["kpis"]
    assert kpis["total_inventarios"] == total_antes + 1
    assert kpis["inventarios_abertos"] == abertos_antes + 1


@pytest.mark.asyncio
async def test_painel_reflete_itens_divergentes_apos_fechamento(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-08"})
    inv_id = inv.json()["id"]

    fechar = await client_tenant_a.post(
        f"/api/v1/inventario/{inv_id}/fechar",
        json={"itens": [{"produto_id": produto_com_saldo_10, "qtd_contada": 7}]},  # diverge de 10 -> 7
    )
    assert fechar.status_code == 200

    resp = await client_tenant_a.get("/api/v1/inventario/painel")
    assert resp.status_code == 200, resp.text
    item = next(i for i in resp.json()["itens"] if i["id"] == inv_id)
    assert item["qtd_itens_contados"] == 1
    assert item["qtd_divergentes"] == 1
    assert item["status"] == "fechado"
    assert resp.json()["kpis"]["itens_divergentes"] >= 1


@pytest.mark.asyncio
async def test_painel_nao_conta_divergencia_quando_contagem_bate(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-08"})
    inv_id = inv.json()["id"]

    await client_tenant_a.post(
        f"/api/v1/inventario/{inv_id}/fechar",
        json={"itens": [{"produto_id": produto_com_saldo_10, "qtd_contada": 10}]},  # bate com o saldo
    )

    resp = await client_tenant_a.get("/api/v1/inventario/painel")
    item = next(i for i in resp.json()["itens"] if i["id"] == inv_id)
    assert item["qtd_divergentes"] == 0


@pytest.mark.asyncio
async def test_painel_nao_vaza_inventario_de_outro_tenant(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient
):
    de_b = await client_tenant_b.post("/api/v1/inventario", json={"ciclo": "2026-08"})
    assert de_b.status_code == 201

    painel_a = await client_tenant_a.get("/api/v1/inventario/painel")
    ids_a = [i["id"] for i in painel_a.json()["itens"]]
    assert de_b.json()["id"] not in ids_a


@pytest.mark.asyncio
async def test_painel_filtra_por_status(client_tenant_a: AsyncClient):
    aberto = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-08"})
    aberto_id = aberto.json()["id"]

    resp = await client_tenant_a.get("/api/v1/inventario/painel", params={"status": "aberto"})
    assert resp.status_code == 200, resp.text
    ids = [i["id"] for i in resp.json()["itens"]]
    assert aberto_id in ids
    assert all(i["status"] == "aberto" for i in resp.json()["itens"])

    resp_fechados = await client_tenant_a.get("/api/v1/inventario/painel", params={"status": "fechado"})
    ids_fechados = [i["id"] for i in resp_fechados.json()["itens"]]
    assert aberto_id not in ids_fechados


@pytest.mark.asyncio
async def test_painel_busca_por_ciclo(client_tenant_a: AsyncClient):
    aberto = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-08"})

    resp = await client_tenant_a.get("/api/v1/inventario/painel", params={"busca": "2026-08"})
    assert resp.status_code == 200, resp.text
    ids = [i["id"] for i in resp.json()["itens"]]
    assert aberto.json()["id"] in ids

    resp_sem_match = await client_tenant_a.get("/api/v1/inventario/painel", params={"busca": "1999-01"})
    assert resp_sem_match.json()["itens"] == []


@pytest.mark.asyncio
async def test_painel_retorna_total_para_paginacao(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    # Só pode haver 1 inventário aberto por depósito por vez — fecha cada um
    # antes de abrir o próximo pra não esbarrar nessa regra de negócio.
    for ciclo in ["2026-01", "2026-02", "2026-03"]:
        aberto = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": ciclo})
        assert aberto.status_code == 201
        fechar = await client_tenant_a.post(
            f"/api/v1/inventario/{aberto.json()['id']}/fechar",
            json={"itens": [{"produto_id": produto_com_saldo_10, "qtd_contada": 10}]},
        )
        assert fechar.status_code == 200

    resp = await client_tenant_a.get("/api/v1/inventario/painel", params={"tamanho": 2})
    assert resp.status_code == 200, resp.text
    corpo = resp.json()
    assert len(corpo["itens"]) == 2
    assert corpo["total"] >= 3
