"""
Testa GET /painel — a tela inicial do produto (Etapa 23), que cruza dados de
estoque, movimentações, vendas, categorias e alertas num único endpoint de
leitura. Diferente dos demais paineis, não tem paginação/filtro — é sempre
um retrato agregado do tenant inteiro.
"""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_painel_kpis_refletem_estoque_e_produtos(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    resp = await client_tenant_a.get("/api/v1/painel")
    assert resp.status_code == 200, resp.text
    kpis = resp.json()["kpis"]
    assert kpis["produtos_cadastrados"]["valor"] >= 1
    assert kpis["entradas_mes"]["valor"] >= 10  # a fixture já lançou uma entrada de 10


@pytest.mark.asyncio
async def test_painel_kpis_refletem_saida_e_faturamento_do_mes(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    antes = (await client_tenant_a.get("/api/v1/painel")).json()["kpis"]

    venda = await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 3, "preco_unitario": 15.0}]},
    )
    assert venda.status_code == 201

    depois = (await client_tenant_a.get("/api/v1/painel")).json()["kpis"]
    assert depois["saidas_mes"]["valor"] == antes["saidas_mes"]["valor"] + 3
    assert depois["faturamento_mes"]["valor"] >= antes["faturamento_mes"]["valor"] + 45.0


@pytest.mark.asyncio
async def test_painel_movimentacoes_periodo_soma_entrada_de_hoje(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    resp = await client_tenant_a.get("/api/v1/painel", params={"dias": 7})
    assert resp.status_code == 200, resp.text
    pontos = resp.json()["movimentacoes_periodo"]
    assert len(pontos) == 7
    total_entradas = sum(p["entradas"] for p in pontos)
    assert total_entradas >= 10  # a entrada da fixture caiu em algum dia da janela


@pytest.mark.asyncio
async def test_painel_movimentacoes_periodo_respeita_parametro_dias(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    resp_30 = await client_tenant_a.get("/api/v1/painel", params={"dias": 30})
    assert len(resp_30.json()["movimentacoes_periodo"]) == 30

    resp_90 = await client_tenant_a.get("/api/v1/painel", params={"dias": 90})
    assert len(resp_90.json()["movimentacoes_periodo"]) == 90


@pytest.mark.asyncio
async def test_painel_estoque_critico_lista_produto_abaixo_do_minimo(client_tenant_a: AsyncClient, produto_estoque_zerado: str):
    resp = await client_tenant_a.get("/api/v1/painel")
    assert resp.status_code == 200, resp.text
    criticos = resp.json()["estoque_critico"]
    ids = [c["produto_id"] for c in criticos]
    assert produto_estoque_zerado in ids
    item = next(c for c in criticos if c["produto_id"] == produto_estoque_zerado)
    assert item["nivel"] == "critico"  # saldo 0 é sempre < 50% do mínimo (5)


@pytest.mark.asyncio
async def test_painel_estoque_critico_nao_lista_produto_acima_do_minimo(
    client_tenant_a: AsyncClient, produto_com_saldo_acima_do_minimo: str
):
    resp = await client_tenant_a.get("/api/v1/painel")
    ids = [c["produto_id"] for c in resp.json()["estoque_critico"]]
    assert produto_com_saldo_acima_do_minimo not in ids


@pytest.mark.asyncio
async def test_painel_estoque_por_categoria_soma_100_por_cento(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    resp = await client_tenant_a.get("/api/v1/painel")
    categorias = resp.json()["estoque_por_categoria"]
    assert len(categorias) >= 1
    assert abs(sum(c["percentual"] for c in categorias) - 100.0) < 0.5  # arredondamento por categoria


@pytest.mark.asyncio
async def test_painel_ultimas_movimentacoes_traz_nome_do_produto(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    resp = await client_tenant_a.get("/api/v1/painel")
    ultimas = resp.json()["ultimas_movimentacoes"]
    assert len(ultimas) >= 1
    assert ultimas[0]["produto_nome"]  # nome resolvido via join, não vazio
    assert ultimas[0]["tipo"] == "entrada"


@pytest.mark.asyncio
async def test_painel_giro_estoque_so_lista_produto_com_saida_na_janela(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    # Sem nenhuma saída ainda: produto não deve aparecer no giro (giro
    # indefinido sem venda/saída na janela dos últimos 30 dias).
    antes = await client_tenant_a.get("/api/v1/painel")
    ids_antes = [g["produto_id"] for g in antes.json()["giro_estoque_top5"]]
    assert produto_com_saldo_10 not in ids_antes

    await client_tenant_a.post(
        "/api/v1/vendas",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 2, "preco_unitario": 5.0}]},
    )

    depois = await client_tenant_a.get("/api/v1/painel")
    giro = depois.json()["giro_estoque_top5"]
    ids_depois = [g["produto_id"] for g in giro]
    assert produto_com_saldo_10 in ids_depois
    item = next(g for g in giro if g["produto_id"] == produto_com_saldo_10)
    assert item["giro_dias"] is not None and item["giro_dias"] > 0


@pytest.mark.asyncio
async def test_painel_alertas_conta_pedidos_em_aberto(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    antes = (await client_tenant_a.get("/api/v1/painel")).json()["alertas"]["pedidos_em_aberto"]

    pedido = await client_tenant_a.post(
        "/api/v1/compras/pedidos",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 5, "custo_unitario": 2.0}]},
    )
    assert pedido.status_code == 201, pedido.text

    depois = (await client_tenant_a.get("/api/v1/painel")).json()["alertas"]["pedidos_em_aberto"]
    assert depois == antes + 1


@pytest.mark.asyncio
async def test_painel_nao_vaza_dado_de_outro_tenant(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient, produto_tenant_b_id: str
):
    entrada = await client_tenant_b.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto_tenant_b_id, "tipo": "entrada", "quantidade": 999},
    )
    assert entrada.status_code == 201

    painel_a = (await client_tenant_a.get("/api/v1/painel")).json()
    ids_movimentacoes_a = [m["id"] for m in painel_a["ultimas_movimentacoes"]]
    assert entrada.json()[0]["id"] not in ids_movimentacoes_a
    # KPI de entradas do tenant A não pode ter sido inflado pela movimentação do tenant B
    assert painel_a["kpis"]["entradas_mes"]["valor"] < 999
