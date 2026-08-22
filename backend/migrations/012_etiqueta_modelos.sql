-- Etapa 29: Infraestrutura de código de barras / QR — busca por código
-- (usa a coluna produtos.codigo_barras já existente desde a migration 001,
-- sem alteração de schema nela) + modelos salvos de etiqueta.
--
-- config_json guarda a configuração completa do modelo (elementos exibidos,
-- tipo de código, tamanho da etiqueta, colunas por página, margem,
-- espaçamento, impressora/modo de impressão preferido) como um único bloco
-- opaco pro backend — a UI é quem interpreta a forma desse JSON. Mesmo
-- padrão de campos_customizados em produtos: schema livre no banco,
-- validação de forma na camada de service/schema Pydantic.
--
-- Sem unique constraint em (tenant_id, nome): dois modelos com o mesmo
-- nome não quebram nada tecnicamente, e forçar unicidade aqui é uma regra
-- de UX (evitar confusão), não de integridade de dado — fica pro frontend
-- avisar em duplicata, não pro banco rejeitar.

create table etiqueta_modelos (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    nome            text not null,
    config_json     jsonb not null default '{}'::jsonb,
    criado_em       timestamptz not null default now(),
    atualizado_em   timestamptz not null default now()
);
create index idx_etiqueta_modelos_tenant on etiqueta_modelos(tenant_id);

alter table etiqueta_modelos enable row level security;
alter table etiqueta_modelos force row level security;
create policy tenant_isolation on etiqueta_modelos
    using (tenant_id = current_setting('app.tenant_id')::uuid)
    with check (tenant_id = current_setting('app.tenant_id')::uuid);
