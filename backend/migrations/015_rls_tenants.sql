-- Etapa 37 (correção de segurança): habilita RLS em `tenants`.
--
-- Contexto: `tenants` ficou de fora da migration 001 de propósito — é a
-- própria raiz do tenant (cada linha É um tenant, não tem coluna
-- `tenant_id`), e até agora nenhum código de aplicação fazia consulta
-- por-tenant nela no dia a dia (só o cadastro inicial, via `auth_service`,
-- que já tem BYPASSRLS escopado a esta tabela). Risco foi avaliado como
-- zero e a decisão de aplicar RLS aqui foi conscientemente adiada.
--
-- Isso mudou na Etapa 37: agora existem endpoints reais (GET/PATCH
-- /api/v1/tenant) rodando pela conexão normal da aplicação — SEM bypass —
-- toda vez que alguém abre a tela de Configurações. A segurança desses
-- endpoints hoje depende inteiramente do filtro `WHERE id = tenant_id`
-- em app/modules/tenant/service.py nunca ser esquecido por um dev futuro.
-- Em todas as outras 19 tabelas do sistema, o Postgres pega esse tipo de
-- esquecimento sozinho (FORCE ROW LEVEL SECURITY); aqui não havia essa
-- rede de segurança. Fechando a lacuna agora com o mesmo padrão já
-- comprovado nas outras tabelas (ver Etapa da investigação de RLS,
-- 009_force_rls.sql).
--
-- Policy usa `id` em vez de `tenant_id` (não existe essa coluna aqui —
-- o id da própria linha É o tenant_id usado em todo o resto do sistema).
--
-- auth_service continua funcionando sem alteração: seu BYPASSRLS já é
-- escopado para incluir `tenants` (necessário pro cadastro/login, que
-- acontecem ANTES de sabermos o tenant_id do usuário — ver Etapa 1).

alter table tenants enable row level security;
alter table tenants force row level security;

create policy tenant_isolation on tenants
    using (id = current_setting('app.tenant_id')::uuid)
    with check (id = current_setting('app.tenant_id')::uuid);
