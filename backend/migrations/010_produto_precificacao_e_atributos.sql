-- Etapa 25: Preço de venda + margem, marca, NCM, imagem do produto,
-- flag de controle de lote/validade.
--
-- Decisão registrada (conversa com Giliardi): custo_medio permanece como
-- campo MANUAL hoje (não existe cálculo de média ponderada a partir de
-- Compras/NF-e no sistema atual, apesar do nome). Migrar para média
-- ponderada de verdade fica registrado como item de backlog futuro — não
-- implementado nesta etapa.
--
-- preco_venda é opcional (produto pode não ter preço de venda definido
-- ainda). margem NÃO é persistida — é sempre derivada de custo_medio e
-- preco_venda em tempo de leitura, pra nunca divergir do que os dois
-- campos realmente valem.

alter table produtos
    add column preco_venda   numeric(12,2),
    add column marca         text,
    add column ncm           text,
    add column imagem_url    text,
    add column controla_lote boolean not null default false;

comment on column produtos.preco_venda is
    'Preço de venda manual do produto. Opcional. Margem é calculada em runtime a partir de custo_medio, nunca persistida.';
comment on column produtos.controla_lote is
    'Flag informativa: indica que o produto deveria rastrear lote/validade nas entradas. A captura de lote/validade em si (tabela lotes) ainda não tem endpoint de escrita nem UI — fica pro backlog.';
