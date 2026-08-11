"""
Testa GET /vendas/painel (KPIs de hoje + histórico filtrável/ordenável/paginado)
e POST /vendas/{id}/cancelar (estorno automático de estoque), adicionados na
Etapa 16 junto com a aplicação do kit de UX na tela de Vendas.

Também cobre o bug real corrigido nesta etapa: `finalizado_em` nunca era
preenchido ao finalizar uma venda.
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_finalizar_venda_preenche_finalizado_em(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    # Bug real: campo existia no modelo desde sempre, mas nunca era setado.
    criada = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 1, "preco_unitario": 5.0}]},
    )
    assert criada.status_code == 201
    venda = await client_tenant_a.get("/api/v1/vendas/painel")
    item = next(i for i in venda.json()["itens"] if i["id"] == criada.json()["id"])
    assert item["finalizado_em"] is not None


@pytest.mark.asyncio
async def test_painel_kpis_vendas_hoje_refletem_vendas_finalizadas(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    antes = await client_tenant_a.get("/api/v1/vendas/painel")
    vendas_hoje_antes = antes.json()["kpis"]["vendas_hoje"]

    await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 2, "preco_unitario": 10.0}]},
    )

    depois = await client_tenant_a.get("/api/v1/vendas/painel")
    kpis = depois.json()["kpis"]
    assert kpis["vendas_hoje"] == vendas_hoje_antes + 1
    assert kpis["faturamento_hoje"] >= 20.0


@pytest.mark.asyncio
async def test_painel_retorna_total_para_paginacao(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    for _ in range(3):
        await client_tenant_a.post(
            "/api/v1/vendas",
            json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 1, "preco_unitario": 1.0}]},
        )

    resp = await client_tenant_a.get("/api/v1/vendas/painel", params={"tamanho": 2})
    assert resp.status_code == 200, resp.text
    corpo = resp.json()
    assert len(corpo["itens"]) == 2
    assert corpo["total"] >= 3


@pytest.mark.asyncio
async def test_painel_filtra_por_status_cancelada(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    venda = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 1, "preco_unitario": 1.0}]},
    )
    venda_id = venda.json()["id"]
    await client_tenant_a.post(f"/api/v1/vendas/{venda_id}/cancelar")

    resp = await client_tenant_a.get("/api/v1/vendas/painel", params={"status": "cancelada"})
    ids = [i["id"] for i in resp.json()["itens"]]
    assert venda_id in ids
    assert all(i["status"] == "cancelada" for i in resp.json()["itens"])


@pytest.mark.asyncio
async def test_painel_busca_por_nome_de_produto(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    produto = await client_tenant_a.get(f"/api/v1/produtos/{produto_com_saldo_10}")
    nome_produto = produto.json()["nome"]

    venda = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 1, "preco_unitario": 1.0}]},
    )
    venda_id = venda.json()["id"]

    resp = await client_tenant_a.get("/api/v1/vendas/painel", params={"busca": nome_produto[:5]})
    ids = [i["id"] for i in resp.json()["itens"]]
    assert venda_id in ids

    resp_vazio = await client_tenant_a.get("/api/v1/vendas/painel", params={"busca": "ProdutoQueNaoExisteXYZ"})
    assert resp_vazio.json()["itens"] == []


@pytest.mark.asyncio
async def test_painel_ordena_por_valor_total_desc(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 1, "preco_unitario": 1.0}]},
    )
    maior = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 1, "preco_unitario": 999.0}]},
    )

    resp = await client_tenant_a.get(
        "/api/v1/vendas/painel", params={"ordenar_por": "valor_total", "direcao": "desc", "tamanho": 100}
    )
    ids = [i["id"] for i in resp.json()["itens"]]
    assert ids[0] == maior.json()["id"]


@pytest.mark.asyncio
async def test_painel_nao_vaza_venda_de_outro_tenant(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient, produto_tenant_b_id: str
):
    entrada = await client_tenant_b.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto_tenant_b_id, "tipo": "entrada", "quantidade": 5},
    )
    assert entrada.status_code == 201

    venda_b = await client_tenant_b.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_tenant_b_id, "quantidade": 1, "preco_unitario": 3.0}]},
    )
    assert venda_b.status_code == 201

    resp = await client_tenant_a.get("/api/v1/vendas/painel", params={"tamanho": 100})
    ids = [i["id"] for i in resp.json()["itens"]]
    assert venda_b.json()["id"] not in ids


# --- Cancelamento (estorno automático de estoque) ---------------------------

@pytest.mark.asyncio
async def test_cancelar_venda_estorna_estoque_e_muda_status(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    venda = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 4, "preco_unitario": 2.0}]},
    )
    venda_id = venda.json()["id"]

    saldo_apos_venda = await client_tenant_a.get(f"/api/v1/estoque/produtos/{produto_com_saldo_10}/saldo")
    assert saldo_apos_venda.json()["saldo"] == 6  # 10 - 4

    cancelada = await client_tenant_a.post(f"/api/v1/vendas/{venda_id}/cancelar")
    assert cancelada.status_code == 200, cancelada.text
    assert cancelada.json()["status"] == "cancelada"

    saldo_apos_cancelamento = await client_tenant_a.get(f"/api/v1/estoque/produtos/{produto_com_saldo_10}/saldo")
    assert saldo_apos_cancelamento.json()["saldo"] == 10  # estornado por completo


@pytest.mark.asyncio
async def test_cancelar_venda_ja_cancelada_e_rejeitado(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    venda = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 1, "preco_unitario": 1.0}]},
    )
    venda_id = venda.json()["id"]
    primeiro_cancelamento = await client_tenant_a.post(f"/api/v1/vendas/{venda_id}/cancelar")
    assert primeiro_cancelamento.status_code == 200

    segundo_cancelamento = await client_tenant_a.post(f"/api/v1/vendas/{venda_id}/cancelar")
    assert segundo_cancelamento.status_code == 409


@pytest.mark.asyncio
async def test_cancelar_venda_de_outro_tenant_e_bloqueado(client_tenant_a: AsyncClient, produto_tenant_b_id: str, client_tenant_b: AsyncClient):
    await client_tenant_b.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto_tenant_b_id, "tipo": "entrada", "quantidade": 5},
    )
    venda_b = await client_tenant_b.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_tenant_b_id, "quantidade": 1, "preco_unitario": 3.0}]},
    )
    venda_b_id = venda_b.json()["id"]

    resp = await client_tenant_a.post(f"/api/v1/vendas/{venda_b_id}/cancelar")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_perfil_leitura_nao_cancela_venda(client_tenant_a: AsyncClient, client_leitura: AsyncClient, produto_com_saldo_10: str):
    venda = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 1, "preco_unitario": 1.0}]},
    )
    venda_id = venda.json()["id"]

    resp = await client_leitura.post(f"/api/v1/vendas/{venda_id}/cancelar")
    assert resp.status_code == 403

    # confere que nada foi alterado apesar da tentativa
    saldo = await client_tenant_a.get(f"/api/v1/estoque/produtos/{produto_com_saldo_10}/saldo")
    assert saldo.json()["saldo"] == 9  # só a baixa da venda original, sem estorno
