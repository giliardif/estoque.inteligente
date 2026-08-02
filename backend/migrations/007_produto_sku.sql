-- Adiciona SKU (código interno de referência) ao Produto, separado de
-- codigo_barras (que é o código de barras físico/EAN do fornecedor).
-- SKU é um código curto definido pela própria loja para uso interno
-- (etiquetas, buscas rápidas, relatórios).
--
-- Não enforçamos unicidade aqui de propósito: o mesmo padrão já existente
-- em codigo_barras (indexado, não único) é mantido por consistência — o
-- projeto ainda não trata IntegrityError/UniqueViolation em nenhum módulo,
-- então introduzir uma constraint única exigiria esse tratamento em vários
-- lugares de uma vez. Candidato a endurecer numa próxima etapa se o usuário
-- quiser SKU como identificador estritamente único por tenant.

alter table produtos add column sku text;

create index idx_produtos_sku on produtos(tenant_id, sku);
