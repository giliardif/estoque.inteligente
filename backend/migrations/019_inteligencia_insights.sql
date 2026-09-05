-- ============================================================
-- Migration 019 — Camada de Inteligência (Etapa 40): tabela que
-- persiste o resultado da camada analista (Python, determinística)
-- e, quando gerada, a narrativa da IA em cima desse resultado.
--
-- Regra de arquitetura: esta tabela é o único ponto de contato entre
-- as duas camadas. A camada narrativa (LLM) nunca lê tabelas de
-- negócio (produtos/movimentacoes) diretamente — só recebe o dado
-- já calculado, aqui persistido, como entrada.
-- ============================================================

create table insights_gerados (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references tenants(id) on delete cascade,
    produto_id uuid references produtos(id) on delete cascade,
    tipo varchar(30) not null
        check (tipo in ('reposicao', 'indicador_giro', 'anomalia', 'dead_stock', 'resumo_semanal')),

    -- Resultado da camada analista (Python puro). Formato livre por
    -- tipo (ex: reposicao guarda demanda_dia/tendencia/qtd_sugerida;
    -- indicador_giro guarda giro/cobertura_dias/risco_ruptura).
    dados_calculados jsonb not null,

    -- Hash do conteúdo relevante de dados_calculados usado pra decidir
    -- se vale a pena chamar a LLM de novo (não narra se nada mudou
    -- desde a última análise — economia de tokens).
    hash_calculo varchar(64) not null,

    -- Narrativa da IA sobre dados_calculados. Nula até a camada
    -- narrativa rodar; muitas linhas podem nunca precisar (ex: resumo
    -- semanal é sempre narrado, indicador_giro pode não ser).
    narrativa text,
    narrativa_gerada_em timestamptz,

    criado_em timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
);

-- Uma linha "vigente" por tenant+produto+tipo — nova análise
-- atualiza em vez de acumular histórico (não é log de auditoria,
-- é retrato calculado mais recente).
create unique index idx_insights_gerados_vigente
    on insights_gerados(tenant_id, tipo, coalesce(produto_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index idx_insights_gerados_tenant_tipo on insights_gerados(tenant_id, tipo);

alter table insights_gerados enable row level security;
alter table insights_gerados force row level security;

create policy tenant_isolation on insights_gerados
    using (tenant_id = (current_setting('app.tenant_id'))::uuid);

-- GRANT não entra na migração versionada (role de aplicação tem nome
-- diferente por ambiente — app_estoque em staging, estoque_app_test
-- local) — cada ambiente concede via seu próprio script de setup,
-- mesmo padrão já usado em todas as migrações anteriores.
