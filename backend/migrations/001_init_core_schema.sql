-- ============================================================
-- Migration 001 — Núcleo genérico multi-tenant
-- Toda tabela de negócio tem tenant_id + policy de RLS.
-- ============================================================

create extension if not exists "pgcrypto";  -- gen_random_uuid()
create extension if not exists "citext";    -- tipo de texto case-insensitive, usado no e-mail

create table tenants (
    id              uuid primary key default gen_random_uuid(),
    nome            text not null,
    segmento_slug   text not null,
    criado_em       timestamptz not null default now()
);

create table users (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    nome            text not null,
    email           citext not null unique,
    senha_hash      text not null,
    perfil          text not null check (perfil in ('admin', 'operador', 'leitura')),
    ativo           boolean not null default true,
    criado_em       timestamptz not null default now()
);

create table segment_configs (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    config_json     jsonb not null,
    versao          int not null default 1,
    atualizado_em   timestamptz not null default now()
);

create table themes (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    tokens_json     jsonb not null
);

create table categorias (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    nome            text not null,
    categoria_pai_id uuid references categorias(id)
);

create table depositos (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    nome            text not null,
    endereco        text
);

create table produtos (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references tenants(id) on delete cascade,
    categoria_id        uuid references categorias(id),
    nome                text not null,
    codigo_barras       text,
    unidade_medida      text not null default 'un',
    custo_medio         numeric(12,2) not null default 0,
    estoque_minimo      numeric(12,2) not null default 0,
    estoque_maximo      numeric(12,2),
    campos_customizados jsonb not null default '{}',
    ativo               boolean not null default true,
    criado_em           timestamptz not null default now()
);
create index idx_produtos_tenant on produtos(tenant_id);
create index idx_produtos_codigo_barras on produtos(tenant_id, codigo_barras);

create table lotes (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    produto_id      uuid not null references produtos(id) on delete cascade,
    codigo_lote     text not null,
    validade        date,
    quantidade      numeric(12,2) not null default 0,
    deposito_id     uuid references depositos(id)
);
create index idx_lotes_tenant on lotes(tenant_id);
create index idx_lotes_validade on lotes(tenant_id, validade);

create table movimentacoes (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references tenants(id) on delete cascade,
    produto_id          uuid not null references produtos(id),
    deposito_id         uuid references depositos(id),
    lote_id             uuid references lotes(id),
    tipo                text not null check (tipo in ('entrada','saida','ajuste','transferencia')),
    quantidade          numeric(12,2) not null,
    origem              text,
    referencia_externa  text,
    usuario_id          uuid references users(id),
    criado_em           timestamptz not null default now()
);
create index idx_movimentacoes_tenant on movimentacoes(tenant_id);
create index idx_movimentacoes_produto on movimentacoes(tenant_id, produto_id);

create table fornecedores (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    nome            text not null,
    documento       text,
    contato         text
);

create table notas_fiscais (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    numero          text not null,
    fornecedor_id   uuid references fornecedores(id),
    xml_raw         text not null,
    status          text not null default 'pendente' check (status in ('pendente','processada','erro')),
    criado_em       timestamptz not null default now()
);
create index idx_notas_fiscais_tenant on notas_fiscais(tenant_id);

create table regras_alerta (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    tipo            text not null check (tipo in ('validade','estoque_baixo','produto_parado')),
    parametros      jsonb not null default '{}',
    ativo           boolean not null default true
);

-- ============================================================
-- Row Level Security — isolamento por tenant no nível do banco
-- ============================================================

alter table users             enable row level security;
alter table segment_configs   enable row level security;
alter table themes            enable row level security;
alter table categorias        enable row level security;
alter table depositos         enable row level security;
alter table produtos          enable row level security;
alter table lotes             enable row level security;
alter table movimentacoes     enable row level security;
alter table fornecedores      enable row level security;
alter table notas_fiscais     enable row level security;
alter table regras_alerta     enable row level security;

-- Policy padrão aplicada a cada tabela: só enxerga/edita linhas do próprio tenant.
-- app.tenant_id é setado pela aplicação a cada requisição (ver core/database.py)
do $$
declare
    t text;
begin
    foreach t in array array[
        'users','segment_configs','themes','categorias','depositos',
        'produtos','lotes','movimentacoes','fornecedores','notas_fiscais','regras_alerta'
    ]
    loop
        execute format(
            'create policy tenant_isolation on %I using (tenant_id = current_setting(''app.tenant_id'')::uuid) with check (tenant_id = current_setting(''app.tenant_id'')::uuid);',
            t
        );
    end loop;
end $$;
