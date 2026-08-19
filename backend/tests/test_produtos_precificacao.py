"""
Etapa 25: preço de venda + margem (calculada, nunca persistida), marca,
NCM, controla_lote e categoria vinculada no cadastro de produto. Upload
de imagem é testado separado pois depende de SUPABASE_URL configurado
(aqui testamos só o caminho de erro 503 quando não está configurado, que
é justamente o estado do ambiente de teste).
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_criar_produto_com_preco_venda_retorna_margem_calculada(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post(
        "/api/v1/produtos",
        json={"nome": "Bombom Premium", "custo_medio": 2.0, "preco_venda": 5.0},
    )
    assert resp.status_code == 201, resp.text
    produto_id = resp.json()["id"]

    painel = await client_tenant_a.get("/api/v1/produtos/painel")
    item = next(i for i in painel.json()["itens"] if i["id"] == produto_id)
    assert item["preco_venda"] == 5.0
    # (5 - 2) / 5 * 100 = 60%
    assert item["margem_percentual"] == 60.0


@pytest.mark.asyncio
async def test_produto_sem_preco_venda_tem_margem_none(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto sem preço", "custo_medio": 3.0})
    produto_id = resp.json()["id"]

    painel = await client_tenant_a.get("/api/v1/produtos/painel")
    item = next(i for i in painel.json()["itens"] if i["id"] == produto_id)
    assert item["preco_venda"] is None
    assert item["margem_percentual"] is None


@pytest.mark.asyncio
async def test_margem_nunca_persistida_reflete_edicao_do_preco(client_tenant_a: AsyncClient):
    """
    Garante que margem é sempre derivada em runtime: editar preco_venda
    via PATCH muda a margem calculada sem nenhum campo de margem no payload.
    """
    criado = await client_tenant_a.post(
        "/api/v1/produtos", json={"nome": "Trufa Especial", "custo_medio": 4.0, "preco_venda": 8.0}
    )
    produto_id = criado.json()["id"]

    painel_antes = await client_tenant_a.get("/api/v1/produtos/painel")
    item_antes = next(i for i in painel_antes.json()["itens"] if i["id"] == produto_id)
    assert item_antes["margem_percentual"] == 50.0

    await client_tenant_a.patch(f"/api/v1/produtos/{produto_id}", json={"preco_venda": 10.0})

    painel_depois = await client_tenant_a.get("/api/v1/produtos/painel")
    item_depois = next(i for i in painel_depois.json()["itens"] if i["id"] == produto_id)
    # (10 - 4) / 10 * 100 = 60%
    assert item_depois["margem_percentual"] == 60.0


@pytest.mark.asyncio
async def test_preco_venda_negativo_e_rejeitado(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post(
        "/api/v1/produtos", json={"nome": "Produto inválido", "preco_venda": -1}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_criar_produto_com_marca_ncm_e_controla_lote(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post(
        "/api/v1/produtos",
        json={
            "nome": "Caixa de Bombom 12un",
            "marca": "Doce Encanto",
            "ncm": "1806.90.00",
            "controla_lote": True,
        },
    )
    assert resp.status_code == 201, resp.text
    corpo = resp.json()
    assert corpo["marca"] == "Doce Encanto"
    assert corpo["ncm"] == "1806.90.00"
    assert corpo["controla_lote"] is True


@pytest.mark.asyncio
async def test_controla_lote_padrao_e_falso(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto simples"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["controla_lote"] is False


@pytest.mark.asyncio
async def test_produto_vinculado_a_categoria_aparece_no_painel(client_tenant_a: AsyncClient):
    categoria = await client_tenant_a.post("/api/v1/categorias", json={"nome": "Bombons"})
    categoria_id = categoria.json()["id"]

    criado = await client_tenant_a.post(
        "/api/v1/produtos", json={"nome": "Bombom com categoria", "categoria_id": categoria_id}
    )
    assert criado.status_code == 201, criado.text

    painel = await client_tenant_a.get("/api/v1/produtos/painel", params={"categoria_id": categoria_id})
    itens = painel.json()["itens"]
    assert len(itens) == 1
    assert itens[0]["categoria_nome"] == "Bombons"


@pytest.mark.asyncio
async def test_upload_imagem_sem_supabase_configurado_retorna_503(client_tenant_a: AsyncClient):
    """
    Ambiente de teste não define SUPABASE_URL/SERVICE_ROLE_KEY de propósito
    (segredo real não deve existir em CI) — o endpoint deve falhar de forma
    limpa (503), não com erro genérico não tratado.
    """
    criado = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto pra imagem"})
    produto_id = criado.json()["id"]

    resp = await client_tenant_a.post(
        f"/api/v1/produtos/{produto_id}/imagem",
        files={"arquivo": ("foto.jpg", b"conteudo-fake-de-imagem", "image/jpeg")},
    )
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_upload_imagem_tipo_nao_suportado_e_rejeitado_antes_de_chamar_storage(client_tenant_a: AsyncClient):
    criado = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto pra imagem 2"})
    produto_id = criado.json()["id"]

    resp = await client_tenant_a.post(
        f"/api/v1/produtos/{produto_id}/imagem",
        files={"arquivo": ("arquivo.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert resp.status_code == 415
