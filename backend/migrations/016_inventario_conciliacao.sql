-- ============================================================
-- Migration 016 — Inventário: fluxo de encerramento e aprovação
-- (Etapa 39 — separa contagem do operador do ajuste real de estoque,
-- que passa a exigir conciliação de um perfil supervisor/admin)
-- ============================================================

-- inventarios: novo status intermediário 'em_analise' — a contagem do
-- operador para aqui, sem tocar o estoque real. Só 'fechado' (aprovação
-- final do supervisor) grava movimentações.
alter table inventarios drop constraint inventarios_status_check;
alter table inventarios add constraint inventarios_status_check
    check (status in ('aberto', 'em_analise', 'fechado'));

-- Trilha de auditoria do ciclo: quem enviou a contagem (operador) e quem
-- aprovou o ajuste real (supervisor/admin), com horário de cada etapa.
alter table inventarios add column enviado_por uuid references users(id);
alter table inventarios add column enviado_em timestamptz;
alter table inventarios add column aprovado_por uuid references users(id);
alter table inventarios add column aprovado_em timestamptz;

-- inventario_itens: estado por item (permite decisão individual do
-- supervisor — aprovar ajuste ou pedir recontagem — sem esperar o ciclo
-- inteiro), justificativa/anexo de divergência, e custo unitário
-- congelado no momento da contagem (usado para calcular o impacto
-- financeiro em runtime, nunca persistido — mesmo princípio já usado
-- para margem_percentual).
alter table inventario_itens add column status_item text not null default 'pendente'
    check (status_item in ('pendente', 'contado', 'divergente', 'aprovado', 'recontagem_solicitada'));
alter table inventario_itens add column motivo text
    check (motivo in ('avaria', 'vencimento', 'furto', 'erro_entrada'));
alter table inventario_itens add column anexo_url text;
alter table inventario_itens add column custo_unitario numeric(12,2);
alter table inventario_itens add column decidido_por uuid references users(id);
alter table inventario_itens add column decidido_em timestamptz;

create index idx_inventario_itens_status on inventario_itens(status_item);
