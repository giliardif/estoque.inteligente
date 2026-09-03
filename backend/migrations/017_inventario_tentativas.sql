-- ============================================================
-- Migration 017 — Inventário: recontagem com limite de 3 tentativas
-- e log de auditoria de cada tentativa (não só o resultado final).
-- ============================================================

-- Contador rápido pra decisão de "já bateu o limite?" sem precisar
-- agregar a tabela de log toda vez.
alter table inventario_itens add column tentativas integer not null default 0;

-- Novo status intermediário: contagem divergente aguardando o operador
-- escolher entre recontar ou manter — antes disso virar 'divergente'
-- definitivo (visível pro supervisor).
alter table inventario_itens drop constraint if exists inventario_itens_status_item_check;
alter table inventario_itens add constraint inventario_itens_status_item_check
    check (status_item in ('pendente', 'aguardando_confirmacao', 'contado', 'divergente', 'aprovado', 'recontagem_solicitada'));

-- Log de cada tentativa de contagem (até 3), independente do resultado
-- final — é o que sustenta a tela de "Detalhes do Ciclo" (histórico
-- consultável depois, não só o resultado consolidado).
create table inventario_item_tentativas (
    id uuid primary key default gen_random_uuid(),
    inventario_item_id uuid not null references inventario_itens(id) on delete cascade,
    numero_tentativa integer not null,
    qtd_contada numeric(12,2) not null,
    usuario_id uuid references users(id),
    criado_em timestamptz not null default now()
);

create index idx_inventario_item_tentativas_item on inventario_item_tentativas(inventario_item_id);

-- Mesmo padrão de RLS de inventario_itens: isolamento via join, já que
-- inventario_item_tentativas também não carrega tenant_id direto.
alter table inventario_item_tentativas enable row level security;
alter table inventario_item_tentativas force row level security;

create policy tenant_isolation on inventario_item_tentativas
    using (inventario_item_id in (
        select ii.id from inventario_itens ii
        join inventarios inv on inv.id = ii.inventario_id
        where inv.tenant_id = (current_setting('app.tenant_id'))::uuid
    ));

-- GRANT não entra na migração versionada (role de aplicação tem nome
-- diferente por ambiente — app_estoque em staging, estoque_app_test local)
-- — cada ambiente concede via seu próprio script de setup, mesmo padrão
-- já usado em todas as migrações anteriores.
