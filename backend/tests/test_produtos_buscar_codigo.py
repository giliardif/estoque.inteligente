"""
Etapa 29: busca exata de produto por código (codigo_barras ou sku) — usada
pelo scanner (câmera/leitor físico) em Vendas, Estoque e Inventário.
Diferente da busca unificada de listar() (substring/ILIKE), aqui é sempre
match exato, e o isolamento entre tenants segue o mesmo padrão de defesa
em profundidade do resto do projeto.
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_busca_por_codigo_de_barras_exato(client_tenant_a: AsyncClient):
    criado = await client_tenant_a.post(
        "/api/v1/produtos",
        json={"nome": "Trufa de Maracujá", "codigo_barras": "7891234567890"},
    )
    assert criado.status_code == 201, criado.text

    resp = await client_tenant_a.get("/api/v1/produtos/buscar-codigo", params={"codigo": "7891234567890"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["nome"] == "Trufa de Maracujá"


@pytest.mark.asyncio
async def test_busca_por_codigo_tambem_aceita_sku(client_tenant_a: AsyncClient):
    criado = await client_tenant_a.post(
        "/api/v1/produtos", json={"nome": "Bombom Cristal", "sku": "BOM-CRI"}
    )
    assert criado.status_code == 201, criado.text

    resp = await client_tenant_a.get("/api/v1/produtos/buscar-codigo", params={"codigo": "BOM-CRI"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["nome"] == "Bombom Cristal"


@pytest.mark.asyncio
async def test_busca_por_codigo_e_exata_nao_substring(client_tenant_a: AsyncClient):
    # Diferente da busca unificada da listagem: um código parcial não deve
    # casar — evita o scanner resolver pro produto errado quando um código
    # é prefixo/sufixo de outro.
    await client_tenant_a.post(
        "/api/v1/produtos", json={"nome": "Pirulito Recheado", "codigo_barras": "7891234500000"}
    )

    resp = await client_tenant_a.get("/api/v1/produtos/buscar-codigo", params={"codigo": "789123450"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_busca_por_codigo_inexistente_retorna_404(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.get("/api/v1/produtos/buscar-codigo", params={"codigo": "0000000000000"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_busca_por_codigo_isolada_entre_tenants(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient
):
    await client_tenant_a.post(
        "/api/v1/produtos", json={"nome": "Produto do tenant A", "codigo_barras": "1112223334445"}
    )

    resp = await client_tenant_b.get("/api/v1/produtos/buscar-codigo", params={"codigo": "1112223334445"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_busca_por_codigo_ignora_produto_inativo(client_tenant_a: AsyncClient):
    criado = await client_tenant_a.post(
        "/api/v1/produtos", json={"nome": "Produto a desativar", "codigo_barras": "9998887776665"}
    )
    produto_id = criado.json()["id"]
    desativar = await client_tenant_a.delete(f"/api/v1/produtos/{produto_id}")
    assert desativar.status_code == 204

    resp = await client_tenant_a.get("/api/v1/produtos/buscar-codigo", params={"codigo": "9998887776665"})
    assert resp.status_code == 404
