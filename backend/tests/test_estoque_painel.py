"""
Testa GET /estoque/painel — o endpoint que alimenta a tela de Estoque
completa (KPIs, filtros disponíveis, itens da grade com selo de
prioridade). Categoria/Depósito/Fornecedor não têm endpoint de criação
ainda (mesma lacuna já registrada no DEVLOG para outros módulos), então
são inseridos direto no banco aqui, como já é o padrão em
`_criar_usuario_direto_no_banco` no conftest.
"""
import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

TEST_DB_URL = os.environ["DATABASE_URL"]


async def _exec(sql: str, **params):
    # DATABASE_URL agora é um role sujeito a RLS de verdade (ver conftest.py).
    # Todo INSERT/UPDATE direto no banco precisa de app.tenant_id setado na
    # mesma transação, senão a policy de isolamento barra a operação.
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        if "tenant_id" in params:
            await conn.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": params["tenant_id"]})
        await conn.execute(text(sql), params)
    await engine.dispose()


async def _criar_categoria(tenant_id: str, nome: str) -> str:
    categoria_id = str(uuid.uuid4())
    await _exec(
        "INSERT INTO categorias (id, tenant_id, nome) VALUES (:id, :tenant_id, :nome)",
        id=categoria_id, tenant_id=tenant_id, nome=nome,
    )
    return categoria_id


async def _criar_deposito(tenant_id: str, nome: str) -> str:
    deposito_id = str(uuid.uuid4())
    await _exec(
        "INSERT INTO depositos (id, tenant_id, nome) VALUES (:id, :tenant_id, :nome)",
        id=deposito_id, tenant_id=tenant_id, nome=nome,
    )
    return deposito_id


async def _criar_fornecedor(tenant_id: str, nome: str) -> str:
    fornecedor_id = str(uuid.uuid4())
    await _exec(
        "INSERT INTO fornecedores (id, tenant_id, nome) VALUES (:id, :tenant_id, :nome)",
        id=fornecedor_id, tenant_id=tenant_id, nome=nome,
    )
    return fornecedor_id


async def _criar_lote(tenant_id: str, produto_id: str, validade: date, quantidade: float = 1) -> None:
    await _exec(
        "INSERT INTO lotes (id, tenant_id, produto_id, codigo_lote, validade, quantidade) "
        "VALUES (:id, :tenant_id, :produto_id, :codigo_lote, :validade, :quantidade)",
        id=str(uuid.uuid4()), tenant_id=tenant_id, produto_id=produto_id,
        codigo_lote="L1", validade=validade, quantidade=quantidade,
    )


async def _envelhecer_produto(tenant_id: str, produto_id: str, dias: int) -> None:
    """Simula um produto cadastrado há N dias — necessário pro badge 'novo',
    já que a API não deixa setar criado_em na criação."""
    nova_data = datetime.now(timezone.utc) - timedelta(days=dias)
    await _exec(
        "UPDATE produtos SET criado_em = :data WHERE id = :id AND tenant_id = :tenant_id",
        data=nova_data, id=produto_id, tenant_id=tenant_id,
    )


async def _tenant_id_de(client: AsyncClient) -> str:
    import base64
    import json

    token = client.headers["Authorization"].split(" ")[1]
    payload = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    return payload["tenant_id"]


@pytest_asyncio.fixture
async def tenant_a_id(client_tenant_a):
    return await _tenant_id_de(client_tenant_a)


@pytest.mark.asyncio
async def test_kpis_contam_apenas_produtos_ativos(client_tenant_a: AsyncClient):
    p1 = await client_tenant_a.post(
        "/api/v1/produtos", json={"nome": "Bombom", "estoque_minimo": 5, "custo_medio": 2.0}
    )
    p1_id = p1.json()["id"]
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": p1_id, "tipo": "entrada", "quantidade": 10}
    )
    p2 = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Trufa", "estoque_minimo": 5})
    p2_id = p2.json()["id"]
    await client_tenant_a.delete(f"/api/v1/produtos/{p2_id}")  # desativado — não deve contar

    resp = await client_tenant_a.get("/api/v1/estoque/painel")
    assert resp.status_code == 200, resp.text
    kpis = resp.json()["kpis"]
    assert kpis["produtos_cadastrados"] == 1
    assert kpis["total_unidades"] == 10
    assert kpis["valor_total_custo"] == 20.0  # 10 unidades * custo_medio 2.0


@pytest.mark.asyncio
async def test_busca_filtra_itens_mas_kpis_continuam_sobre_o_catalogo_inteiro(client_tenant_a: AsyncClient):
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Trufa de Maracujá"})
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Caramelo Salgado"})

    resp = await client_tenant_a.get("/api/v1/estoque/painel", params={"busca": "Trufa"})
    assert resp.status_code == 200
    corpo = resp.json()
    assert [i["nome"] for i in corpo["itens"]] == ["Trufa de Maracujá"]
    assert corpo["kpis"]["produtos_cadastrados"] == 2  # KPI não é afetado pela busca


@pytest.mark.asyncio
async def test_filtro_categoria(client_tenant_a: AsyncClient, tenant_a_id: str):
    categoria_id = await _criar_categoria(tenant_a_id, "Chocolates")
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Com categoria", "categoria_id": categoria_id})
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Sem categoria"})

    resp = await client_tenant_a.get("/api/v1/estoque/painel", params={"categoria_id": categoria_id})
    assert resp.status_code == 200
    itens = resp.json()["itens"]
    assert [i["nome"] for i in itens] == ["Com categoria"]
    assert itens[0]["categoria_nome"] == "Chocolates"


@pytest.mark.asyncio
async def test_filtro_deposito(client_tenant_a: AsyncClient, tenant_a_id: str):
    deposito_id = await _criar_deposito(tenant_a_id, "Depósito Central")
    p1 = await client_tenant_a.post("/api/v1/produtos", json={"nome": "No depósito"})
    p1_id = p1.json()["id"]
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": p1_id, "tipo": "entrada", "quantidade": 5, "deposito_id": deposito_id},
    )
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Fora do depósito"})

    resp = await client_tenant_a.get("/api/v1/estoque/painel", params={"deposito_id": deposito_id})
    assert resp.status_code == 200
    itens = resp.json()["itens"]
    assert [i["nome"] for i in itens] == ["No depósito"]


@pytest.mark.asyncio
async def test_filtro_fornecedor_via_pedido_de_compra(client_tenant_a: AsyncClient, tenant_a_id: str):
    fornecedor_id = await _criar_fornecedor(tenant_a_id, "Distribuidora Doce")
    p1 = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Comprado do fornecedor"})
    p1_id = p1.json()["id"]
    await client_tenant_a.post(
        "/api/v1/compras/pedidos",
        json={"fornecedor_id": fornecedor_id, "itens": [{"produto_id": p1_id, "quantidade": 5, "custo_unitario": 1.0}]},
    )
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Nunca comprado"})

    resp = await client_tenant_a.get("/api/v1/estoque/painel", params={"fornecedor_id": fornecedor_id})
    assert resp.status_code == 200
    itens = resp.json()["itens"]
    assert [i["nome"] for i in itens] == ["Comprado do fornecedor"]


@pytest.mark.asyncio
async def test_prioridade_sem_estoque_tem_precedencia_maxima(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Zerado", "estoque_minimo": 5})
    produto_id = resp.json()["id"]

    painel = await client_tenant_a.get("/api/v1/estoque/painel", params={"busca": "Zerado"})
    item = painel.json()["itens"][0]
    assert item["saldo"] == 0
    assert item["prioridade"] == "sem_estoque"


@pytest.mark.asyncio
async def test_prioridade_abaixo_minimo(client_tenant_a: AsyncClient, tenant_a_id: str):
    resp = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Quase acabando", "estoque_minimo": 20})
    produto_id = resp.json()["id"]
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 5}
    )
    await _envelhecer_produto(tenant_a_id, produto_id, dias=30)  # garante que não cai em "novo"

    painel = await client_tenant_a.get("/api/v1/estoque/painel", params={"busca": "Quase acabando"})
    item = painel.json()["itens"][0]
    assert item["prioridade"] == "abaixo_minimo"


@pytest.mark.asyncio
async def test_prioridade_vencimento_proximo_tem_precedencia_sobre_normal(
    client_tenant_a: AsyncClient, tenant_a_id: str
):
    resp = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Vence logo", "estoque_minimo": 2})
    produto_id = resp.json()["id"]
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 50}
    )
    await _envelhecer_produto(tenant_a_id, produto_id, dias=30)
    await _criar_lote(tenant_a_id, produto_id, validade=date.today() + timedelta(days=2), quantidade=10)

    painel = await client_tenant_a.get("/api/v1/estoque/painel", params={"busca": "Vence logo"})
    item = painel.json()["itens"][0]
    assert item["prioridade"] == "vencimento_proximo"
    assert item["proxima_validade"] == str(date.today() + timedelta(days=2))


@pytest.mark.asyncio
async def test_prioridade_novo_quando_recem_cadastrado(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Recém chegado", "estoque_minimo": 1})
    produto_id = resp.json()["id"]
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 50}
    )

    painel = await client_tenant_a.get("/api/v1/estoque/painel", params={"busca": "Recém chegado"})
    item = painel.json()["itens"][0]
    assert item["prioridade"] == "novo"


@pytest.mark.asyncio
async def test_prioridade_normal_quando_nada_se_aplica(client_tenant_a: AsyncClient, tenant_a_id: str):
    resp = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Tranquilo", "estoque_minimo": 1})
    produto_id = resp.json()["id"]
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 50}
    )
    await _envelhecer_produto(tenant_a_id, produto_id, dias=30)

    painel = await client_tenant_a.get("/api/v1/estoque/painel", params={"busca": "Tranquilo"})
    item = painel.json()["itens"][0]
    assert item["prioridade"] == "normal"


@pytest.mark.asyncio
async def test_filtro_somente_abaixo_minimo(client_tenant_a: AsyncClient):
    baixo = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Baixo", "estoque_minimo": 100})
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": baixo.json()["id"], "tipo": "entrada", "quantidade": 1}
    )
    alto = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Alto", "estoque_minimo": 1})
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": alto.json()["id"], "tipo": "entrada", "quantidade": 100}
    )

    resp = await client_tenant_a.get("/api/v1/estoque/painel", params={"somente_abaixo_minimo": True})
    nomes = [i["nome"] for i in resp.json()["itens"]]
    assert "Baixo" in nomes
    assert "Alto" not in nomes


@pytest.mark.asyncio
async def test_ordenacao_por_saldo_desc(client_tenant_a: AsyncClient):
    a = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Pouco estoque"})
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": a.json()["id"], "tipo": "entrada", "quantidade": 3}
    )
    b = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Muito estoque"})
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": b.json()["id"], "tipo": "entrada", "quantidade": 300}
    )

    resp = await client_tenant_a.get("/api/v1/estoque/painel", params={"ordenar_por": "saldo", "direcao": "desc"})
    nomes = [i["nome"] for i in resp.json()["itens"]]
    assert nomes.index("Muito estoque") < nomes.index("Pouco estoque")


@pytest.mark.asyncio
async def test_paginacao_respeita_tamanho_e_total(client_tenant_a: AsyncClient):
    for i in range(5):
        await client_tenant_a.post("/api/v1/produtos", json={"nome": f"Produto Paginado {i}"})

    resp = await client_tenant_a.get(
        "/api/v1/estoque/painel", params={"busca": "Produto Paginado", "tamanho": 2, "pagina": 1}
    )
    corpo = resp.json()
    assert len(corpo["itens"]) == 2
    assert corpo["total"] == 5
    assert corpo["pagina"] == 1

    resp2 = await client_tenant_a.get(
        "/api/v1/estoque/painel", params={"busca": "Produto Paginado", "tamanho": 2, "pagina": 3}
    )
    assert len(resp2.json()["itens"]) == 1  # última página, resto de 5/2


@pytest.mark.asyncio
async def test_painel_nao_vaza_produto_de_outro_tenant(
    client_tenant_a: AsyncClient, produto_tenant_b_id: str
):
    resp = await client_tenant_a.get("/api/v1/estoque/painel")
    ids = [i["produto_id"] for i in resp.json()["itens"]]
    assert produto_tenant_b_id not in ids


@pytest.mark.asyncio
async def test_filtros_disponiveis_nao_incluem_categorias_de_outro_tenant(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient, tenant_a_id: str
):
    tenant_b_id = await _tenant_id_de(client_tenant_b)
    await _criar_categoria(tenant_a_id, "Categoria do Tenant A")
    await _criar_categoria(tenant_b_id, "Categoria do Tenant B")

    resp = await client_tenant_a.get("/api/v1/estoque/painel")
    nomes_categorias = [c["nome"] for c in resp.json()["filtros"]["categorias"]]
    assert "Categoria do Tenant A" in nomes_categorias
    assert "Categoria do Tenant B" not in nomes_categorias
