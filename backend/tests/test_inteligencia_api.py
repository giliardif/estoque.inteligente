"""
Testes de integração de POST/GET /inteligencia — a camada narrativa (LLM) é
mockada aqui: não é papel destes testes validar a API da Anthropic (isso é
coberto por não fazer parte do caminho crítico determinístico), e rodar
contra a API real tornaria a suíte lenta, cara e dependente de rede/chave.
O que importa testar de verdade é que o service persiste corretamente e que
uma falha da LLM não derruba a análise.
"""
from unittest.mock import patch

import pytest
from httpx import AsyncClient


@pytest.fixture(autouse=True)
def mock_narrativa():
    with patch(
        "app.modules.inteligencia.service.narrar_insight",
        return_value="Narrativa de teste gerada pela IA.",
    ) as mocked:
        yield mocked


@pytest.mark.asyncio
async def test_analisar_sem_produtos_retorna_painel_vazio(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post("/api/v1/inteligencia/analisar")
    assert resp.status_code == 200, resp.text
    corpo = resp.json()
    assert corpo["reposicoes"] == []
    assert corpo["resumo_semanal"] is None


@pytest.mark.asyncio
async def test_analisar_produto_com_saldo_baixo_sugere_reposicao(client_tenant_a: AsyncClient):
    produto = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Trufa Teste", "estoque_minimo": 5})
    produto_id = produto.json()["id"]
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 100}
    )
    # 10 saídas de 5un nos últimos dias simula demanda real (registradas hoje,
    # mas isso já é suficiente pra media_movel_ponderada calcular > 0)
    for _ in range(5):
        r = await client_tenant_a.post(
            "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "saida", "quantidade": 5}
        )
        assert r.status_code == 201, r.text

    resp = await client_tenant_a.post("/api/v1/inteligencia/analisar")
    assert resp.status_code == 200, resp.text
    reposicoes = resp.json()["reposicoes"]
    item = next(r for r in reposicoes if r["produto_id"] == produto_id)
    assert item["demanda_media_dia"] > 0
    assert item["narrativa"] == "Narrativa de teste gerada pela IA."


@pytest.mark.asyncio
async def test_analisar_persiste_e_get_painel_reflete_sem_recalcular(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    resp1 = await client_tenant_a.post("/api/v1/inteligencia/analisar")
    assert resp1.status_code == 200

    resp2 = await client_tenant_a.get("/api/v1/inteligencia/painel")
    assert resp2.status_code == 200
    ids = [r["produto_id"] for r in resp2.json()["reposicoes"]]
    assert produto_com_saldo_10 in ids


@pytest.mark.asyncio
async def test_falha_na_narrativa_nao_impede_persistencia_do_calculo(client_tenant_a: AsyncClient, produto_com_saldo_10: str, mock_narrativa):
    from app.modules.inteligencia.narrativa.cliente_llm import NarrativaIndisponivel

    mock_narrativa.side_effect = NarrativaIndisponivel("chave não configurada")

    resp = await client_tenant_a.post("/api/v1/inteligencia/analisar")
    assert resp.status_code == 200, resp.text
    item = next(r for r in resp.json()["reposicoes"] if r["produto_id"] == produto_com_saldo_10)
    assert item["narrativa"] is None
    assert item["estoque_atual"] == 10.0  # o cálculo em si não foi afetado pela falha da LLM


@pytest.mark.asyncio
async def test_perfil_leitura_nao_pode_disparar_analise(client_leitura: AsyncClient):
    resp = await client_leitura.post("/api/v1/inteligencia/analisar")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_perfil_leitura_pode_ver_painel(client_leitura: AsyncClient):
    resp = await client_leitura.get("/api/v1/inteligencia/painel")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_isolamento_entre_tenants(client_tenant_a: AsyncClient, client_tenant_b: AsyncClient, produto_com_saldo_10: str):
    await client_tenant_a.post("/api/v1/inteligencia/analisar")
    resp_b = await client_tenant_b.get("/api/v1/inteligencia/painel")
    ids_b = [r["produto_id"] for r in resp_b.json()["reposicoes"]]
    assert produto_com_saldo_10 not in ids_b


@pytest.mark.asyncio
async def test_criar_pedido_de_reposicao_sem_analise_previa_retorna_404(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    resp = await client_tenant_a.post("/api/v1/inteligencia/reposicao/criar-pedido", json={"produto_id": produto_com_saldo_10})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_criar_pedido_de_reposicao_gera_pedido_real_em_compras(client_tenant_a: AsyncClient):
    produto = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto pra repor", "estoque_minimo": 5})
    produto_id = produto.json()["id"]
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 3}
    )
    for _ in range(4):
        await client_tenant_a.post(
            "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "saida", "quantidade": 1}
        )

    analise = await client_tenant_a.post("/api/v1/inteligencia/analisar")
    item = next(r for r in analise.json()["reposicoes"] if r["produto_id"] == produto_id)
    assert item["quantidade_sugerida"] > 0

    resp = await client_tenant_a.post("/api/v1/inteligencia/reposicao/criar-pedido", json={"produto_id": produto_id})
    assert resp.status_code == 201, resp.text
    pedido = resp.json()
    assert pedido["itens"][0]["produto_id"] == produto_id
    assert pedido["itens"][0]["quantidade"] == item["quantidade_sugerida"]

    # Confirma que é um pedido real e visível pelo módulo de Compras, não
    # um efeito colateral isolado do módulo de inteligência.
    listagem = await client_tenant_a.get("/api/v1/compras/pedidos")
    assert pedido["id"] in [p["id"] for p in listagem.json()]
