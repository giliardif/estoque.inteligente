-- Corrige um bug real, não só uma lacuna de UI: até aqui, "transferencia"
-- era tratado como uma saída simples no cálculo de saldo total (ver
-- estoque/service.py antes desta etapa) — ou seja, toda transferência
-- entre depósitos da mesma loja estava silenciosamente reduzindo o saldo
-- TOTAL do produto, quando deveria só mover a mercadoria de um depósito
-- pro outro sem alterar o total.
--
-- Correção: uma transferência passa a ser gravada como DUAS linhas de
-- movimentacoes — uma "saida" no depósito de origem e uma "entrada" no
-- depósito de destino — ligadas por este grupo. Isso reaproveita a lógica
-- de saldo que já existe pra entrada/saída (uma soma, a outra subtrai; o
-- efeito líquido no total é zero, que é o comportamento correto). Não foi
-- necessário adicionar deposito_destino_id: cada uma das duas linhas já
-- carrega seu próprio deposito_id (origem na linha de saída, destino na
-- linha de entrada).
--
-- Sem dado de produção envolvendo transferencia até agora (funcionalidade
-- nunca funcionou corretamente), então não há linhas antigas para migrar.

alter table movimentacoes add column grupo_transferencia_id uuid;

create index idx_movimentacoes_grupo_transferencia on movimentacoes(tenant_id, grupo_transferencia_id)
    where grupo_transferencia_id is not null;
