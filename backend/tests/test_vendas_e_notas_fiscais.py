import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_venda_com_saldo_insuficiente_e_rejeitada_sem_baixar_estoque(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    response = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 50, "preco_unitario": 5.0}]},
    )
    assert response.status_code == 409
    saldo = await client_tenant_a.get(f"/api/v1/estoque/produtos/{produto_com_saldo_10}/saldo")
    assert saldo.json()["saldo"] == 10  # nada foi baixado


@pytest.mark.asyncio
async def test_venda_nao_acessa_produto_de_outro_tenant(client_tenant_a: AsyncClient, produto_tenant_b_id: str):
    response = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_tenant_b_id, "quantidade": 1, "preco_unitario": 1.0}]},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_perfil_leitura_nao_finaliza_venda(client_leitura: AsyncClient, produto_com_saldo_10: str):
    response = await client_leitura.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 1, "preco_unitario": 1.0}]},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_listar_vendas_retorna_venda_recem_criada(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    criada = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 2, "preco_unitario": 5.0}]},
    )
    assert criada.status_code == 201
    venda_id = criada.json()["id"]

    listagem = await client_tenant_a.get("/api/v1/vendas")
    assert listagem.status_code == 200
    ids = [v["id"] for v in listagem.json()]
    assert venda_id in ids


@pytest.mark.asyncio
async def test_listar_vendas_nao_vaza_venda_de_outro_tenant(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient, produto_tenant_b_id: str
):
    # Cria uma venda no tenant B e confirma que o tenant A não a enxerga na listagem —
    # mesmo teste de isolamento por RLS aplicado nos outros módulos (ver test_tenant_isolation.py).
    entrada = await client_tenant_b.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto_tenant_b_id, "tipo": "entrada", "quantidade": 5},
    )
    assert entrada.status_code == 201, entrada.text

    venda_b = await client_tenant_b.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_tenant_b_id, "quantidade": 1, "preco_unitario": 3.0}]},
    )
    assert venda_b.status_code == 201
    venda_b_id = venda_b.json()["id"]

    listagem_a = await client_tenant_a.get("/api/v1/vendas")
    assert listagem_a.status_code == 200
    ids_a = [v["id"] for v in listagem_a.json()]
    assert venda_b_id not in ids_a


@pytest.mark.asyncio
async def test_venda_com_preco_zero_ou_negativo_e_rejeitada_na_validacao(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    response = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 1, "preco_unitario": -5.0}]},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_importar_nota_gera_item_pendente_quando_produto_nao_existe(client_tenant_a: AsyncClient, xml_nfe_produto_novo: bytes):
    response = await client_tenant_a.post(
        "/api/v1/notas-fiscais/importar",
        files={"arquivo": ("nota.xml", xml_nfe_produto_novo, "application/xml")},
    )
    assert response.status_code == 201
    nota_id = response.json()["id"]
    itens = await client_tenant_a.get(f"/api/v1/notas-fiscais/{nota_id}/itens")
    assert all(item["status_match"] == "pendente_cadastro" for item in itens.json())


@pytest.mark.asyncio
async def test_listar_notas_retorna_nota_recem_importada_com_pendentes(
    client_tenant_a: AsyncClient, xml_nfe_produto_novo: bytes
):
    importada = await client_tenant_a.post(
        "/api/v1/notas-fiscais/importar",
        files={"arquivo": ("nota.xml", xml_nfe_produto_novo, "text/xml")},
    )
    assert importada.status_code == 201

    listagem = await client_tenant_a.get("/api/v1/notas-fiscais")
    assert listagem.status_code == 200
    nota_na_lista = next((n for n in listagem.json() if n["id"] == importada.json()["id"]), None)
    assert nota_na_lista is not None
    assert nota_na_lista["itens_pendentes"] >= 1  # produto novo não reconhecido automaticamente


@pytest.mark.asyncio
async def test_listar_notas_nao_vaza_nota_de_outro_tenant(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient, xml_nfe_produto_novo: bytes
):
    nota_b = await client_tenant_b.post(
        "/api/v1/notas-fiscais/importar",
        files={"arquivo": ("nota.xml", xml_nfe_produto_novo, "text/xml")},
    )
    assert nota_b.status_code == 201

    listagem_a = await client_tenant_a.get("/api/v1/notas-fiscais")
    ids_a = [n["id"] for n in listagem_a.json()]
    assert nota_b.json()["id"] not in ids_a


@pytest.mark.asyncio
async def test_confirmar_item_de_nota_de_outro_tenant_e_bloqueado(client_tenant_a: AsyncClient, item_nota_tenant_b_id: str):
    response = await client_tenant_a.post(
        f"/api/v1/notas-fiscais/itens/{item_nota_tenant_b_id}/confirmar",
        json={"ignorar": True},
    )
    assert response.status_code == 404
