"""
Testes de autoatendimento de usuário (Etapa 37): editar o próprio nome e
enviar foto de perfil.

Cobre: GET/PATCH /usuarios/me funcionam pra qualquer perfil (é dado sobre
si mesmo, não sobre outros); validação de nome; upload de foto passa pelas
mesmas validações de arquivo que produtos (extensão/tamanho) e retorna 503
quando Storage não está configurado neste ambiente — mesmo comportamento
não coberto por sucesso end-to-end que já existia pra imagem de produto,
já que ambos dependem de credenciais reais do Supabase Storage.
"""
import io

import pytest


@pytest.mark.asyncio
async def test_admin_le_seus_proprios_dados(client_tenant_a):
    resp = await client_tenant_a.get("/api/v1/usuarios/me")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["nome"] == "Admin Teste"
    assert body["avatar_url"] is None


@pytest.mark.asyncio
async def test_operador_le_e_edita_proprio_nome(client_operador):
    resp = await client_operador.get("/api/v1/usuarios/me")
    assert resp.status_code == 200, resp.text

    resp = await client_operador.patch("/api/v1/usuarios/me", json={"nome": "Novo Nome Operador"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["nome"] == "Novo Nome Operador"

    resp = await client_operador.get("/api/v1/usuarios/me")
    assert resp.json()["nome"] == "Novo Nome Operador"


@pytest.mark.asyncio
async def test_leitura_tambem_pode_editar_proprio_nome(client_leitura):
    resp = await client_leitura.patch("/api/v1/usuarios/me", json={"nome": "Novo Nome Leitura"})
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_nome_vazio_e_rejeitado(client_tenant_a):
    resp = await client_tenant_a.patch("/api/v1/usuarios/me", json={"nome": "a"})
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_usuario_nao_altera_dados_de_outro_via_me(client_tenant_a, client_operador):
    """/usuarios/me só enxerga o próprio usuário do token — não existe jeito
    de passar outro usuario_id por esta rota."""
    resp = await client_operador.patch("/api/v1/usuarios/me", json={"nome": "Só eu mesmo"})
    assert resp.status_code == 200

    resp = await client_tenant_a.get("/api/v1/usuarios/me")
    assert resp.json()["nome"] == "Admin Teste"  # admin não foi afetado


@pytest.mark.asyncio
async def test_upload_foto_extensao_invalida_e_rejeitado(client_tenant_a):
    arquivo = io.BytesIO(b"conteudo qualquer")
    resp = await client_tenant_a.post(
        "/api/v1/usuarios/me/foto",
        files={"arquivo": ("foto.gif", arquivo, "image/gif")},
    )
    assert resp.status_code == 415, resp.text


@pytest.mark.asyncio
async def test_upload_foto_excede_limite_e_rejeitado(client_tenant_a):
    conteudo_grande = b"0" * (3 * 1024 * 1024)  # 3MB > limite de 2MB de avatar
    arquivo = io.BytesIO(conteudo_grande)
    resp = await client_tenant_a.post(
        "/api/v1/usuarios/me/foto",
        files={"arquivo": ("foto.jpg", arquivo, "image/jpeg")},
    )
    assert resp.status_code == 413, resp.text


@pytest.mark.asyncio
async def test_upload_foto_valida_retorna_503_sem_storage_configurado(client_tenant_a):
    """Neste ambiente de teste SUPABASE_URL não está setado — confirma que
    o arquivo válido passa das validações e falha especificamente por falta
    de configuração de infraestrutura, não por outro motivo."""
    arquivo = io.BytesIO(b"conteudo pequeno de imagem")
    resp = await client_tenant_a.post(
        "/api/v1/usuarios/me/foto",
        files={"arquivo": ("foto.jpg", arquivo, "image/jpeg")},
    )
    assert resp.status_code == 503, resp.text
