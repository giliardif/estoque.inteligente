"""
Testa o fluxo de abertura/fechamento de inventário e as duas funcionalidades
adicionadas nesta sessão: listagem/histórico e retomada de contagem em aberto.
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_obter_aberto_retorna_null_quando_nao_ha_inventario_em_aberto(client_tenant_a: AsyncClient):
    response = await client_tenant_a.get("/api/v1/inventario/aberto")
    assert response.status_code == 200
    assert response.json() is None


@pytest.mark.asyncio
async def test_obter_aberto_retorna_o_inventario_recem_aberto(client_tenant_a: AsyncClient):
    aberto = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-07"})
    assert aberto.status_code == 201

    response = await client_tenant_a.get("/api/v1/inventario/aberto")
    assert response.status_code == 200
    assert response.json()["id"] == aberto.json()["id"]


@pytest.mark.asyncio
async def test_nao_permite_dois_inventarios_abertos_no_mesmo_deposito(client_tenant_a: AsyncClient):
    primeiro = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-07"})
    assert primeiro.status_code == 201

    segundo = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-07"})
    assert segundo.status_code == 409


@pytest.mark.asyncio
async def test_listar_inventarios_filtra_por_status_fechado(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    inv = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-06"})
    inv_id = inv.json()["id"]
    fechar = await client_tenant_a.post(
        f"/api/v1/inventario/{inv_id}/fechar",
        json={"itens": [{"produto_id": produto_com_saldo_10, "qtd_contada": 10}]},
    )
    assert fechar.status_code == 200

    listagem = await client_tenant_a.get("/api/v1/inventario?status=fechado")
    assert listagem.status_code == 200
    ids = [i["id"] for i in listagem.json()]
    assert inv_id in ids

    listagem_abertos = await client_tenant_a.get("/api/v1/inventario?status=aberto")
    ids_abertos = [i["id"] for i in listagem_abertos.json()]
    assert inv_id not in ids_abertos


@pytest.mark.asyncio
async def test_inventario_aberto_de_outro_tenant_nao_e_retomado(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient
):
    # Tenant B abre um inventário; tenant A não pode enxergá-lo em /aberto —
    # mesmo teste de isolamento por RLS aplicado nos outros módulos.
    aberto_b = await client_tenant_b.post("/api/v1/inventario", json={"ciclo": "2026-07"})
    assert aberto_b.status_code == 201

    resposta_a = await client_tenant_a.get("/api/v1/inventario/aberto")
    assert resposta_a.status_code == 200
    assert resposta_a.json() is None or resposta_a.json()["id"] != aberto_b.json()["id"]


@pytest.mark.asyncio
async def test_listar_inventarios_nao_vaza_de_outro_tenant(client_tenant_a: AsyncClient, client_tenant_b: AsyncClient):
    aberto_b = await client_tenant_b.post("/api/v1/inventario", json={"ciclo": "2026-08"})
    assert aberto_b.status_code == 201

    listagem_a = await client_tenant_a.get("/api/v1/inventario")
    ids_a = [i["id"] for i in listagem_a.json()]
    assert aberto_b.json()["id"] not in ids_a


@pytest.mark.asyncio
async def test_perfil_leitura_nao_abre_inventario(client_leitura: AsyncClient):
    response = await client_leitura.post("/api/v1/inventario", json={"ciclo": "2026-07"})
    assert response.status_code == 403
