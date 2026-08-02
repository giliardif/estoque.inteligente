"""
Testa o módulo de Produtos, com foco no campo `sku` recém-adicionado:
normalização, busca unificada (nome/sku/código de barras) e isolamento
entre tenants — o mesmo padrão de defesa em profundidade usado no resto
do projeto (filtro explícito por tenant_id, RLS como última camada).
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_sku_e_normalizado_para_maiusculas_sem_espacos(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post(
        "/api/v1/produtos", json={"nome": "Bombom Trufado", "sku": "  bbt-01 "}
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["sku"] == "BBT-01"


@pytest.mark.asyncio
async def test_sku_vazio_vira_none(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post(
        "/api/v1/produtos", json={"nome": "Produto sem SKU", "sku": "   "}
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["sku"] is None


@pytest.mark.asyncio
async def test_sku_e_opcional(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto qualquer"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["sku"] is None


@pytest.mark.asyncio
async def test_atualizar_sku_via_patch_tambem_normaliza(client_tenant_a: AsyncClient):
    criado = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Caixa de Bombom"})
    produto_id = criado.json()["id"]

    resp = await client_tenant_a.patch(f"/api/v1/produtos/{produto_id}", json={"sku": "cxb-500g"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["sku"] == "CXB-500G"


@pytest.mark.asyncio
async def test_busca_unificada_encontra_produto_por_sku(client_tenant_a: AsyncClient):
    await client_tenant_a.post(
        "/api/v1/produtos", json={"nome": "Trufa de Maracujá", "sku": "TRF-MAR-01"}
    )
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Outro Produto Qualquer"})

    resp = await client_tenant_a.get("/api/v1/produtos", params={"busca": "TRF-MAR"})
    assert resp.status_code == 200
    nomes = [p["nome"] for p in resp.json()]
    assert nomes == ["Trufa de Maracujá"]


@pytest.mark.asyncio
async def test_busca_unificada_encontra_produto_por_codigo_de_barras(client_tenant_a: AsyncClient):
    await client_tenant_a.post(
        "/api/v1/produtos",
        json={"nome": "Bala de Goma", "codigo_barras": "7891234567890"},
    )

    resp = await client_tenant_a.get("/api/v1/produtos", params={"busca": "7891234567890"})
    assert resp.status_code == 200
    nomes = [p["nome"] for p in resp.json()]
    assert nomes == ["Bala de Goma"]


@pytest.mark.asyncio
async def test_busca_unificada_ainda_encontra_produto_por_nome(client_tenant_a: AsyncClient):
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Pirulito Recheado", "sku": "PIR-01"})

    resp = await client_tenant_a.get("/api/v1/produtos", params={"busca": "Pirulito"})
    assert resp.status_code == 200
    nomes = [p["nome"] for p in resp.json()]
    assert nomes == ["Pirulito Recheado"]


@pytest.mark.asyncio
async def test_dois_produtos_podem_ter_o_mesmo_sku_por_ora(client_tenant_a: AsyncClient):
    """
    Documenta o comportamento atual (decisão registrada na migration 007):
    SKU não tem constraint de unicidade, mesmo padrão já usado em
    codigo_barras. Isso é intencional por ora — não um bug.
    """
    primeiro = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto A", "sku": "DUP-01"})
    segundo = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto B", "sku": "DUP-01"})
    assert primeiro.status_code == 201
    assert segundo.status_code == 201


@pytest.mark.asyncio
async def test_sku_de_um_tenant_nao_vaza_na_busca_do_outro(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient
):
    await client_tenant_b.post("/api/v1/produtos", json={"nome": "Produto do Tenant B", "sku": "TB-SKU-01"})

    resp = await client_tenant_a.get("/api/v1/produtos", params={"busca": "TB-SKU-01"})
    assert resp.status_code == 200
    assert resp.json() == []
