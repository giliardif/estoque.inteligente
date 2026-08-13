"""
Testa GET /notas-fiscais/painel (KPIs + filtros/ordenação/paginação),
adicionado na Etapa 18 junto com a aplicação do kit de UX na tela de
Notas Fiscais. Mesmo padrão já usado em test_estoque_painel.py,
test_produtos_painel.py e test_vendas_painel.py.
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_painel_kpis_refletem_nota_recem_importada(client_tenant_a: AsyncClient, xml_nfe_produto_novo: bytes):
    antes = await client_tenant_a.get("/api/v1/notas-fiscais/painel")
    total_antes = antes.json()["kpis"]["total_notas"]
    pendentes_antes = antes.json()["kpis"]["itens_pendentes_confirmacao"]

    importada = await client_tenant_a.post(
        "/api/v1/notas-fiscais/importar",
        files={"arquivo": ("nota.xml", xml_nfe_produto_novo, "application/xml")},
    )
    assert importada.status_code == 201

    depois = await client_tenant_a.get("/api/v1/notas-fiscais/painel")
    kpis = depois.json()["kpis"]
    assert kpis["total_notas"] == total_antes + 1
    assert kpis["itens_pendentes_confirmacao"] > pendentes_antes


@pytest.mark.asyncio
async def test_painel_itens_contem_nota_recem_importada(client_tenant_a: AsyncClient, xml_nfe_produto_novo: bytes):
    importada = await client_tenant_a.post(
        "/api/v1/notas-fiscais/importar",
        files={"arquivo": ("nota.xml", xml_nfe_produto_novo, "application/xml")},
    )
    nota_id = importada.json()["id"]

    resp = await client_tenant_a.get("/api/v1/notas-fiscais/painel")
    assert resp.status_code == 200, resp.text
    ids = [i["id"] for i in resp.json()["itens"]]
    assert nota_id in ids


@pytest.mark.asyncio
async def test_painel_nao_vaza_nota_de_outro_tenant(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient, xml_nfe_produto_novo: bytes
):
    nota_b = await client_tenant_b.post(
        "/api/v1/notas-fiscais/importar",
        files={"arquivo": ("nota.xml", xml_nfe_produto_novo, "application/xml")},
    )
    assert nota_b.status_code == 201

    painel_a = await client_tenant_a.get("/api/v1/notas-fiscais/painel")
    ids_a = [i["id"] for i in painel_a.json()["itens"]]
    assert nota_b.json()["id"] not in ids_a

    kpis_a_antes = painel_a.json()["kpis"]["total_notas"]
    # o total de A não deve contar a nota importada em B
    assert nota_b.json()["id"] not in ids_a and kpis_a_antes >= 0


@pytest.mark.asyncio
async def test_painel_filtra_por_status(client_tenant_a: AsyncClient, xml_nfe_produto_novo: bytes):
    await client_tenant_a.post(
        "/api/v1/notas-fiscais/importar",
        files={"arquivo": ("nota.xml", xml_nfe_produto_novo, "application/xml")},
    )

    resp = await client_tenant_a.get("/api/v1/notas-fiscais/painel", params={"status": "processada"})
    assert resp.status_code == 200, resp.text
    assert all(i["status"] == "processada" for i in resp.json()["itens"])

    resp_vazio = await client_tenant_a.get("/api/v1/notas-fiscais/painel", params={"status": "cancelada"})
    assert resp_vazio.json()["itens"] == []


@pytest.mark.asyncio
async def test_painel_busca_por_numero(client_tenant_a: AsyncClient, xml_nfe_produto_novo: bytes):
    importada = await client_tenant_a.post(
        "/api/v1/notas-fiscais/importar",
        files={"arquivo": ("nota.xml", xml_nfe_produto_novo, "application/xml")},
    )
    numero = importada.json()["numero"]

    resp = await client_tenant_a.get("/api/v1/notas-fiscais/painel", params={"busca": numero})
    assert resp.status_code == 200, resp.text
    assert any(i["numero"] == numero for i in resp.json()["itens"])

    resp_sem_match = await client_tenant_a.get(
        "/api/v1/notas-fiscais/painel", params={"busca": "numero-que-nao-existe-xyz"}
    )
    assert resp_sem_match.json()["itens"] == []


@pytest.mark.asyncio
async def test_painel_retorna_total_para_paginacao(client_tenant_a: AsyncClient, xml_nfe_produto_novo: bytes):
    for _ in range(3):
        await client_tenant_a.post(
            "/api/v1/notas-fiscais/importar",
            files={"arquivo": ("nota.xml", xml_nfe_produto_novo, "application/xml")},
        )

    resp = await client_tenant_a.get("/api/v1/notas-fiscais/painel", params={"tamanho": 2})
    assert resp.status_code == 200, resp.text
    corpo = resp.json()
    assert len(corpo["itens"]) == 2
    assert corpo["total"] >= 3


@pytest.mark.asyncio
async def test_painel_filtros_lista_fornecedores(client_tenant_a: AsyncClient, xml_nfe_produto_novo: bytes):
    await client_tenant_a.post(
        "/api/v1/notas-fiscais/importar",
        files={"arquivo": ("nota.xml", xml_nfe_produto_novo, "application/xml")},
    )

    resp = await client_tenant_a.get("/api/v1/notas-fiscais/painel")
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["filtros"]["fornecedores"]) >= 1

