import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_perfil_operador_nao_cria_regra_de_alerta(client_operador: AsyncClient):
    """Só admin configura regras — operador pode executar o motor, mas não mudar os parâmetros."""
    response = await client_operador.post(
        "/api/v1/alertas/regras", json={"tipo": "estoque_baixo", "parametros": {}}
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_perfil_operador_nao_atualiza_regra_de_alerta(client_tenant_a: AsyncClient, client_operador: AsyncClient):
    criada = await client_tenant_a.post("/api/v1/alertas/regras", json={"tipo": "estoque_baixo", "parametros": {}})
    assert criada.status_code == 201
    regra_id = criada.json()["id"]

    response = await client_operador.patch(f"/api/v1/alertas/regras/{regra_id}", json={"ativo": False})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_desativa_regra_de_alerta(client_tenant_a: AsyncClient):
    criada = await client_tenant_a.post("/api/v1/alertas/regras", json={"tipo": "produto_parado", "parametros": {"dias_sem_movimento": 30}})
    regra_id = criada.json()["id"]

    response = await client_tenant_a.patch(f"/api/v1/alertas/regras/{regra_id}", json={"ativo": False})
    assert response.status_code == 200
    assert response.json()["ativo"] is False
    assert response.json()["parametros"] == {"dias_sem_movimento": 30}  # não alterado pelo PATCH parcial


@pytest.mark.asyncio
async def test_atualizar_regra_de_outro_tenant_e_bloqueado(client_tenant_a: AsyncClient, client_tenant_b: AsyncClient):
    criada_b = await client_tenant_b.post("/api/v1/alertas/regras", json={"tipo": "estoque_baixo", "parametros": {}})
    regra_b_id = criada_b.json()["id"]

    response = await client_tenant_a.patch(f"/api/v1/alertas/regras/{regra_b_id}", json={"ativo": False})
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_tipo_de_regra_invalido_e_rejeitado(client_tenant_a: AsyncClient):
    response = await client_tenant_a.post(
        "/api/v1/alertas/regras", json={"tipo": "tipo_inventado", "parametros": {}}
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_alertas_de_um_tenant_nao_aparecem_para_outro(client_tenant_a: AsyncClient, alerta_tenant_b_id: str):
    response = await client_tenant_a.get("/api/v1/alertas")
    ids = [a["id"] for a in response.json()]
    assert alerta_tenant_b_id not in ids


@pytest.mark.asyncio
async def test_marcar_lido_alerta_de_outro_tenant_e_bloqueado(client_tenant_a: AsyncClient, alerta_tenant_b_id: str):
    response = await client_tenant_a.post(f"/api/v1/alertas/{alerta_tenant_b_id}/marcar-lido")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_executar_motor_nao_duplica_alerta_ja_aberto(client_tenant_a: AsyncClient, produto_estoque_zerado: str):
    primeira = await client_tenant_a.post("/api/v1/alertas/executar")
    segunda = await client_tenant_a.post("/api/v1/alertas/executar")

    alertas = await client_tenant_a.get("/api/v1/alertas")
    tipos_produto = [a for a in alertas.json() if a["produto_id"] == produto_estoque_zerado and a["tipo"] == "estoque_baixo"]
    assert len(tipos_produto) == 1  # não duplicou mesmo rodando o motor duas vezes
