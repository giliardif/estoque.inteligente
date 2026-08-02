#!/usr/bin/env bash
# Recria o banco de testes local do zero, com roles que espelham a
# separação de privilégios real de produção:
#
#   - estoque_migrator  → dono das tabelas, roda as migrations. Deve ser
#                          usado SÓ para setup, nunca pela aplicação.
#   - estoque_app_test  → role que a aplicação usa nas requisições normais
#                          (equivalente ao role de app em produção): NÃO é
#                          dono das tabelas, SEM BYPASSRLS. É o role usado
#                          em DATABASE_URL pelos testes — assim a suíte
#                          exercita o RLS do Postgres de verdade, não só o
#                          filtro de tenant_id feito pela aplicação.
#   - estoque_auth_test → equivalente ao `auth_service` de produção: tem
#                          BYPASSRLS, mas só enxerga users/refresh_tokens/
#                          tenants via GRANT explícito — usado em
#                          AUTH_DATABASE_URL.
#
# Anteriormente os testes rodavam com um único role superuser e dono das
# tabelas — o que faz o Postgres ignorar RLS por completo (superuser
# sempre ignora RLS, independente de FORCE ROW LEVEL SECURITY). Isso foi
# confirmado com um teste real que reproduziu o vazamento entre tenants
# usando esse role. Ver DEVLOG.md para o registro completo dessa
# investigação.
#
# Uso:
#   ./scripts/setup_test_db.sh
#
# Requer um Postgres local acessível como superuser (localmente isso é
# tipicamente o role "postgres" via socket, ou o role padrão do
# docker-compose). Ajuste ADMIN_PSQL se o seu ambiente for diferente.

set -euo pipefail

DB_NAME="${TEST_DB_NAME:-estoque_test}"
MIGRATOR_PASS="${TEST_MIGRATOR_PASS:-testpass}"
APP_PASS="${TEST_APP_PASS:-apppass}"
AUTH_PASS="${TEST_AUTH_PASS:-authpass}"

# Comando para rodar SQL como superuser administrativo (cria roles/banco).
# Por padrão usa o socket local via `sudo -u postgres psql`; sobrescreva
# com ADMIN_PSQL se necessário (ex: para rodar contra o container do
# docker-compose: 'docker exec -i estoque-inteligente-db-1 psql -U dev').
ADMIN_PSQL="${ADMIN_PSQL:-sudo -u postgres psql}"

echo "==> Recriando banco '$DB_NAME' e roles de teste..."
$ADMIN_PSQL <<SQL
DROP DATABASE IF EXISTS ${DB_NAME};
DROP ROLE IF EXISTS estoque_migrator;
DROP ROLE IF EXISTS estoque_app_test;
DROP ROLE IF EXISTS estoque_auth_test;

CREATE ROLE estoque_migrator LOGIN PASSWORD '${MIGRATOR_PASS}' NOSUPERUSER CREATEDB;
CREATE DATABASE ${DB_NAME} OWNER estoque_migrator;

CREATE ROLE estoque_app_test LOGIN PASSWORD '${APP_PASS}' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE estoque_auth_test LOGIN PASSWORD '${AUTH_PASS}' NOSUPERUSER BYPASSRLS;
SQL

echo "==> Aplicando migrations como estoque_migrator (dono das tabelas)..."
for f in "$(dirname "$0")"/../migrations/*.sql; do
  echo "  - $(basename "$f")"
  PGPASSWORD="${MIGRATOR_PASS}" psql -h localhost -U estoque_migrator -d "${DB_NAME}" -v ON_ERROR_STOP=1 -f "$f" > /dev/null
done

echo "==> Concedendo privilégios mínimos aos roles de aplicação..."
PGPASSWORD="${MIGRATOR_PASS}" psql -h localhost -U estoque_migrator -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<SQL
-- estoque_app_test: acesso normal de CRUD, sujeito a RLS (não é dono, sem bypass)
GRANT USAGE ON SCHEMA public TO estoque_app_test;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO estoque_app_test;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO estoque_app_test;

-- estoque_auth_test: espelha o auth_service de produção — bypass de RLS
-- concedido pelo CREATE ROLE acima, mas GRANT de tabela restrito só ao
-- que o fluxo de autenticação precisa (login/registro acontecem antes de
-- sabermos o tenant_id, então não dá pra depender de RLS nesse caminho).
GRANT USAGE ON SCHEMA public TO estoque_auth_test;
GRANT SELECT, INSERT, UPDATE ON users, refresh_tokens TO estoque_auth_test;
GRANT SELECT, INSERT ON tenants TO estoque_auth_test;
SQL

echo "==> Pronto. Exporte estas variáveis antes de rodar pytest:"
echo ""
echo "  export DATABASE_URL=postgresql+asyncpg://estoque_app_test:${APP_PASS}@localhost:5432/${DB_NAME}"
echo "  export AUTH_DATABASE_URL=postgresql+asyncpg://estoque_auth_test:${AUTH_PASS}@localhost:5432/${DB_NAME}"
echo ""
echo "  (conftest.py já usa esses valores como default se as variáveis não"
echo "   estiverem setadas — mas setar explicitamente evita depender do"
echo "   default silenciosamente ficar desatualizado)."
