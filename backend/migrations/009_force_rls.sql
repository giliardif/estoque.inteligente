-- Migration 009: FORCE ROW LEVEL SECURITY em todas as tabelas com política
-- de isolamento por tenant.
--
-- Contexto: por padrão, o Postgres NÃO aplica RLS ao dono da tabela (só a
-- outros roles). Isso significa que qualquer conexão feita com o role dono
-- das tabelas — por exemplo, o role usado para rodar migrations, ou um role
-- de administração/backoffice futuro — ignora silenciosamente o isolamento
-- entre tenants, mesmo com RLS "habilitada" (ENABLE ROW LEVEL SECURITY).
--
-- FORCE ROW LEVEL SECURITY faz a política valer também para o dono da
-- tabela (exceto para roles com o atributo SUPERUSER, que sempre ignoram
-- RLS no Postgres — isso não tem como ser mudado via SQL, só evitando que
-- o role de aplicação em produção seja superuser, o que já é o caso aqui).
--
-- Validado com teste real: sem este FORCE, uma conexão como o dono da
-- tabela via SELECT retornava produtos de dois tenants diferentes mesmo
-- com app.tenant_id setado corretamente. Com FORCE + um role dono
-- não-superuser, o isolamento passou a valer também para o dono.
--
-- Nenhum impacto para a aplicação em produção: o role usado pelas conexões
-- normais (get_db_for_tenant) já não é dono nem superuser, então já
-- respeitava RLS antes desta migration. Este FORCE é defesa em
-- profundidade — cobre cenários futuros (ex: um script administrativo
-- rodando com o role dono por engano, ou um novo ambiente de teste que
-- reutilize esse role sem querer).

-- Observação: "tenants" não entra aqui de propósito — é a própria tabela
-- raiz de tenants (cada linha É um tenant, não tem tenant_id, não tem
-- policy de isolamento por linha).
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE segment_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE themes FORCE ROW LEVEL SECURITY;
ALTER TABLE categorias FORCE ROW LEVEL SECURITY;
ALTER TABLE fornecedores FORCE ROW LEVEL SECURITY;
ALTER TABLE depositos FORCE ROW LEVEL SECURITY;
ALTER TABLE produtos FORCE ROW LEVEL SECURITY;
ALTER TABLE lotes FORCE ROW LEVEL SECURITY;
ALTER TABLE movimentacoes FORCE ROW LEVEL SECURITY;
ALTER TABLE inventarios FORCE ROW LEVEL SECURITY;
ALTER TABLE inventario_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE vendas FORCE ROW LEVEL SECURITY;
ALTER TABLE venda_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE notas_fiscais FORCE ROW LEVEL SECURITY;
ALTER TABLE notas_fiscais_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE regras_alerta FORCE ROW LEVEL SECURITY;
ALTER TABLE alertas_gerados FORCE ROW LEVEL SECURITY;
ALTER TABLE pedidos_compra FORCE ROW LEVEL SECURITY;
ALTER TABLE pedidos_compra_itens FORCE ROW LEVEL SECURITY;
