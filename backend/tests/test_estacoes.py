"""
Etapa 36: Estações de Impressão — impressão mediada pelo backend.

Cobre: registro (token entregue uma única vez), autenticação da estação
por token opaco (independente de sessão de usuário), fila de jobs
(criar/listar/concluir/reimprimir manual), isolamento entre tenants, e
revogação de acesso.
"""
import pytest
from httpx import AsyncClient


async def _registrar_estacao(client: AsyncClient, nome: str = "Caixa 1") -> dict:
    resp = await client.post(
        "/api/v1/estacoes", json={"nome": nome, "impressora_nome": "Elgin L42 Pro"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_registrar_estacao_retorna_token_uma_vez(client_tenant_a: AsyncClient):
    estacao = await _registrar_estacao(client_tenant_a)
    assert "token" in estacao
    assert len(estacao["token"]) > 20
    assert estacao["online"] is False  # ainda sem heartbeat

    listagem = await client_tenant_a.get("/api/v1/estacoes")
    assert listagem.status_code == 200
    corpo = listagem.json()
    assert len(corpo) == 1
    assert "token" not in corpo[0]  # token nunca reaparece depois do registro


@pytest.mark.asyncio
async def test_operador_nao_pode_registrar_estacao(client_operador: AsyncClient):
    resp = await client_operador.post(
        "/api/v1/estacoes", json={"nome": "Caixa 2", "impressora_nome": "Zebra"}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_leitura_pode_listar_estacoes(client_tenant_a: AsyncClient, client_leitura: AsyncClient):
    await _registrar_estacao(client_tenant_a)
    resp = await client_leitura.get("/api/v1/estacoes")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_token_estacao_autentica_e_gera_heartbeat(client_tenant_a: AsyncClient):
    estacao = await _registrar_estacao(client_tenant_a)
    token = estacao["token"]

    resp = await client_tenant_a.get("/api/v1/estacoes/fila/pendentes", headers={"X-Estacao-Token": token})
    assert resp.status_code == 200
    assert resp.json() == []

    # heartbeat: agora a estação deve aparecer como online
    listagem = await client_tenant_a.get("/api/v1/estacoes")
    assert listagem.json()[0]["online"] is True


@pytest.mark.asyncio
async def test_token_invalido_e_rejeitado(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.get(
        "/api/v1/estacoes/fila/pendentes", headers={"X-Estacao-Token": "token-forjado-qualquer"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_estacao_nao_depende_de_sessao_de_usuario(client_tenant_a: AsyncClient):
    """O ponto central da Etapa 36: revogar TODOS os tokens de sessão do
    usuário (equivalente a logout/expiração em outro dispositivo) não
    pode derrubar a estação — ela usa uma credencial própria."""
    estacao = await _registrar_estacao(client_tenant_a)
    token = estacao["token"]

    # Simula o usuário deslogando (revoga refresh tokens) — não afeta a
    # estação, que segue autenticando com o token opaco próprio dela.
    logout = await client_tenant_a.post("/api/v1/auth/logout")
    assert logout.status_code in (200, 204)

    resp = await client_tenant_a.get("/api/v1/estacoes/fila/pendentes", headers={"X-Estacao-Token": token})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_fluxo_completo_de_um_job_de_impressao(client_tenant_a: AsyncClient):
    estacao = await _registrar_estacao(client_tenant_a)
    token = estacao["token"]

    criado = await client_tenant_a.post(
        "/api/v1/estacoes/fila",
        json={
            "estacao_id": estacao["id"],
            "titulo": "Brigadeiro Gourmet 100g",
            "quantidade": 12,
            "payload_json": {"html": "<div>etiqueta</div>"},
        },
    )
    assert criado.status_code == 201, criado.text
    job = criado.json()
    assert job["status"] == "pendente"
    assert job["estacao_nome"] == "Caixa 1"

    pendentes = await client_tenant_a.get("/api/v1/estacoes/fila/pendentes", headers={"X-Estacao-Token": token})
    assert len(pendentes.json()) == 1
    assert pendentes.json()[0]["id"] == job["id"]

    concluido = await client_tenant_a.post(
        f"/api/v1/estacoes/fila/{job['id']}/concluir", headers={"X-Estacao-Token": token}
    )
    assert concluido.status_code == 200
    assert concluido.json()["status"] == "impresso"

    # depois de concluído, não aparece mais como pendente pra estação
    pendentes_depois = await client_tenant_a.get(
        "/api/v1/estacoes/fila/pendentes", headers={"X-Estacao-Token": token}
    )
    assert pendentes_depois.json() == []


@pytest.mark.asyncio
async def test_reimpressao_e_sempre_manual_nunca_automatica(client_tenant_a: AsyncClient):
    estacao = await _registrar_estacao(client_tenant_a)
    token = estacao["token"]

    criado = await client_tenant_a.post(
        "/api/v1/estacoes/fila",
        json={"estacao_id": estacao["id"], "titulo": "Item com erro", "quantidade": 1},
    )
    job_id = criado.json()["id"]

    erro = await client_tenant_a.post(f"/api/v1/estacoes/fila/{job_id}/erro", headers={"X-Estacao-Token": token})
    assert erro.status_code == 200
    assert erro.json()["status"] == "erro"

    # job original continua com status erro — nada reenviou sozinho
    fila = await client_tenant_a.get("/api/v1/estacoes/fila")
    original = next(j for j in fila.json() if j["id"] == job_id)
    assert original["status"] == "erro"

    # reimpressão manual cria um NOVO job pendente, sem alterar o original
    reimpresso = await client_tenant_a.post(f"/api/v1/estacoes/fila/{job_id}/reimprimir")
    assert reimpresso.status_code == 201, reimpresso.text
    novo = reimpresso.json()
    assert novo["id"] != job_id
    assert novo["status"] == "pendente"
    assert novo["titulo"] == "Item com erro"


@pytest.mark.asyncio
async def test_nao_pode_reimprimir_job_ja_impresso(client_tenant_a: AsyncClient):
    estacao = await _registrar_estacao(client_tenant_a)
    token = estacao["token"]
    criado = await client_tenant_a.post(
        "/api/v1/estacoes/fila", json={"estacao_id": estacao["id"], "titulo": "Item ok", "quantidade": 1}
    )
    job_id = criado.json()["id"]
    await client_tenant_a.post(f"/api/v1/estacoes/fila/{job_id}/concluir", headers={"X-Estacao-Token": token})

    resp = await client_tenant_a.post(f"/api/v1/estacoes/fila/{job_id}/reimprimir")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_revogar_acesso_invalida_token_imediatamente(client_tenant_a: AsyncClient):
    estacao = await _registrar_estacao(client_tenant_a)
    token = estacao["token"]

    revogar = await client_tenant_a.post(f"/api/v1/estacoes/{estacao['id']}/revogar")
    assert revogar.status_code == 204

    resp = await client_tenant_a.get("/api/v1/estacoes/fila/pendentes", headers={"X-Estacao-Token": token})
    assert resp.status_code == 401

    # some da listagem (revogada não é mais retornada)
    listagem = await client_tenant_a.get("/api/v1/estacoes")
    assert listagem.json() == []


@pytest.mark.asyncio
async def test_operador_nao_pode_revogar_estacao(client_tenant_a: AsyncClient, client_operador: AsyncClient):
    estacao = await _registrar_estacao(client_tenant_a)
    resp = await client_operador.post(f"/api/v1/estacoes/{estacao['id']}/revogar")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_isolamento_de_estacoes_entre_tenants(client_tenant_a: AsyncClient, client_tenant_b: AsyncClient):
    estacao_a = await _registrar_estacao(client_tenant_a, nome="Estação do Tenant A")

    listagem_b = await client_tenant_b.get("/api/v1/estacoes")
    assert listagem_b.json() == []

    # tenant B tenta mandar um job pra estação do tenant A — 404, não 403
    tentativa = await client_tenant_b.post(
        "/api/v1/estacoes/fila",
        json={"estacao_id": estacao_a["id"], "titulo": "Tentativa cross-tenant", "quantidade": 1},
    )
    assert tentativa.status_code == 404

    # tenant B tenta revogar a estação do tenant A — também 404
    revogar_b = await client_tenant_b.post(f"/api/v1/estacoes/{estacao_a['id']}/revogar")
    assert revogar_b.status_code == 404


@pytest.mark.asyncio
async def test_estacao_so_ve_e_conclui_jobs_da_propria_fila(client_tenant_a: AsyncClient):
    estacao_1 = await _registrar_estacao(client_tenant_a, nome="Caixa 1")
    estacao_2 = await _registrar_estacao(client_tenant_a, nome="Depósito")

    job = await client_tenant_a.post(
        "/api/v1/estacoes/fila",
        json={"estacao_id": estacao_1["id"], "titulo": "Item da Caixa 1", "quantidade": 1},
    )
    job_id = job.json()["id"]

    # token do Depósito não consegue concluir um job que é da Caixa 1
    resp = await client_tenant_a.post(
        f"/api/v1/estacoes/fila/{job_id}/concluir", headers={"X-Estacao-Token": estacao_2["token"]}
    )
    assert resp.status_code == 404

    pendentes_deposito = await client_tenant_a.get(
        "/api/v1/estacoes/fila/pendentes", headers={"X-Estacao-Token": estacao_2["token"]}
    )
    assert pendentes_deposito.json() == []


@pytest.mark.asyncio
async def test_filtro_de_status_na_listagem_da_fila(client_tenant_a: AsyncClient):
    estacao = await _registrar_estacao(client_tenant_a)
    token = estacao["token"]
    j1 = await client_tenant_a.post(
        "/api/v1/estacoes/fila", json={"estacao_id": estacao["id"], "titulo": "Pendente", "quantidade": 1}
    )
    j2 = await client_tenant_a.post(
        "/api/v1/estacoes/fila", json={"estacao_id": estacao["id"], "titulo": "Vai imprimir", "quantidade": 1}
    )
    await client_tenant_a.post(f"/api/v1/estacoes/fila/{j2.json()['id']}/concluir", headers={"X-Estacao-Token": token})

    pendentes = await client_tenant_a.get("/api/v1/estacoes/fila?status_filtro=pendente")
    assert len(pendentes.json()) == 1
    assert pendentes.json()[0]["id"] == j1.json()["id"]

    impressos = await client_tenant_a.get("/api/v1/estacoes/fila?status_filtro=impresso")
    assert len(impressos.json()) == 1
    assert impressos.json()[0]["id"] == j2.json()["id"]


@pytest.mark.asyncio
async def test_leitura_nao_pode_criar_job_impressao(client_leitura: AsyncClient, client_tenant_a: AsyncClient):
    estacao = await _registrar_estacao(client_tenant_a)
    resp = await client_leitura.post(
        "/api/v1/estacoes/fila", json={"estacao_id": estacao["id"], "titulo": "X", "quantidade": 1}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_criar_job_para_estacao_revogada_falha(client_tenant_a: AsyncClient):
    estacao = await _registrar_estacao(client_tenant_a)
    await client_tenant_a.post(f"/api/v1/estacoes/{estacao['id']}/revogar")

    resp = await client_tenant_a.post(
        "/api/v1/estacoes/fila", json={"estacao_id": estacao["id"], "titulo": "X", "quantidade": 1}
    )
    assert resp.status_code == 404
