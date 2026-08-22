"""
Etapa 29: CRUD de modelos salvos de etiqueta (config_json é forma livre,
interpretada pelo frontend — aqui só validamos persistência, permissões
por perfil e isolamento entre tenants).
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_criar_e_listar_modelo(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post(
        "/api/v1/etiquetas/modelos",
        json={
            "nome": "Padrão — Preço + Barras",
            "config_json": {
                "elementos": ["nome", "sku", "preco"],
                "tipo_codigo": "barras",
                "tamanho": "40x30mm",
                "colunas": 2,
            },
        },
    )
    assert resp.status_code == 201, resp.text
    corpo = resp.json()
    assert corpo["nome"] == "Padrão — Preço + Barras"
    assert corpo["config_json"]["tipo_codigo"] == "barras"

    listagem = await client_tenant_a.get("/api/v1/etiquetas/modelos")
    assert listagem.status_code == 200
    assert any(m["id"] == corpo["id"] for m in listagem.json())


@pytest.mark.asyncio
async def test_atualizar_modelo(client_tenant_a: AsyncClient):
    criado = await client_tenant_a.post(
        "/api/v1/etiquetas/modelos", json={"nome": "Modelo X", "config_json": {"colunas": 2}}
    )
    modelo_id = criado.json()["id"]

    resp = await client_tenant_a.patch(
        f"/api/v1/etiquetas/modelos/{modelo_id}",
        json={"config_json": {"colunas": 3}},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["config_json"]["colunas"] == 3
    assert resp.json()["nome"] == "Modelo X"  # nome não alterado, permanece


@pytest.mark.asyncio
async def test_remover_modelo(client_tenant_a: AsyncClient):
    criado = await client_tenant_a.post(
        "/api/v1/etiquetas/modelos", json={"nome": "Modelo a remover", "config_json": {}}
    )
    modelo_id = criado.json()["id"]

    resp = await client_tenant_a.delete(f"/api/v1/etiquetas/modelos/{modelo_id}")
    assert resp.status_code == 204

    listagem = await client_tenant_a.get("/api/v1/etiquetas/modelos")
    assert all(m["id"] != modelo_id for m in listagem.json())


@pytest.mark.asyncio
async def test_atualizar_modelo_inexistente_retorna_404(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.patch(
        "/api/v1/etiquetas/modelos/00000000-0000-0000-0000-000000000000",
        json={"nome": "Nome Válido"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_modelo_isolado_entre_tenants(client_tenant_a: AsyncClient, client_tenant_b: AsyncClient):
    criado = await client_tenant_a.post(
        "/api/v1/etiquetas/modelos", json={"nome": "Modelo do tenant A", "config_json": {}}
    )
    modelo_id = criado.json()["id"]

    # tenant B não pode ver, editar nem apagar o modelo do tenant A — 404,
    # não 403, pra não revelar que o recurso existe (mesmo padrão do resto do sistema).
    listagem_b = await client_tenant_b.get("/api/v1/etiquetas/modelos")
    assert all(m["id"] != modelo_id for m in listagem_b.json())

    editar_b = await client_tenant_b.patch(f"/api/v1/etiquetas/modelos/{modelo_id}", json={"nome": "Hackeado"})
    assert editar_b.status_code == 404

    apagar_b = await client_tenant_b.delete(f"/api/v1/etiquetas/modelos/{modelo_id}")
    assert apagar_b.status_code == 404


@pytest.mark.asyncio
async def test_perfil_leitura_nao_pode_criar_modelo(client_leitura: AsyncClient):
    resp = await client_leitura.post(
        "/api/v1/etiquetas/modelos", json={"nome": "Tentativa leitura", "config_json": {}}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_perfil_leitura_pode_listar_modelos(client_leitura: AsyncClient):
    resp = await client_leitura.get("/api/v1/etiquetas/modelos")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_nome_vazio_e_rejeitado(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post(
        "/api/v1/etiquetas/modelos", json={"nome": "   ", "config_json": {}}
    )
    assert resp.status_code == 422
