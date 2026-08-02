import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_cadastro_com_senha_fraca_e_rejeitado(client: AsyncClient):
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "nome_empresa": "Doce Encanto", "segmento_slug": "bomboniere",
            "admin_nome": "Ana", "admin_email": "ana@doceencanto.com", "admin_senha": "12345678",
        },
    )
    assert response.status_code == 422  # sem maiúscula/minúscula combinadas


@pytest.mark.asyncio
async def test_login_com_senha_errada_nao_revela_se_email_existe(client: AsyncClient):
    resposta_email_inexistente = await client.post(
        "/api/v1/auth/login", json={"email": "naoexiste@x.com", "senha": "qualquer"}
    )
    resposta_senha_errada = await client.post(
        "/api/v1/auth/login", json={"email": "ana@doceencanto.com", "senha": "SenhaErrada123"}
    )
    assert resposta_email_inexistente.status_code == resposta_senha_errada.status_code == 401
    assert resposta_email_inexistente.json()["detail"] == resposta_senha_errada.json()["detail"]


@pytest.mark.asyncio
async def test_conta_bloqueia_apos_cinco_tentativas_erradas(client: AsyncClient, usuario_valido_email: str):
    for _ in range(5):
        r = await client.post("/api/v1/auth/login", json={"email": usuario_valido_email, "senha": "SenhaErrada1"})
        assert r.status_code == 401

    # 6ª tentativa, mesmo com a senha CORRETA, deve falhar — conta está bloqueada
    r = await client.post("/api/v1/auth/login", json={"email": usuario_valido_email, "senha": "SenhaCorreta123"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_usado_duas_vezes_e_rejeitado_na_segunda(client: AsyncClient, usuario_valido_email: str):
    """Rotação: reuso de um refresh token já trocado deve falhar (sinal de possível roubo).
    O refresh token trafega via cookie httpOnly, setado automaticamente no login —
    o teste usa o cookie jar do client, nunca lê o valor do token diretamente."""
    login = await client.post(
        "/api/v1/auth/login", json={"email": usuario_valido_email, "senha": "SenhaCorreta123"}
    )
    assert login.status_code == 200
    assert "refresh_token" in login.cookies

    primeira = await client.post("/api/v1/auth/refresh")  # cookie enviado automaticamente pelo client
    assert primeira.status_code == 200

    # Simula reapresentação do cookie antigo (já rotacionado/revogado no backend)
    client.cookies.set("refresh_token", login.cookies["refresh_token"])
    segunda = await client.post("/api/v1/auth/refresh")
    assert segunda.status_code == 401


@pytest.mark.asyncio
async def test_refresh_sem_cookie_e_rejeitado(client: AsyncClient):
    response = await client.post("/api/v1/auth/refresh")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_rate_limit_de_login_bloqueia_apos_muitas_tentativas(client: AsyncClient):
    """
    O valor de RATE_LIMIT_AUTH usado nesta suíte de testes (20/minute) é
    diferente do valor de produção (5/minute, ver .env.example) — elevado o
    suficiente para não colidir com o rate limit *default* global (que essa
    suíte também eleva, para as demais requisições de setup não pesarem
    aqui). Este teste não assume o número exato do limite: dispara volume
    suficiente para estourar qualquer limite razoável e confirma que o
    mecanismo de rate limit (HTTP 429) existe e funciona.
    """
    respostas = [
        await client.post("/api/v1/auth/login", json={"email": "x@x.com", "senha": "errada"})
        for _ in range(30)
    ]
    assert any(r.status_code == 429 for r in respostas)
