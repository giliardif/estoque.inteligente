-- ============================================================
-- Migration 006 — Compras: pedidos e itens
-- (fornecedores já existe desde a migration 001)
-- ============================================================

create table pedidos_compra (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    fornecedor_id   uuid references fornecedores(id),
    status          text not null default 'rascunho'
                    check (status in ('rascunho','enviado','recebido_parcial','recebido','cancelado')),
    usuario_id      uuid references users(id),
    criado_em       timestamptz not null default now()
);
create index idx_pedidos_compra_tenant on pedidos_compra(tenant_id);

create table pedidos_compra_itens (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references tenants(id) on delete cascade,
    pedido_id           uuid not null references pedidos_compra(id) on delete cascade,
    produto_id          uuid not null references produtos(id),
    quantidade          numeric(12,2) not null,
    custo_unitario      numeric(12,2) not null,
    quantidade_recebida numeric(12,2) not null default 0
);
create index idx_pedidos_compra_itens_tenant on pedidos_compra_itens(tenant_id);
create index idx_pedidos_compra_itens_pedido on pedidos_compra_itens(pedido_id);

alter table pedidos_compra       enable row level security;
alter table pedidos_compra_itens enable row level security;

do $$
declare
    t text;
begin
    foreach t in array array['pedidos_compra','pedidos_compra_itens']
    loop
        execute format(
            'create policy tenant_isolation on %I using (tenant_id = current_setting(''app.tenant_id'')::uuid) with check (tenant_id = current_setting(''app.tenant_id'')::uuid);',
            t
        );
    end loop;
end $$;
