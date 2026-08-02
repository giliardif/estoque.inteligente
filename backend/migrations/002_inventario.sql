-- ============================================================
-- Migration 002 — Inventário físico
-- ============================================================

create table inventarios (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    deposito_id     uuid references depositos(id),
    status          text not null default 'aberto' check (status in ('aberto','fechado')),
    ciclo           text not null,
    criado_em       timestamptz not null default now()
);
create index idx_inventarios_tenant on inventarios(tenant_id);

create table inventario_itens (
    id              uuid primary key default gen_random_uuid(),
    inventario_id   uuid not null references inventarios(id) on delete cascade,
    produto_id      uuid not null references produtos(id),
    qtd_sistema     numeric(12,2) not null,
    qtd_contada     numeric(12,2),
    divergencia     numeric(12,2)
);
create index idx_inventario_itens_inventario on inventario_itens(inventario_id);

alter table inventarios enable row level security;
create policy tenant_isolation on inventarios
    using (tenant_id = current_setting('app.tenant_id')::uuid)
    with check (tenant_id = current_setting('app.tenant_id')::uuid);

-- inventario_itens não tem tenant_id direto: isolamento via join com inventarios.
-- RLS em tabela filha usa subquery contra a tabela pai.
alter table inventario_itens enable row level security;
create policy tenant_isolation on inventario_itens
    using (inventario_id in (select id from inventarios where tenant_id = current_setting('app.tenant_id')::uuid))
    with check (inventario_id in (select id from inventarios where tenant_id = current_setting('app.tenant_id')::uuid));
