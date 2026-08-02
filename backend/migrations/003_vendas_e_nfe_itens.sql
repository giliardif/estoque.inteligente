-- ============================================================
-- Migration 003 — Vendas/PDV e itens de nota fiscal (matching)
-- ============================================================

create table notas_fiscais_itens (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references tenants(id) on delete cascade,
    nota_id             uuid not null references notas_fiscais(id) on delete cascade,
    descricao_xml       text not null,
    codigo_ean_xml      text,
    produto_id          uuid references produtos(id),   -- nulo até reconhecimento/cadastro
    quantidade          numeric(12,2) not null,
    valor_unitario      numeric(12,2) not null,
    status_match        text not null default 'pendente_cadastro'
                         check (status_match in ('reconhecido','pendente_cadastro','ignorado'))
);
create index idx_nfe_itens_tenant on notas_fiscais_itens(tenant_id);
create index idx_nfe_itens_nota on notas_fiscais_itens(nota_id);

create table vendas (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    status          text not null default 'aberta' check (status in ('aberta','finalizada','cancelada')),
    valor_total     numeric(12,2) not null default 0,
    usuario_id      uuid references users(id),
    criado_em       timestamptz not null default now(),
    finalizado_em   timestamptz
);
create index idx_vendas_tenant on vendas(tenant_id);

create table venda_itens (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    venda_id        uuid not null references vendas(id) on delete cascade,
    produto_id      uuid not null references produtos(id),
    quantidade      numeric(12,2) not null,
    preco_unitario  numeric(12,2) not null
);
create index idx_venda_itens_tenant on venda_itens(tenant_id);
create index idx_venda_itens_venda on venda_itens(venda_id);

alter table notas_fiscais_itens enable row level security;
alter table vendas             enable row level security;
alter table venda_itens        enable row level security;

do $$
declare
    t text;
begin
    foreach t in array array['notas_fiscais_itens','vendas','venda_itens']
    loop
        execute format(
            'create policy tenant_isolation on %I using (tenant_id = current_setting(''app.tenant_id'')::uuid) with check (tenant_id = current_setting(''app.tenant_id'')::uuid);',
            t
        );
    end loop;
end $$;
