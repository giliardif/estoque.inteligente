"""
Fixtures reais para os testes automatizados — sobem a aplicação de verdade
(via ASGITransport, sem subir um servidor HTTP separado) contra um Postgres
de teste real, já que RLS (Row Level Security) só existe no Postgres e não
pode ser simulado com SQLite.

Pré-requisito: rodar `./scripts/setup_test_db.sh` uma vez antes (cria o
banco de teste + os roles restritos abaixo e aplica as migrations). Ver
README.md — seção "Rodando os testes de segurança".

IMPORTANTE sobre os roles usados aqui: DATABASE_URL aponta para
`estoque_app_test`, que NÃO é dono das tabelas e NÃO tem BYPASSRLS — é o
mesmo tipo de role que a aplicação usa em produção. Isso é proposital:
rodar os testes com um role dono/superuser faz o Postgres ignorar RLS
silenciosamente (superuser e dono sempre bypassam RLS por padrão), então
a suíte estaria validando só o filtro de tenant_id feito em código
(SQLAlchemy), não o enforcement de verdade do banco. Com um role restrito,
um bug que esqueça o filtro de tenant_id na aplicação ainda seria pego
pelo RLS do Postgres — e os testes de isolamento (test_tenant_isolation.py)
de fato exercitam essa camada.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Variáveis de ambiente mínimas para a aplicação subir em modo de teste.
# RATE_LIMIT_AUTH é elevado aqui de propósito: o valor de produção (5/minute)
# faria os testes automatizados colidirem entre si (todos compartilham o
# mesmo IP de origem no cliente de teste). Isso NÃO afeta o comportamento em
# produção — é só o valor usado nesta sessão de testes.
os.environ.setdefault("ENV", "development")
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://estoque_app_test:apppass@localhost:5432/estoque_test"
)
os.environ.setdefault(
    "AUTH_DATABASE_URL", "postgresql+asyncpg://estoque_auth_test:authpass@localhost:5432/estoque_test"
)
os.environ.setdefault("SECRET_KEY", "chave-de-teste-com-tamanho-minimo-de-32-caracteres-ok")
os.environ.setdefault("ALLOWED_ORIGINS", '["http://localhost:3000"]')
os.environ["RATE_LIMIT_AUTH"] = "20/minute"
os.environ["RATE_LIMIT_DEFAULT"] = "5000/minute"

from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402

TEST_DB_URL = os.environ["DATABASE_URL"]


def _email_unico(prefixo: str) -> str:
    return f"{prefixo}-{uuid.uuid4().hex[:10]}@teste.com"


def _novo_transporte() -> ASGITransport:
    """
    Cada cliente de teste recebe um IP simulado ÚNICO. Sem isso, o slowapi
    (rate limit) usa request.client.host como chave — e o ASGITransport do
    httpx usa o mesmo host fake para TODAS as instâncias por padrão, fazendo
    todos os testes compartilharem o mesmo "balde" de rate limit. Um teste
    que testa o próprio rate limit de propósito (test_auth.py) esgotaria a
    cota de todos os outros testes que rodassem logo depois. IPs simulados
    distintos = mesmo isolamento que usuários reais têm em produção.
    """
    ip_fake = f"10.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
    return ASGITransport(app=app, client=(ip_fake, 12345))


async def _registrar_e_logar(client: AsyncClient, email: str, senha: str) -> None:
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "nome_empresa": "Empresa Teste",
            "segmento_slug": "generico",
            "admin_nome": "Admin Teste",
            "admin_email": email,
            "admin_senha": senha,
        },
    )
    assert resp.status_code == 201, resp.text
    resp = await client.post("/api/v1/auth/login", json={"email": email, "senha": senha})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"


@pytest_asyncio.fixture
async def client():
    """Cliente sem autenticação — para testar registro/login/lockout."""
    transport = _novo_transporte()
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def client_tenant_a():
    """Cliente autenticado como admin de um tenant novo e isolado."""
    transport = _novo_transporte()
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await _registrar_e_logar(ac, _email_unico("tenant-a"), "SenhaForteA123")
        yield ac


@pytest_asyncio.fixture
async def client_tenant_b():
    """Segundo tenant, para testes de isolamento entre clientes."""
    transport = _novo_transporte()
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await _registrar_e_logar(ac, _email_unico("tenant-b"), "SenhaForteB123")
        yield ac


async def _criar_usuario_direto_no_banco(tenant_id: str, perfil: str, senha: str) -> str:
    """
    Não existe (ainda) endpoint de API para um admin convidar/criar outro
    usuário (operador/leitura) dentro do mesmo tenant — só o cadastro inicial
    de tenant+admin. Isso é uma lacuna de produto real, registrada no DEVLOG.
    Para testar perfis restritos, o usuário é inserido direto no banco aqui.
    """
    engine = create_async_engine(TEST_DB_URL)
    email = _email_unico(perfil)
    async with engine.begin() as conn:
        # DATABASE_URL agora é um role sujeito a RLS de verdade (não tem
        # BYPASSRLS nem é dono das tabelas) — sem setar app.tenant_id aqui,
        # o INSERT falharia a checagem WITH CHECK da policy de isolamento.
        await conn.execute(text("SELECT set_config('app.tenant_id', :tenant_id, true)"), {"tenant_id": tenant_id})
        await conn.execute(
            text(
                "INSERT INTO users (id, tenant_id, nome, email, senha_hash, perfil, ativo) "
                "VALUES (gen_random_uuid(), :tenant_id, :nome, :email, :senha_hash, :perfil, true)"
            ),
            {
                "tenant_id": tenant_id, "nome": f"Usuário {perfil}", "email": email,
                "senha_hash": hash_password(senha), "perfil": perfil,
            },
        )
    await engine.dispose()
    return email


@pytest_asyncio.fixture
async def client_leitura(client_tenant_a):
    """Usuário de perfil 'leitura' no MESMO tenant do client_tenant_a."""
    resp = await client_tenant_a.get("/api/v1/produtos")  # garante que o tenant já existe
    assert resp.status_code == 200
    # tenant_id extraído do token JWT do client_tenant_a
    import base64
    import json

    token = client_tenant_a.headers["Authorization"].split(" ")[1]
    payload = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    tenant_id = payload["tenant_id"]

    senha = "SenhaLeitura123"
    email = await _criar_usuario_direto_no_banco(tenant_id, "leitura", senha)

    transport = _novo_transporte()
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/api/v1/auth/login", json={"email": email, "senha": senha})
        assert resp.status_code == 200, resp.text
        ac.headers["Authorization"] = f"Bearer {resp.json()['access_token']}"
        yield ac


@pytest_asyncio.fixture
async def client_operador(client_tenant_a):
    import base64
    import json

    token = client_tenant_a.headers["Authorization"].split(" ")[1]
    payload = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
    tenant_id = payload["tenant_id"]

    senha = "SenhaOperador123"
    email = await _criar_usuario_direto_no_banco(tenant_id, "operador", senha)

    transport = _novo_transporte()
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/api/v1/auth/login", json={"email": email, "senha": senha})
        assert resp.status_code == 200, resp.text
        ac.headers["Authorization"] = f"Bearer {resp.json()['access_token']}"
        yield ac


@pytest_asyncio.fixture
async def produto_tenant_b_id(client_tenant_b):
    resp = await client_tenant_b.post("/api/v1/produtos", json={"nome": "Produto do Tenant B", "estoque_minimo": 5})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest_asyncio.fixture
async def produto_com_saldo_10(client_tenant_a):
    resp = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto com saldo 10", "estoque_minimo": 3})
    produto_id = resp.json()["id"]
    resp = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 10}
    )
    assert resp.status_code == 201, resp.text
    return produto_id


@pytest_asyncio.fixture
async def produto_com_saldo_acima_do_minimo(client_tenant_a):
    resp = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto com saldo alto", "estoque_minimo": 5})
    produto_id = resp.json()["id"]
    resp = await client_tenant_a.post(
        "/api/v1/estoque/movimentacoes", json={"produto_id": produto_id, "tipo": "entrada", "quantidade": 50}
    )
    assert resp.status_code == 201, resp.text
    return produto_id


@pytest_asyncio.fixture
async def produto_estoque_zerado(client_tenant_a):
    resp = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Produto zerado", "estoque_minimo": 5})
    return resp.json()["id"]


@pytest_asyncio.fixture
async def usuario_valido_email(client):
    email = _email_unico("login-teste")
    await _registrar_e_logar(client, email, "SenhaCorreta123")
    client.headers.pop("Authorization", None)  # o teste de login não deve começar autenticado
    return email


@pytest_asyncio.fixture
async def pedido_com_item_10un(client_tenant_a, produto_com_saldo_10):
    resp = await client_tenant_a.post(
        "/api/v1/compras/pedidos",
        json={"itens": [{"produto_id": produto_com_saldo_10, "quantidade": 10, "custo_unitario": 2.5}]},
    )
    assert resp.status_code == 201, resp.text
    corpo = resp.json()
    return {"pedido_id": corpo["id"], "item_id": corpo["itens"][0]["id"], "produto_id": produto_com_saldo_10}


@pytest_asyncio.fixture
async def pedido_tenant_b(client_tenant_b, produto_tenant_b_id):
    resp = await client_tenant_b.post(
        "/api/v1/compras/pedidos",
        json={"itens": [{"produto_id": produto_tenant_b_id, "quantidade": 5, "custo_unitario": 1.0}]},
    )
    assert resp.status_code == 201, resp.text
    corpo = resp.json()
    return {"pedido_id": corpo["id"], "item_id": corpo["itens"][0]["id"]}


@pytest_asyncio.fixture
async def alerta_tenant_b_id(client_tenant_b):
    resp = await client_tenant_b.post("/api/v1/produtos", json={"nome": "Produto B alerta", "estoque_minimo": 100})
    await client_tenant_b.post("/api/v1/alertas/executar")
    resp = await client_tenant_b.get("/api/v1/alertas")
    alertas = resp.json()
    assert len(alertas) > 0
    return alertas[0]["id"]


@pytest_asyncio.fixture
async def item_nota_tenant_b_id(client_tenant_b):
    xml = b"""<?xml version="1.0"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe><ide><nNF>1</nNF></ide>
<emit><xNome>Fornecedor B</xNome><CNPJ>99999999000199</CNPJ></emit>
<det><prod><xProd>ITEM TENANT B</xProd><cEAN>111</cEAN><qCom>1</qCom><vUnCom>1.0</vUnCom></prod></det>
</infNFe></NFe>"""
    resp = await client_tenant_b.post(
        "/api/v1/notas-fiscais/importar", files={"arquivo": ("nota.xml", xml, "application/xml")}
    )
    nota_id = resp.json()["id"]
    resp = await client_tenant_b.get(f"/api/v1/notas-fiscais/{nota_id}/itens")
    return resp.json()[0]["id"]


@pytest_asyncio.fixture
async def client_token_expirado():
    """Cliente com um JWT válido na assinatura, mas com exp no passado."""
    from jose import jwt

    from app.core.config import get_settings

    settings = get_settings()
    payload = {
        "sub": str(uuid.uuid4()),
        "tenant_id": str(uuid.uuid4()),
        "perfil": "admin",
        "exp": datetime.now(timezone.utc) - timedelta(minutes=5),
    }
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

    transport = _novo_transporte()
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        ac.headers["Authorization"] = f"Bearer {token}"
        yield ac


@pytest_asyncio.fixture
async def xml_nfe_produto_novo():
    return b"""<?xml version="1.0"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe><ide><nNF>999</nNF></ide>
<emit><xNome>Fornecedor Teste</xNome><CNPJ>11222333000144</CNPJ></emit>
<det><prod><xProd>PRODUTO TOTALMENTE NOVO</xProd><cEAN>555</cEAN><qCom>3</qCom><vUnCom>9.9</vUnCom></prod></det>
</infNFe></NFe>"""
