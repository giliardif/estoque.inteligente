"""
Sessão de banco assíncrona + aplicação de Row Level Security (RLS) por tenant.

Estratégia de isolamento multi-tenant (defesa em profundidade):
  1. Toda tabela de negócio tem coluna tenant_id (obrigatória, indexada).
  2. Toda policy de RLS no Postgres filtra por tenant_id = current_setting('app.tenant_id').
  3. A cada requisição, get_db() define app.tenant_id na sessão ANTES de qualquer query.
  Isso garante que mesmo um bug de aplicação (ex.: esquecer o filtro tenant_id numa
  query) não vaza dados entre clientes — o banco barra no nível de linha.
"""
import uuid
from collections.abc import AsyncGenerator
from uuid import UUID

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()

# NOTA (pooler Supabase / Supavisor, modo transaction - porta 6543):
# esse modo não suporta prepared statements nomeados persistentes. `statement_cache_size=0`
# é um parâmetro NATIVO do asyncpg.connect() — mas o dialeto asyncpg do SQLAlchemy não
# passa por esse caminho, ele chama connection.prepare() diretamente por baixo, então esse
# valor era ignorado na prática (causa real do "prepared statement __asyncpg_stmt_X__ does
# not exist" mesmo com essa opção presente). O parâmetro que o SQLAlchemy de fato respeita
# é `prepared_statement_cache_size` (nível do dialeto). Combinamos com
# `prepared_statement_name_func` gerando um nome único (UUID) por statement: mesmo que o
# Supavisor troque a conexão física por trás no meio do caminho (ex.: após período ocioso +
# pool_pre_ping), não há nome de statement fixo que possa ficar "orfão" de uma conexão
# anterior nem colidir com o de outra sessão concorrente compartilhando o mesmo backend.
_POOLER_CONNECT_ARGS = {
    "statement_cache_size": 0,
    "prepared_statement_cache_size": 0,
    "prepared_statement_name_func": lambda: f"__asyncpg_{uuid.uuid4()}__",
}

engine = create_async_engine(
    str(settings.DATABASE_URL),
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=5,
    connect_args=_POOLER_CONNECT_ARGS,
    # echo=True apenas em desenvolvimento — nunca logar SQL (pode conter dados sensíveis) em produção
    echo=(settings.ENV == "development"),
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db_for_tenant(tenant_id: UUID) -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        tenant_id_str = str(tenant_id)

        def _reaplicar_tenant_id(sess, transaction, connection) -> None:
            # set_config(..., true) só vale para a transação CORRENTE. Vários
            # services chamam `await db.commit()` no meio do fluxo (ex.:
            # criar() -> commit() -> refresh()) — o commit encerra a
            # transação e o refresh() abre uma nova implicitamente. Sem
            # reaplicar aqui, essa nova transação roda sem app.tenant_id
            # setado. Com um role restrito por RLS (sem BYPASSRLS/dono, o
            # tipo de role correto para produção), isso quebrava a query
            # seguinte com erro de tipo — um bug de disponibilidade real,
            # não só uma lacuna de teste. Este hook roda a cada nova
            # transação aberta nesta sessão (não só na primeira), então
            # cobre esse padrão sem precisar alterar cada service.py.
            connection.execute(
                text("SELECT set_config('app.tenant_id', :tenant_id, true)"),
                {"tenant_id": tenant_id_str},
            )

        event.listen(session.sync_session, "after_begin", _reaplicar_tenant_id)
        try:
            yield session
        finally:
            event.remove(session.sync_session, "after_begin", _reaplicar_tenant_id)
            await session.close()


# ------------------------------------------------------------------
# Sessão de autenticação — ÚNICA exceção ao isolamento por RLS.
#
# Login e refresh de token acontecem ANTES de sabermos o tenant_id (o
# usuário só informa e-mail/senha; o tenant é descoberto a partir do
# usuário encontrado). Não dá pra abrir uma sessão com app.tenant_id
# já setado porque ainda não o conhecemos.
#
# Mitigação: esta engine conecta como um papel de banco (`auth_service`)
# com permissão de BYPASSRLS concedida SOMENTE nas tabelas `users` e
# `refresh_tokens` — nunca em produtos, movimentações, vendas etc.
# Esse papel deve ser criado assim na migration/infra de produção:
#
#   CREATE ROLE auth_service LOGIN PASSWORD '...';
#   GRANT SELECT, INSERT, UPDATE ON users, refresh_tokens TO auth_service;
#   GRANT SELECT, INSERT ON tenants TO auth_service;  -- necessário só no cadastro inicial
#   ALTER TABLE users ENABLE ROW LEVEL SECURITY;  -- já habilitado
#   -- BYPASSRLS é concedido via ALTER ROLE, não via GRANT de tabela:
#   ALTER ROLE auth_service BYPASSRLS;
#
# Todo endpoint que usa get_db_auth() deve, MANUALMENTE, filtrar por
# tenant_id nas queries (o banco não faz mais essa validação por nós
# nesta conexão específica) — ver app/modules/auth/service.py.
# ------------------------------------------------------------------
auth_engine = create_async_engine(
    str(settings.AUTH_DATABASE_URL or settings.DATABASE_URL),
    pool_pre_ping=True,
    pool_size=5,
    connect_args=_POOLER_CONNECT_ARGS,
    echo=(settings.ENV == "development"),
)
AuthSessionLocal = async_sessionmaker(auth_engine, expire_on_commit=False, class_=AsyncSession)


async def get_db_auth() -> AsyncGenerator[AsyncSession, None]:
    async with AuthSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
