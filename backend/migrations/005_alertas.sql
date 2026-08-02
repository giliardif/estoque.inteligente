-- ============================================================
-- Migration 005 — Alertas gerados
-- (a tabela regras_alerta já existe desde a migration 001)
-- ============================================================

create table alertas_gerados (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    regra_id        uuid references regras_alerta(id),
    tipo            text not null check (tipo in ('validade','estoque_baixo','produto_parado')),
    produto_id      uuid not null references produtos(id),
    mensagem        text not null,
    lido            boolean not null default false,
    criado_em       timestamptz not null default now()
);
create index idx_alertas_tenant on alertas_gerados(tenant_id);
create index idx_alertas_produto on alertas_gerados(tenant_id, produto_id);

-- Evita duplicar alerta a cada execução do motor: só permite UM alerta em
-- aberto (não lido) por produto+tipo por vez. É um índice único PARCIAL
-- (só considera linhas com lido = false) — se fosse uma unique constraint
-- comum incluindo a coluna `lido`, o histórico quebraria assim que dois
-- alertas do mesmo produto/tipo fossem marcados como lidos (violaria a
-- constraint na segunda vez), o que é o comportamento normal e esperado.
create unique index idx_alertas_aberto_unico on alertas_gerados(tenant_id, produto_id, tipo) where not lido;

alter table alertas_gerados enable row level security;
create policy tenant_isolation on alertas_gerados
    using (tenant_id = current_setting('app.tenant_id')::uuid)
    with check (tenant_id = current_setting('app.tenant_id')::uuid);
