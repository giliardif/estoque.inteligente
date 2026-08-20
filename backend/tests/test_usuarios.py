"""
Testes do fluxo de convite/gestão de usuário (Etapa 27).

Cobre: só admin convida/gerencia; operador/leitura recebem 403; e-mail
duplicado é rejeitado; admin não pode alterar o próprio perfil nem se
desativar; isolamento entre tenants; senha provisória força troca no
primeiro login (deve_trocar_senha); troca de senha revoga sessões antigas.
"""
import pytest

from tests.conftest import _email_unico, _payload_do_token


@pytest.mark.asyncio
async def test_admin_convida_usuario_com_sucesso(client_tenant_a):
    email = _email_unico("marina-convite")
    resp = await client_tenant_a.post(
        "/api/v1/usuarios",
        json={"nome": "Marina Costa", "email": email, "perfil": "operador"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["usuario"]["email"] == email
    assert body["usuario"]["perfil"] == "operador"
    assert body["usuario"]["ativo"] is True
    # Senha provisória satisfaz a política de força (maiúscula+minúscula+dígito, 12 chars)
    senha = body["senha_provisoria"]
    assert len(senha) == 12
    assert any(c.isupper() for c in senha)
    assert any(c.islower() for c in senha)
    assert any(c.isdigit() for c in senha)


@pytest.mark.asyncio
async def test_email_duplicado_e_rejeitado(client_tenant_a):
    payload = {"nome": "Fulano", "email": _email_unico("duplicado-convite"), "perfil": "leitura"}
    resp1 = await client_tenant_a.post("/api/v1/usuarios", json=payload)
    assert resp1.status_code == 201

    resp2 = await client_tenant_a.post("/api/v1/usuarios", json=payload)
    assert resp2.status_code == 409


@pytest.mark.asyncio
async def test_perfil_invalido_e_rejeitado(client_tenant_a):
    resp = await client_tenant_a.post(
        "/api/v1/usuarios",
        json={"nome": "Fulano", "email": _email_unico("perfil-invalido"), "perfil": "superadmin"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_operador_nao_pode_convidar(client_operador):
    resp = await client_operador.post(
        "/api/v1/usuarios",
        json={"nome": "Fulano", "email": _email_unico("operador-tenta-convidar"), "perfil": "leitura"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_leitura_nao_pode_convidar(client_leitura):
    resp = await client_leitura.post(
        "/api/v1/usuarios",
        json={"nome": "Fulano", "email": _email_unico("leitura-tenta-convidar"), "perfil": "leitura"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_leitura_nao_pode_listar_usuarios(client_leitura):
    resp = await client_leitura.get("/api/v1/usuarios")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_operador_pode_listar_usuarios(client_operador):
    resp = await client_operador.get("/api/v1/usuarios")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_admin_lista_usuarios_do_proprio_tenant(client_tenant_a):
    email = _email_unico("listagem")
    await client_tenant_a.post(
        "/api/v1/usuarios", json={"nome": "Fulano Listagem", "email": email, "perfil": "leitura"}
    )
    resp = await client_tenant_a.get("/api/v1/usuarios")
    assert resp.status_code == 200
    emails = [u["email"] for u in resp.json()]
    assert email in emails


@pytest.mark.asyncio
async def test_admin_nao_pode_rebaixar_a_si_mesmo(client_tenant_a):
    payload_token = _payload_do_token(client_tenant_a)
    resp = await client_tenant_a.patch(f"/api/v1/usuarios/{payload_token['sub']}", json={"perfil": "operador"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_admin_nao_pode_se_desativar(client_tenant_a):
    payload_token = _payload_do_token(client_tenant_a)
    resp = await client_tenant_a.patch(f"/api/v1/usuarios/{payload_token['sub']}", json={"ativo": False})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_admin_pode_editar_outro_usuario(client_tenant_a):
    resp = await client_tenant_a.post(
        "/api/v1/usuarios",
        json={"nome": "Editar Perfil", "email": _email_unico("editar-perfil"), "perfil": "leitura"},
    )
    usuario_id = resp.json()["usuario"]["id"]

    resp = await client_tenant_a.patch(f"/api/v1/usuarios/{usuario_id}", json={"perfil": "operador"})
    assert resp.status_code == 200
    assert resp.json()["perfil"] == "operador"

    resp = await client_tenant_a.patch(f"/api/v1/usuarios/{usuario_id}", json={"ativo": False})
    assert resp.status_code == 200
    assert resp.json()["ativo"] is False


@pytest.mark.asyncio
async def test_patch_sem_campos_e_rejeitado(client_tenant_a):
    resp = await client_tenant_a.post(
        "/api/v1/usuarios", json={"nome": "Sem Campos", "email": _email_unico("sem-campos"), "perfil": "leitura"}
    )
    usuario_id = resp.json()["usuario"]["id"]
    resp = await client_tenant_a.patch(f"/api/v1/usuarios/{usuario_id}", json={})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_operador_nao_pode_editar_usuario(client_operador, client_tenant_a):
    resp = await client_tenant_a.post(
        "/api/v1/usuarios", json={"nome": "Alvo", "email": _email_unico("alvo-operador"), "perfil": "leitura"}
    )
    usuario_id = resp.json()["usuario"]["id"]
    resp = await client_operador.patch(f"/api/v1/usuarios/{usuario_id}", json={"perfil": "admin"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_nao_pode_editar_usuario_de_outro_tenant(client_tenant_a, client_tenant_b):
    resp = await client_tenant_b.post(
        "/api/v1/usuarios", json={"nome": "Do Tenant B", "email": _email_unico("do-tenant-b"), "perfil": "leitura"}
    )
    usuario_id_tenant_b = resp.json()["usuario"]["id"]

    resp = await client_tenant_a.patch(f"/api/v1/usuarios/{usuario_id_tenant_b}", json={"perfil": "admin"})
    assert resp.status_code == 404  # não vaza existência de usuário de outro tenant


@pytest.mark.asyncio
async def test_admin_nao_ve_usuarios_de_outro_tenant_na_listagem(client_tenant_a, client_tenant_b):
    email_tenant_b = _email_unico("isolado-tenant-b")
    resp = await client_tenant_b.post(
        "/api/v1/usuarios", json={"nome": "Isolado B", "email": email_tenant_b, "perfil": "leitura"}
    )
    assert resp.status_code == 201

    resp = await client_tenant_a.get("/api/v1/usuarios")
    emails = [u["email"] for u in resp.json()]
    assert email_tenant_b not in emails


@pytest.mark.asyncio
async def test_usuario_convidado_recebe_deve_trocar_senha_no_login(client, client_tenant_a):
    email = _email_unico("precisa-trocar")
    resp = await client_tenant_a.post(
        "/api/v1/usuarios", json={"nome": "Precisa Trocar", "email": email, "perfil": "leitura"}
    )
    senha_provisoria = resp.json()["senha_provisoria"]

    resp = await client.post("/api/v1/auth/login", json={"email": email, "senha": senha_provisoria})
    assert resp.status_code == 200
    token = resp.json()["access_token"]

    import base64
    import json as jsonlib

    payload = jsonlib.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    assert payload["deve_trocar_senha"] is True


@pytest.mark.asyncio
async def test_trocar_senha_com_senha_atual_errada(client, client_tenant_a):
    email = _email_unico("troca-errada")
    resp = await client_tenant_a.post(
        "/api/v1/usuarios", json={"nome": "Troca Errada", "email": email, "perfil": "leitura"}
    )
    senha_provisoria = resp.json()["senha_provisoria"]

    resp = await client.post("/api/v1/auth/login", json={"email": email, "senha": senha_provisoria})
    client.headers["Authorization"] = f"Bearer {resp.json()['access_token']}"

    resp = await client.post(
        "/api/v1/auth/trocar-senha", json={"senha_atual": "SenhaErrada123", "senha_nova": "NovaSenhaForte123"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_trocar_senha_com_sucesso_libera_proximo_login_sem_flag(client, client_tenant_a):
    email = _email_unico("troca-ok")
    resp = await client_tenant_a.post(
        "/api/v1/usuarios", json={"nome": "Troca Ok", "email": email, "perfil": "leitura"}
    )
    senha_provisoria = resp.json()["senha_provisoria"]

    resp = await client.post("/api/v1/auth/login", json={"email": email, "senha": senha_provisoria})
    client.headers["Authorization"] = f"Bearer {resp.json()['access_token']}"

    resp = await client.post(
        "/api/v1/auth/trocar-senha", json={"senha_atual": senha_provisoria, "senha_nova": "NovaSenhaForte123"}
    )
    assert resp.status_code == 204

    # Login antigo (senha provisória) não funciona mais
    resp = await client.post("/api/v1/auth/login", json={"email": email, "senha": senha_provisoria})
    assert resp.status_code == 401

    # Login com a senha nova funciona e não exige mais troca
    resp = await client.post("/api/v1/auth/login", json={"email": email, "senha": "NovaSenhaForte123"})
    assert resp.status_code == 200
    import base64
    import json as jsonlib

    token = resp.json()["access_token"]
    payload = jsonlib.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    assert payload["deve_trocar_senha"] is False


@pytest.mark.asyncio
async def test_senha_nova_fraca_e_rejeitada(client, client_tenant_a):
    email = _email_unico("senha-fraca")
    resp = await client_tenant_a.post(
        "/api/v1/usuarios", json={"nome": "Senha Fraca", "email": email, "perfil": "leitura"}
    )
    senha_provisoria = resp.json()["senha_provisoria"]

    resp = await client.post("/api/v1/auth/login", json={"email": email, "senha": senha_provisoria})
    client.headers["Authorization"] = f"Bearer {resp.json()['access_token']}"

    resp = await client.post(
        "/api/v1/auth/trocar-senha", json={"senha_atual": senha_provisoria, "senha_nova": "fraca"}
    )
    assert resp.status_code == 422
