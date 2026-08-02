"""
Teste de segurança crítico: garante que um usuário do tenant A NUNCA
consegue ler, editar ou apagar dados do tenant B — nem por bug de
aplicação, nem manipulando o produto_id na URL.

Este teste deve rodar em toda migration nova e em todo módulo novo
(estoque, inventario, notas_fiscais, vendas) seguindo o mesmo padrão.
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_usuario_nao_acessa_produto_de_outro_tenant(client_tenant_a: AsyncClient, produto_tenant_b_id: str):
    """Tenant A tenta acessar produto do Tenant B pelo ID direto — deve retornar 404, não 403.

    404 (e não 403) é intencional: 403 confirmaria que o recurso existe,
    vazando informação sobre a existência de dados de outro tenant.
    """
    response = await client_tenant_a.get(f"/api/v1/produtos/{produto_tenant_b_id}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_usuario_nao_lista_produtos_de_outro_tenant(client_tenant_a: AsyncClient, produto_tenant_b_id: str):
    response = await client_tenant_a.get("/api/v1/produtos")
    ids_retornados = [p["id"] for p in response.json()]
    assert produto_tenant_b_id not in ids_retornados


@pytest.mark.asyncio
async def test_usuario_nao_edita_produto_de_outro_tenant(client_tenant_a: AsyncClient, produto_tenant_b_id: str):
    response = await client_tenant_a.patch(
        f"/api/v1/produtos/{produto_tenant_b_id}", json={"nome": "Produto Hackeado"}
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_perfil_leitura_nao_cria_produto(client_leitura: AsyncClient):
    response = await client_leitura.post("/api/v1/produtos", json={"nome": "Novo Produto"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_token_expirado_e_rejeitado(client_token_expirado: AsyncClient):
    response = await client_token_expirado.get("/api/v1/produtos")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_upload_xml_maior_que_limite_e_rejeitado(client_tenant_a: AsyncClient):
    xml_gigante = b"<a>" + b"0" * (6 * 1024 * 1024) + b"</a>"  # 6MB > limite de 5MB
    response = await client_tenant_a.post(
        "/api/v1/notas-fiscais/importar",
        files={"arquivo": ("nota.xml", xml_gigante, "application/xml")},
    )
    assert response.status_code == 413


@pytest.mark.asyncio
async def test_xml_com_entidade_externa_e_bloqueado(client_tenant_a: AsyncClient):
    """Tentativa clássica de XXE — deve falhar no parsing, nunca ler o arquivo local."""
    xml_malicioso = b"""<?xml version="1.0"?>
    <!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
    <NFe><infNFe><det><prod><xProd>&xxe;</xProd></prod></det></infNFe></NFe>"""
    response = await client_tenant_a.post(
        "/api/v1/notas-fiscais/importar",
        files={"arquivo": ("nota.xml", xml_malicioso, "application/xml")},
    )
    assert response.status_code in (400, 422)
    assert "root:" not in response.text  # conteúdo de /etc/passwd nunca deve vazar na resposta
