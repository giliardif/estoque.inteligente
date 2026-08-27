"""
Testes do módulo Tenant / Empresa (Etapa 37).

Cobre: leitura por qualquer perfil; edição só por admin; validação de CNPJ
por dígito verificador (não só contagem de dígitos); isolamento entre
tenants — atenção redobrada aqui porque `tenants` não tem RLS (ver
app/modules/tenant/service.py), então um bug de isolamento neste módulo
NÃO seria pego pelo Postgres como em outras tabelas.
"""
import pytest

CNPJ_VALIDO = "11.022.233/0001-01"


@pytest.mark.asyncio
async def test_admin_le_dados_do_tenant(client_tenant_a):
    resp = await client_tenant_a.get("/api/v1/tenant")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["nome"] == "Empresa Teste"
    assert body["segmento_slug"] == "generico"
    assert body["cnpj"] is None


@pytest.mark.asyncio
async def test_leitura_tambem_pode_ler_tenant(client_leitura):
    resp = await client_leitura.get("/api/v1/tenant")
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_admin_atualiza_nome_e_cnpj(client_tenant_a):
    resp = await client_tenant_a.patch("/api/v1/tenant", json={"nome": "Doce Encanto Ltda", "cnpj": CNPJ_VALIDO})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["nome"] == "Doce Encanto Ltda"
    assert body["cnpj"] == "11022233000101"  # normalizado, só dígitos

    resp = await client_tenant_a.get("/api/v1/tenant")
    assert resp.json()["cnpj"] == "11022233000101"


@pytest.mark.asyncio
async def test_cnpj_com_digito_verificador_invalido_e_rejeitado(client_tenant_a):
    resp = await client_tenant_a.patch("/api/v1/tenant", json={"cnpj": "11.222.333/0001-99"})
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_cnpj_com_quantidade_errada_de_digitos_e_rejeitado(client_tenant_a):
    resp = await client_tenant_a.patch("/api/v1/tenant", json={"cnpj": "123456"})
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_operador_nao_pode_editar_tenant(client_operador):
    resp = await client_operador.patch("/api/v1/tenant", json={"nome": "Tentativa Indevida"})
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_leitura_nao_pode_editar_tenant(client_leitura):
    resp = await client_leitura.patch("/api/v1/tenant", json={"nome": "Tentativa Indevida"})
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_patch_sem_nenhum_campo_e_rejeitado(client_tenant_a):
    resp = await client_tenant_a.patch("/api/v1/tenant", json={})
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_isolamento_entre_tenants(client_tenant_a, client_tenant_b):
    """Crítico: tenants não tem RLS — se o service esquecer o filtro por id,
    esse teste é o que pegaria um tenant editando/vendo o CNPJ do outro."""
    resp = await client_tenant_a.patch("/api/v1/tenant", json={"cnpj": CNPJ_VALIDO})
    assert resp.status_code == 200, resp.text

    resp_b = await client_tenant_b.get("/api/v1/tenant")
    assert resp_b.status_code == 200, resp_b.text
    assert resp_b.json()["cnpj"] is None
    assert resp_b.json()["nome"] != "Doce Encanto Ltda"
