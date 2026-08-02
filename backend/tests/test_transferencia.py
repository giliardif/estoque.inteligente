"""
Testa a correção do bug de transferência: antes desta etapa, uma
transferência era gravada como uma saída simples e subtraía do saldo TOTAL
do produto — o correto é mover a mercadoria de um depósito pra outro sem
alterar o total. Ver migration 008 e `_registrar_transferencia` em
estoque/service.py.
"""
import pytest
from httpx import AsyncClient


async def _criar_produto_e_depositos(client: AsyncClient, *, saldo_inicial: float, deposito_origem_nome: str):
    produto = await client.post("/api/v1/produtos", json={"nome": "Produto Transferível"})
    produto_id = produto.json()["id"]
    origem = await client.post("/api/v1/depositos", json={"nome": deposito_origem_nome})
    destino = await client.post("/api/v1/depositos", json={"nome": f"{deposito_origem_nome} (destino)"})
    origem_id, destino_id = origem.json()["id"], destino.json()["id"]

    await client.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto_id, "tipo": "entrada", "quantidade": saldo_inicial, "deposito_id": origem_id},
    )
    return produto_id, origem_id, destino_id


@pytest.mark.asyncio
async def test_transferencia_nao_altera_saldo_total_do_produto(client_tenant_a: AsyncClient):
    produto_id, origem_id, destino_id = await _criar_produto_e_depositos(
        client_tenant_a, saldo_inicial=20, deposito_origem_nome="Loja"
    )

    resp = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={
            "produto_id": produto_id, "tipo": "transferencia", "quantidade": 8,
            "deposito_origem_id": origem_id, "deposito_destino_id": destino_id,
        },
    )
    assert resp.status_code == 201, resp.text

    saldo = await client_tenant_a.get("/api/v1/estoque/saldo")
    item = next(p for p in saldo.json() if p["produto_id"] == produto_id)
    assert item["saldo"] == 20  # total inalterado — só mudou de depósito


@pytest.mark.asyncio
async def test_transferencia_move_saldo_entre_depositos_corretamente(client_tenant_a: AsyncClient):
    produto_id, origem_id, destino_id = await _criar_produto_e_depositos(
        client_tenant_a, saldo_inicial=20, deposito_origem_nome="Estoque A"
    )
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={
            "produto_id": produto_id, "tipo": "transferencia", "quantidade": 8,
            "deposito_origem_id": origem_id, "deposito_destino_id": destino_id,
        },
    )

    saldo = await client_tenant_a.get("/api/v1/estoque/saldo")
    item = next(p for p in saldo.json() if p["produto_id"] == produto_id)
    posicoes = {p["deposito_id"]: p["saldo"] for p in item["posicoes"]}
    assert posicoes[origem_id] == 12
    assert posicoes[destino_id] == 8


@pytest.mark.asyncio
async def test_transferencia_grava_duas_linhas_ligadas_pelo_mesmo_grupo(client_tenant_a: AsyncClient):
    produto_id, origem_id, destino_id = await _criar_produto_e_depositos(
        client_tenant_a, saldo_inicial=10, deposito_origem_nome="Galpão"
    )

    resp = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={
            "produto_id": produto_id, "tipo": "transferencia", "quantidade": 3,
            "deposito_origem_id": origem_id, "deposito_destino_id": destino_id,
        },
    )
    corpo = resp.json()
    assert len(corpo) == 2
    tipos = sorted(m["tipo"] for m in corpo)
    assert tipos == ["entrada", "saida"]
    assert corpo[0]["grupo_transferencia_id"] is not None
    assert corpo[0]["grupo_transferencia_id"] == corpo[1]["grupo_transferencia_id"]


@pytest.mark.asyncio
async def test_transferencia_e_bloqueada_se_origem_nao_tem_saldo_suficiente_mesmo_com_saldo_total_ok(
    client_tenant_a: AsyncClient
):
    """O ponto central do bug: saldo total pode estar de sobra (por causa de
    OUTRO depósito), mas isso não deve liberar uma transferência maior do
    que o que aquele depósito específico realmente tem."""
    produto = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto Pouco na Origem"})
    produto_id = produto.json()["id"]
    origem = await client_tenant_a.post("/api/v1/depositos", json={"nome": "Origem com pouco"})
    destino = await client_tenant_a.post("/api/v1/depositos", json={"nome": "Destino"})
    outro = await client_tenant_a.post("/api/v1/depositos", json={"nome": "Outro depósito com muito"})
    origem_id, destino_id, outro_id = origem.json()["id"], destino.json()["id"], outro.json()["id"]

    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 2, "deposito_id": origem_id},
    )
    await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 100, "deposito_id": outro_id},
    )

    resp = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={
            "produto_id": produto_id, "tipo": "transferencia", "quantidade": 5,
            "deposito_origem_id": origem_id, "deposito_destino_id": destino_id,
        },
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_transferencia_para_o_mesmo_deposito_e_rejeitada(client_tenant_a: AsyncClient):
    produto_id, origem_id, _ = await _criar_produto_e_depositos(client_tenant_a, saldo_inicial=5, deposito_origem_nome="Depósito X")
    resp = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={
            "produto_id": produto_id, "tipo": "transferencia", "quantidade": 1,
            "deposito_origem_id": origem_id, "deposito_destino_id": origem_id,
        },
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_transferencia_sem_deposito_origem_ou_destino_e_rejeitada(client_tenant_a: AsyncClient):
    produto = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Sem depósitos"})
    resp = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={"produto_id": produto.json()["id"], "tipo": "transferencia", "quantidade": 1},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_transferencia_com_deposito_de_outro_tenant_e_bloqueada(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient
):
    deposito_b = await client_tenant_b.post("/api/v1/depositos", json={"nome": "Depósito do Tenant B"})
    deposito_b_id = deposito_b.json()["id"]
    produto_a, origem_a_id, _ = await _criar_produto_e_depositos(client_tenant_a, saldo_inicial=10, deposito_origem_nome="Depósito A")

    resp = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes",
        json={
            "produto_id": produto_a, "tipo": "transferencia", "quantidade": 1,
            "deposito_origem_id": origem_a_id, "deposito_destino_id": deposito_b_id,
        },
    )
    assert resp.status_code == 404
