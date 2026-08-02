"""
Testa o módulo `cadastros` (Categoria, Depósito, Fornecedor) — criado nesta
etapa pra fechar a lacuna registrada no DEVLOG: até aqui, essas três
entidades só existiam no schema do banco, sem nenhum jeito de criar/editar/
excluir via API, o que deixava os filtros correspondentes do painel de
Estoque praticamente inutilizáveis em produção.
"""
import pytest
from httpx import AsyncClient


# --- Categoria ---------------------------------------------------------

@pytest.mark.asyncio
async def test_cria_e_lista_categoria(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post("/api/v1/categorias", json={"nome": "Chocolates"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["nome"] == "Chocolates"

    listagem = await client_tenant_a.get("/api/v1/categorias")
    assert "Chocolates" in [c["nome"] for c in listagem.json()]


@pytest.mark.asyncio
async def test_atualiza_categoria(client_tenant_a: AsyncClient):
    criada = await client_tenant_a.post("/api/v1/categorias", json={"nome": "Doces"})
    categoria_id = criada.json()["id"]

    resp = await client_tenant_a.patch(f"/api/v1/categorias/{categoria_id}", json={"nome": "Doces Finos"})
    assert resp.status_code == 200
    assert resp.json()["nome"] == "Doces Finos"


@pytest.mark.asyncio
async def test_exclui_categoria_sem_uso(client_tenant_a: AsyncClient):
    criada = await client_tenant_a.post("/api/v1/categorias", json={"nome": "Descartável"})
    categoria_id = criada.json()["id"]

    resp = await client_tenant_a.delete(f"/api/v1/categorias/{categoria_id}")
    assert resp.status_code == 204

    listagem = await client_tenant_a.get("/api/v1/categorias")
    assert categoria_id not in [c["id"] for c in listagem.json()]


@pytest.mark.asyncio
async def test_exclusao_de_categoria_em_uso_e_bloqueada_com_409(client_tenant_a: AsyncClient):
    categoria = await client_tenant_a.post("/api/v1/categorias", json={"nome": "Em uso"})
    categoria_id = categoria.json()["id"]
    await client_tenant_a.post("/api/v1/produtos", json={"nome": "Usa a categoria", "categoria_id": categoria_id})

    resp = await client_tenant_a.delete(f"/api/v1/categorias/{categoria_id}")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_categoria_de_um_tenant_nao_aparece_para_outro(client_tenant_a: AsyncClient, client_tenant_b: AsyncClient):
    await client_tenant_a.post("/api/v1/categorias", json={"nome": "Só do Tenant A"})

    resp = await client_tenant_b.get("/api/v1/categorias")
    assert "Só do Tenant A" not in [c["nome"] for c in resp.json()]


@pytest.mark.asyncio
async def test_perfil_leitura_nao_cria_categoria(client_leitura: AsyncClient):
    resp = await client_leitura.post("/api/v1/categorias", json={"nome": "Não deveria existir"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_perfil_operador_cria_mas_nao_exclui_categoria(client_operador: AsyncClient):
    criada = await client_operador.post("/api/v1/categorias", json={"nome": "Criada por operador"})
    assert criada.status_code == 201

    resp = await client_operador.delete(f"/api/v1/categorias/{criada.json()['id']}")
    assert resp.status_code == 403


# --- Depósito ------------------------------------------------------------

@pytest.mark.asyncio
async def test_cria_lista_e_atualiza_deposito(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post("/api/v1/depositos", json={"nome": "Depósito Central", "endereco": "Rua A, 100"})
    assert resp.status_code == 201, resp.text
    deposito_id = resp.json()["id"]

    listagem = await client_tenant_a.get("/api/v1/depositos")
    assert "Depósito Central" in [d["nome"] for d in listagem.json()]

    atualizado = await client_tenant_a.patch(f"/api/v1/depositos/{deposito_id}", json={"nome": "Depósito Principal"})
    assert atualizado.json()["nome"] == "Depósito Principal"


@pytest.mark.asyncio
async def test_exclusao_de_deposito_em_uso_e_bloqueada(client_tenant_a: AsyncClient):
    deposito = await client_tenant_a.post("/api/v1/depositos", json={"nome": "Em uso"})
    deposito_id = deposito.json()["id"]
    produto = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Qualquer"})
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto.json()["id"], "tipo": "entrada", "quantidade": 5, "deposito_id": deposito_id},
    )

    resp = await client_tenant_a.delete(f"/api/v1/depositos/{deposito_id}")
    assert resp.status_code == 409


# --- Fornecedor ------------------------------------------------------------

@pytest.mark.asyncio
async def test_cria_lista_e_atualiza_fornecedor(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post(
        "/api/v1/fornecedores", json={"nome": "Distribuidora Doce", "documento": "12345678000100"}
    )
    assert resp.status_code == 201, resp.text
    fornecedor_id = resp.json()["id"]

    listagem = await client_tenant_a.get("/api/v1/fornecedores")
    assert "Distribuidora Doce" in [f["nome"] for f in listagem.json()]

    atualizado = await client_tenant_a.patch(f"/api/v1/fornecedores/{fornecedor_id}", json={"contato": "(11) 99999-0000"})
    assert atualizado.json()["contato"] == "(11) 99999-0000"


@pytest.mark.asyncio
async def test_exclusao_de_fornecedor_em_uso_e_bloqueada(client_tenant_a: AsyncClient):
    fornecedor = await client_tenant_a.post("/api/v1/fornecedores", json={"nome": "Em uso"})
    fornecedor_id = fornecedor.json()["id"]
    produto = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Qualquer"})
    await client_tenant_a.post(
        "/api/v1/compras/pedidos",
        json={"fornecedor_id": fornecedor_id, "itens": [{"produto_id": produto.json()["id"], "quantidade": 1, "custo_unitario": 1.0}]},
    )

    resp = await client_tenant_a.delete(f"/api/v1/fornecedores/{fornecedor_id}")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_fornecedor_criado_via_api_ja_funciona_no_filtro_do_painel_de_estoque(client_tenant_a: AsyncClient):
    """Fecha o ciclo: o gap registrado era que os filtros do painel de
    Estoque não tinham como ser populados sem inserir direto no banco."""
    fornecedor = await client_tenant_a.post("/api/v1/fornecedores", json={"nome": "Via API"})
    fornecedor_id = fornecedor.json()["id"]

    painel = await client_tenant_a.get("/api/v1/estoque/painel")
    nomes = [f["nome"] for f in painel.json()["filtros"]["fornecedores"]]
    assert "Via API" in nomes
