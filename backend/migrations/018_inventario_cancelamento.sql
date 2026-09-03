-- ============================================================
-- Migration 018 — Inventário: cancelamento de ciclo sem contagem
-- ============================================================
--
-- Ciclos podem nascer "vazios" (aberto antes de qualquer produto ativo
-- existir no tenant) ou simplesmente serem abertos por engano. Sem uma
-- forma de descartar, ficam presos em 'aberto' pra sempre (o backend
-- bloqueia abrir um novo ciclo enquanto houver um aberto pro mesmo
-- depósito). O cancelamento só é permitido quando NENHUM item ainda foi
-- contado — se já tem contagem real, o caminho é o fluxo normal
-- (enviar-analise -> aprovar-final), não cancelamento.

alter table inventarios drop constraint inventarios_status_check;
alter table inventarios add constraint inventarios_status_check
    check (status in ('aberto', 'em_analise', 'fechado', 'cancelado'));
