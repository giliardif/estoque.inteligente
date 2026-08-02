-- ============================================================
-- Migration 004 — Autenticação: refresh tokens e lockout de conta
-- ============================================================

alter table users add column if not exists tentativas_falhas int not null default 0;
alter table users add column if not exists bloqueado_ate timestamptz;

create table refresh_tokens (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    user_id         uuid not null references users(id) on delete cascade,
    -- Nunca armazenamos o refresh token em texto puro — só o hash (mesmo
    -- princípio de senha). Se o banco vazar, os tokens não são reutilizáveis.
    token_hash      text not null,
    expira_em       timestamptz not null,
    revogado        boolean not null default false,
    criado_em       timestamptz not null default now()
);
create index idx_refresh_tokens_user on refresh_tokens(user_id);
create index idx_refresh_tokens_tenant on refresh_tokens(tenant_id);

alter table refresh_tokens enable row level security;
create policy tenant_isolation on refresh_tokens
    using (tenant_id = current_setting('app.tenant_id')::uuid)
    with check (tenant_id = current_setting('app.tenant_id')::uuid);
