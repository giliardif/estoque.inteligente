"""
Testa GET /produtos/painel — endpoint dedicado à tela de Produtos com o
kit de UX (paginação real com total, filtro de categoria, status
ativo/inativo, ordenação de coluna). Separado de GET /produtos "cru" de
propósito: aquele já é consumido por 5 outras telas como dropdown simples
de seleção de produto, e mudar seu contrato quebraria todas elas.
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient


@pytest_asyncio.fixture
async def tenant_a_id(client_tenant_a):
    import base64
    import json

    token = client_tenant_a.headers["Authorization"].split(" ")[1]
    payload = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    return payload["tenant_id"]


@pytest.mark.asyncio
async def test_painel_retorna_total_para_paginacao(client_tenant_a: AsyncClient):
    for i in range(5):
        await client_tenant_a.post("/api/v1/produtos", json={"nome": f"Produto Painel {i}"})

    resp = await client_tenant_a.get("/api/v1/produtos/painel", params={"busca": "Produto Painel", "tamanho": 2})
    assert resp.status_code == 200, resp.text
    corpo = resp.json()
    assert len(corpo["itens"]) == 2
    assert corpo["total"] == 5
    assert corpo["pagina"] == 1


@pytest.mark.asyncio
async def test_painel_so_mostra_ativos_por_padrao(client_tenant_a: AsyncClient):
    ativo = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto Ativo Painel"})
    inativo = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto Inativo Painel"})
    await client_tenant_a.delete(f"/api/v1/produtos/{inativo.json()['id']}")

    resp = await client_tenant_a.get("/api/v1/produtos/painel", params={"busca": "Painel"})
    nomes = [p["nome"] for p in resp.json()["itens"]]
    assert "Produto Ativo Painel" in nomes
    assert "Produto Inativo Painel" not in nomes


@pytest.mark.asyncio
async def test_painel_status_inativo_mostra_so_desativados(client_tenant_a: AsyncClient):
    inativo = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Vai Desativar Painel"})
    await client_tenant_a.delete(f"/api/v1/produtos/{inativo.json()['id']}")
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Continua Ativo Painel"})

    resp = await client_tenant_a.get("/api/v1/produtos/painel", params={"busca": "Painel", "status": "inativo"})
    nomes = [p["nome"] for p in resp.json()["itens"]]
    assert nomes == ["Vai Desativar Painel"]


@pytest.mark.asyncio
async def test_painel_filtra_por_categoria_e_retorna_categoria_nome(client_tenant_a: AsyncClient, tenant_a_id: str):
    categoria = await client_tenant_a.post("/api/v1/categorias", json={"nome": "Trufas Painel"})
    categoria_id = categoria.json()["id"]
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Com Categoria Painel", "categoria_id": categoria_id})
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Sem Categoria Painel"})

    resp = await client_tenant_a.get("/api/v1/produtos/painel", params={"categoria_id": categoria_id})
    itens = resp.json()["itens"]
    assert [i["nome"] for i in itens] == ["Com Categoria Painel"]
    assert itens[0]["categoria_nome"] == "Trufas Painel"


@pytest.mark.asyncio
async def test_painel_ordena_por_custo_medio_desc(client_tenant_a: AsyncClient):
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Barato Painel", "custo_medio": 1.0})
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Caro Painel", "custo_medio": 99.0})

    resp = await client_tenant_a.get(
        "/api/v1/produtos/painel", params={"busca": "Painel", "ordenar_por": "custo_medio", "direcao": "desc"}
    )
    nomes = [p["nome"] for p in resp.json()["itens"]]
    assert nomes.index("Caro Painel") < nomes.index("Barato Painel")


@pytest.mark.asyncio
async def test_painel_filtros_categorias_isolado_por_tenant(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient, tenant_a_id: str
):
    await client_tenant_a.post("/api/v1/categorias", json={"nome": "Só do Tenant A Painel"})

    resp = await client_tenant_b.get("/api/v1/produtos/painel")
    nomes = [c["nome"] for c in resp.json()["filtros"]["categorias"]]
    assert "Só do Tenant A Painel" not in nomes


@pytest.mark.asyncio
async def test_painel_nao_vaza_produto_de_outro_tenant(client_tenant_a: AsyncClient, produto_tenant_b_id: str):
    resp = await client_tenant_a.get("/api/v1/produtos/painel")
    ids = [i["id"] for i in resp.json()["itens"]]
    assert produto_tenant_b_id not in ids
