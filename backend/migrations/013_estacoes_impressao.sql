-- Etapa 36: Estações de Impressão — impressão mediada pelo backend.
--
-- Contexto: o sistema passa a ser usado via mobile, e celular não tem como
-- rodar QZ Tray (agente local de impressão). Solução: o dispositivo que
-- pede a impressão (celular, PC sem QZ Tray) nunca fala direto com a
-- impressora — ele grava um job na fila (filas_impressao) e um PC fixo
-- com impressora conectada (estacoes_impressao), rodando QZ Tray e com
-- esta tela aberta, puxa a fila via polling e imprime localmente.
--
-- AUTENTICAÇÃO DE ESTAÇÃO É DESACOPLADA DA SESSÃO DE USUÁRIO: no registro,
-- a estação recebe um token opaco próprio (não o JWT do admin que
-- registrou). Isso é proposital — a estação roda sozinha por horas/dias
-- sem interação humana, e logout/troca de senha/expiração de sessão do
-- usuário em QUALQUER dispositivo não pode derrubá-la.
--
-- Lookup do token por HASH DETERMINÍSTICO (HMAC-SHA256 com SECRET_KEY do
-- servidor), não argon2: diferente de refresh_tokens (usado raramente, só
-- no login/renovação), o token de estação é verificado a cada ciclo de
-- polling (5-8s) de CADA estação ativa de CADA tenant. Rodar
-- argon2.verify em loop contra todas as linhas não-revogadas do banco a
-- cada poll não escala com o número de tenants — HMAC permite busca
-- indexada O(1) por igualdade exata, com o mesmo nível de segurança
-- prático (impossível forjar sem conhecer a SECRET_KEY do servidor).
-- Esse é exatamente o caminho que o comentário em auth/service.py já
-- apontava como necessário "em escala maior" — aplicado aqui desde já
-- porque o padrão de acesso (poll frequente, multi-tenant) já pede isso
-- de início, diferente do refresh token de usuário.

create table estacoes_impressao (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references tenants(id) on delete cascade,
    nome                text not null,
    impressora_nome     text not null,
    token_lookup_hash   text not null,
    criado_por          uuid references users(id),
    revogado            boolean not null default false,
    revogado_em         timestamptz,
    ultima_atividade_em timestamptz,
    criado_em           timestamptz not null default now(),
    atualizado_em       timestamptz not null default now()
);

-- unique + índice: lookup do token acontece ANTES de sabermos o tenant_id
-- (mesma situação de login), por isso não pode ser filtrado por RLS —
-- precisa ser globalmente único e buscável por igualdade direta.
create unique index idx_estacoes_impressao_token on estacoes_impressao(token_lookup_hash);
create index idx_estacoes_impressao_tenant on estacoes_impressao(tenant_id);

alter table estacoes_impressao enable row level security;
alter table estacoes_impressao force row level security;
create policy tenant_isolation on estacoes_impressao
    using (tenant_id = current_setting('app.tenant_id')::uuid)
    with check (tenant_id = current_setting('app.tenant_id')::uuid);

-- Status (online/offline) é sempre computado em runtime a partir de
-- ultima_atividade_em (janela de heartbeat), nunca persistido como coluna
-- própria — mesmo princípio de margem_percentual em produtos: evita um
-- campo que pode dessincronizar do dado real que o gerou.

create table filas_impressao (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id) on delete cascade,
    estacao_id      uuid not null references estacoes_impressao(id) on delete cascade,
    produto_id      uuid references produtos(id),
    titulo          text not null,
    quantidade      integer not null default 1,
    -- HTML pronto pra impressão (mesmo formato que já vai pro QZ Tray hoje
    -- em modo pixel/html) + metadados leves de exibição na fila/log.
    payload_json    jsonb not null default '{}'::jsonb,
    status          text not null default 'pendente',
    enviado_por     uuid references users(id),
    job_origem_id   uuid references filas_impressao(id),
    criado_em       timestamptz not null default now(),
    atualizado_em   timestamptz not null default now(),
    constraint chk_filas_impressao_status check (status in ('pendente', 'impresso', 'erro'))
);

create index idx_filas_impressao_tenant on filas_impressao(tenant_id);
create index idx_filas_impressao_estacao_status on filas_impressao(estacao_id, status);
create index idx_filas_impressao_criado_em on filas_impressao(tenant_id, criado_em desc);

alter table filas_impressao enable row level security;
alter table filas_impressao force row level security;
create policy tenant_isolation on filas_impressao
    using (tenant_id = current_setting('app.tenant_id')::uuid)
    with check (tenant_id = current_setting('app.tenant_id')::uuid);
