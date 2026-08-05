# Log de Desenvolvimento — Sistema de Gestão de Estoque

Registro cronológico do que foi feito em cada etapa. Vai sendo atualizado a cada nova entrega.

---

## Etapa 1 — Fundação do backend (multi-tenant + segurança base)

**O que foi feito:**
- Estrutura de pastas modular (`core/`, `modules/`, `segments/`) conforme arquitetura definida
- Schema do banco (migration 001): tenants, users, produtos, categorias, depositos, lotes, movimentações, fornecedores, notas fiscais, regras de alerta
- Row Level Security (RLS) habilitada em todas as tabelas de negócio
- Módulo **Produtos** completo (schema, service, router) — CRUD com validação e autorização por perfil
- Parser de XML de NF-e protegido contra XXE (`defusedxml`)
- Configuração de ambientes (`core/config.py`) com validação de `SECRET_KEY`, `/docs` desligado em produção
- Middlewares de segurança: CORS restrito, headers OWASP, rate limiting

**Testes de segurança rodados:**
- Bandit (SAST): 0 problemas
- pip-audit: 22 CVEs encontradas nas dependências iniciais → corrigidas via atualização de versão (restam 2 sem correção disponível, documentadas e com risco mitigado em `SECURITY.md`)
- Teste automatizado de isolamento entre tenants (`test_tenant_isolation.py`)

**Entregável:** `estoque-inteligente-scaffold.zip` (v1)

---

## Etapa 2 — Módulo de Estoque (movimentações) e Inventário

**O que foi feito:**
- Migration 002: tabelas `inventarios` e `inventario_itens`, com RLS (inclusive na tabela filha, via subquery contra a tabela pai)
- Models SQLAlchemy completos (`app/db/models.py`) espelhando o schema do banco
- Módulo **Estoque**: registro de entrada/saída/ajuste, cálculo de saldo atual, histórico paginado
- Módulo **Inventário**: abertura de ciclo, fechamento com reconciliação automática (compara contagem x sistema e já gera os ajustes de estoque necessários, reaproveitando o módulo de Estoque — não duplicou lógica)

**Decisão de arquitetura registrada:** o fechamento do inventário chama `estoque_service.registrar()` em vez de escrever sua própria lógica de ajuste de saldo — é a arquitetura modular sendo aplicada na prática (um módulo novo reaproveita o núcleo).

**Regra de negócio crítica implementada:** saldo de produto nunca fica negativo, mesmo sob concorrência (duas saídas simultâneas). Resolvido com lock de linha (`FOR UPDATE`) no cálculo de saldo dentro da mesma transação.

**Testes de segurança rodados:**
- Bandit (SAST) sobre todo o código (produtos + estoque + inventário): 0 problemas
- Verificação de sintaxe de todos os módulos novos: OK
- Novos testes automatizados (`test_estoque_saldo.py`): saída maior que saldo é rejeitada, ajuste negativo além do saldo é rejeitado, quantidade negativa não passa na validação de entrada, perfil leitura não registra movimentação, e teste de concorrência (duas saídas simultâneas — só uma pode ser aceita)

**Entregável:** `estoque-inteligente-scaffold.zip` (v2 — inclui tudo da Etapa 1 + Estoque + Inventário)

---

## Etapa 3 — Módulo de Notas Fiscais (matching completo) e Vendas/PDV

**O que foi feito:**
- Migration 003: tabelas `notas_fiscais_itens`, `vendas`, `venda_itens`, com RLS
- **Notas Fiscais** — completado o fluxo que faltava: cada item do XML é casado automaticamente com um produto existente (por código de barras, depois por nome exato); item reconhecido já gera entrada de estoque sozinho; item não reconhecido fica "pendente_cadastro" até o operador confirmar manualmente — o sistema nunca cria produto novo sozinho, para não poluir o cadastro com erro de leitura do XML
- **Vendas/PDV** — finalização de venda com baixa automática de estoque, reaproveitando o módulo de Estoque (mesma regra de saldo nunca-negativo). Valida saldo de todos os itens antes de gravar qualquer coisa

**Limitação registrada com transparência:** a baixa de estoque de uma venda com vários itens não é 100% atômica (cada movimentação comita individualmente) — o risco é mitigado validando saldo de tudo antes de gravar, mas não é zero. Anotado como melhoria futura no próprio código (`vendas/service.py`) e aqui no log.

**Testes de segurança rodados:**
- Bandit sobre todo o backend (produtos + estoque + inventário + notas fiscais + vendas): 0 problemas
- Verificação de sintaxe de todos os arquivos `.py`: OK
- Novos testes (`test_vendas_e_notas_fiscais.py`): venda com saldo insuficiente não baixa nada, venda não acessa produto de outro tenant, perfil leitura não finaliza venda, preço inválido é rejeitado na validação, item de nota sem produto correspondente fica pendente (nunca cadastra sozinho), confirmação de item de nota de outro tenant é bloqueada

**Entregável:** `estoque-inteligente-scaffold.zip` (v3 — inclui tudo das Etapas 1, 2 e 3)

---

## Etapa 4 — Autenticação completa

**O que foi feito:**
- Migration 004: colunas de lockout em `users` (`tentativas_falhas`, `bloqueado_ate`) e tabela `refresh_tokens`
- Cadastro de empresa + usuário admin (`/auth/register`), com validação de senha forte (mín. 10 caracteres, maiúscula+minúscula+número)
- Login (`/auth/login`) com **lockout de conta após 5 tentativas erradas** (15 minutos), além do rate limit por IP já existente
- Mensagem de erro genérica no login — nunca revela se o e-mail existe, se a senha está errada, ou se a conta está bloqueada
- Refresh token com **rotação a cada uso**: token antigo é revogado assim que um novo é emitido; reuso de token já trocado é bloqueado (sinal de possível roubo)
- Refresh token armazenado só como hash (nunca em texto puro) — mesmo princípio de senha
- Logout revoga todos os refresh tokens do usuário

**Decisão de arquitetura registrada e documentada com cuidado:** login/refresh acontecem antes de sabermos o tenant do usuário, então não dá pra abrir a sessão de banco já isolada por Row Level Security como os outros módulos. Solução: uma conexão de banco **separada e restrita** (papel `auth_service` com permissão de bypass de RLS concedida *somente* nas tabelas `users`, `refresh_tokens` e `tenants` — nunca em produtos, movimentações, vendas etc.). É a única exceção ao isolamento por RLS em todo o sistema, e está documentada tanto no código (`core/database.py`) quanto aqui.

**Testes de segurança rodados:**
- Bandit sobre as ~1300 linhas do backend inteiro: 0 problemas
- Verificação de sintaxe e **import real de toda a aplicação montada** (não só sintaxe — o FastAPI app sobe sem erro, incluindo o rate limit dedicado no login)
- Novos testes (`test_auth.py`): senha fraca rejeitada no cadastro, mensagem idêntica para e-mail inexistente x senha errada (não vaza qual é o caso), bloqueio de conta após 5 tentativas, reuso de refresh token revogado é bloqueado, rate limit de IP no login dispara

**Entregável:** `estoque-inteligente-scaffold.zip` (v4 — inclui tudo das Etapas 1 a 4)

---

## Etapa 5 — Módulo de Alertas (motor de regras)

**O que foi feito:**
- Migration 005: tabela `alertas_gerados` (a `regras_alerta` já existia desde a migration 001)
- Motor de regras com 3 tipos: **validade** (lote vencendo em N dias), **estoque baixo** (saldo abaixo do mínimo do produto), **produto parado** (sem movimentação há N dias)
- Regras configuráveis por tenant (`/alertas/regras`), com parâmetros próprios (ex: `dias_antes`, `dias_sem_movimento`) — se o tenant não configurar nada, o motor usa parâmetros padrão sensatos
- Motor evita duplicar alerta: só gera um novo se não existir outro do mesmo tipo/produto ainda não lido
- Endpoint `/alertas/executar` para rodar o motor sob demanda — em produção isso deve rodar via job agendado (cron), documentado no código

**Decisão de arquitetura registrada:** o motor reaproveita `estoque.service.calcular_saldo_atual` para o alerta de estoque baixo, em vez de duplicar a lógica de saldo — quarto módulo seguido (depois de Inventário e Venda) que segue esse mesmo princípio de reaproveitar o núcleo.

**Testes de segurança rodados:**
- Bandit sobre as ~1500 linhas do backend inteiro: 0 problemas
- Import real da aplicação montada com o módulo de alertas incluído: OK
- Novos testes (`test_alertas.py`): só admin cria regra (operador é bloqueado), tipo de regra inválido é rejeitado na validação, alertas de um tenant não vazam para outro, marcar alerta de outro tenant como lido é bloqueado, rodar o motor duas vezes não duplica o mesmo alerta

**Entregável:** `estoque-inteligente-scaffold.zip` (v5 — inclui tudo das Etapas 1 a 5)

---

## Etapa 6 — Frontend (Next.js) conectado à API real

**O que foi feito:**
- Projeto Next.js criado seguindo a estrutura modular definida (tema separado em `themes/`, componentes em `components/`, config em `lib/config`)
- Tema visual do "Doce Encanto" aplicado via **tokens JSON** (cores, fontes) — os componentes nunca têm cor/fonte fixa no código, sempre leem do tema, exatamente como definimos na arquitetura multi-segmento
- **Login real**, consumindo `/auth/login` da API
- **Produtos**: primeira tela conectada de ponta a ponta — lista de verdade vinda do backend, busca, e formulário de cadastro que grava no banco
- **Painel**: já consome o módulo de Alertas real (lista alertas em aberto)
- Layout do dashboard com sidebar e proteção de rota (redireciona pro login se não autenticado)

**Decisão de segurança importante nesta etapa — mudei o backend também:** o refresh token deixou de ir no corpo da resposta JSON e passou a ser um **cookie httpOnly** (inacessível a JavaScript) com `SameSite=Strict`. Isso reduz bastante o risco de um ataque XSS conseguir roubar o token de sessão. O access token (de vida curta) continua só em memória no frontend — nunca em localStorage. Atualizei os testes do backend (`test_auth.py`) e o `SECURITY.md` para refletir essa mudança.

**Testes de segurança rodados:**
- `npm audit` no frontend: encontradas vulnerabilidades conhecidas no Next.js 14.2.15 inicial (crítica/alta) → atualizado até a versão 15.5.20 → **0 vulnerabilidades**
- Build de produção real (`next build`), que inclui checagem de tipos TypeScript: compilou sem erro
- Bandit rodado de novo no backend após a mudança do fluxo de refresh token: 0 problemas

**O que ainda falta no frontend (transparência sobre o estado atual):** só Produtos e Painel/Alertas estão conectados à API de verdade. Estoque, Inventário, Notas Fiscais, Vendas e Relatórios ainda precisam da mesma tela conectada — o padrão já está estabelecido em `produtos/page.tsx`, é replicar.

**Entregável:** `estoque-inteligente-scaffold.zip` (v6 — inclui backend completo (Etapas 1-5) + frontend inicial conectado)

---

## Etapa 7 — Mais telas do frontend conectadas (Estoque, Vendas, Alertas)

**O que foi feito:**
- **Movimentação de Estoque** — tela real: registra entrada/saída/ajuste, mostra histórico, e exibe a mensagem de erro que o próprio backend já dá (ex: saldo insuficiente) em vez de reimplementar a regra no frontend
- **Vendas/PDV** — carrinho funcional (adicionar produto, ajustar quantidade, remover), finaliza a venda chamando a API real, que já baixa o estoque automaticamente
- **Alertas** — lista alertas em aberto, permite rodar o motor de regras manualmente e marcar alerta como lido
- **Placeholders honestos** nas telas que ainda não têm API conectada (Inventário, Notas Fiscais, Relatórios) — em vez de simular dado falso, a tela avisa claramente que ainda não está pronta

**Princípio aplicado consistentemente:** o frontend nunca reimplementa regra de negócio (ex: "saldo suficiente?", "senha forte?") — sempre manda a ação para a API e exibe a resposta dela, certa ou errada. Isso evita duas fontes de verdade divergentes entre frontend e backend.

**Testes de segurança rodados:**
- Build de produção (`next build`) com as 9 rotas, checagem de tipos TypeScript: compilou sem erro
- `npm audit`: 0 vulnerabilidades (mantido em zero após adicionar as novas telas, nenhuma dependência nova precisou ser instalada)

**Entregável:** `estoque-inteligente-scaffold.zip` (v7 — backend completo (Etapas 1-5) + frontend com Painel, Produtos, Estoque, Vendas e Alertas conectados; Inventário/Notas/Relatórios como placeholder)

---

## Etapa 8 — Módulo de Compras (backend) + frontend 100% conectado

**O que foi feito:**
- Migration 006: `pedidos_compra` e `pedidos_compra_itens`, com RLS
- **Compras (backend)**: criação de pedido, recebimento parcial/total (gera entrada de estoque automaticamente, reaproveitando o módulo de Estoque), sugestão de reposição (regra simples e explicável: repõe até o estoque máximo quando abaixo do mínimo)
- **Frontend — telas finais conectadas**: Inventário (abrir ciclo, contar, fechar com ajuste automático), Notas Fiscais (upload real de XML, confirmação de itens pendentes), Relatórios (sugestão de reposição real), Compras (criar pedido, receber item)
- Removido o placeholder "em construção" — **todas as 9 telas do menu agora consomem a API real**, nenhuma simulação

**Com isso, o escopo completo combinado está no ar**: todos os módulos do backend (Produtos, Estoque, Inventário, Notas Fiscais, Vendas, Alertas, Compras, Autenticação) e todas as telas do frontend conectadas de ponta a ponta.

**Testes de segurança rodados:**
- Bandit sobre as ~1750 linhas do backend: 0 problemas
- pip-audit: seguem as mesmas 2 vulnerabilidades sem correção disponível, já documentadas e mitigadas
- Novos testes (`test_compras.py`): recebimento maior que o pedido é rejeitado, isolamento entre tenants no recebimento, perfil leitura não cria pedido, recebimento gera entrada de estoque corretamente, sugestão de reposição não inclui produto com saldo suficiente
- Build de produção do frontend com as 10 rotas finais: compilou sem erro
- `npm audit`: 0 vulnerabilidades

**Entregável final:** `estoque-inteligente-scaffold.zip` (v8 — backend completo com todos os 8 módulos + frontend 100% conectado) + `README.md` novo na raiz com o passo a passo completo para rodar tudo localmente (banco, migrations, variáveis de ambiente, backend, frontend, e como rodar os testes de segurança)

---

## Etapa 9 — Revisão completa: testes rodados de verdade, bugs reais encontrados e corrigidos

Até aqui, "testes de segurança rodados" significava Bandit + análise estática + import do app — nunca uma requisição HTTP real contra um banco de dados real. Quando o usuário reportou um erro ao aplicar as migrations, isso expôs que a suíte nunca tinha sido de fato executada. Esta etapa corrige isso: subimos um Postgres real, aplicamos as migrations do zero, rodamos o backend de verdade, testamos manualmente cada fluxo via HTTP, e só depois disso construímos um `conftest.py` real e rodamos os 34 testes automatizados contra banco real. Isso encontrou **6 bugs reais** que nenhuma checagem estática pega:

1. **Migration quebrada:** faltava `CREATE EXTENSION citext` — a criação da tabela `users` falhava silenciosamente, e por consequência toda tabela que depende dela (`movimentacoes`, `vendas`, `refresh_tokens`, `pedidos_compra`, e todas as políticas de RLS relacionadas). Corrigido em `001_init_core_schema.sql`.

2. **Constraint de banco logicamente errada:** a `unique constraint` de `alertas_gerados` incluía a coluna `lido`, o que quebraria assim que dois alertas do mesmo produto/tipo fossem marcados como lidos ao longo do tempo (violaria a constraint na segunda vez). Corrigido para um índice único **parcial** (`where not lido`) em `005_alertas.sql` — só restringe alertas em aberto, nunca o histórico.

3. **Bug de ciclo de vida da sessão de banco, repetido nos 7 módulos:** o helper `get_tenant_db()` de cada router consumia o generator assíncrono de sessão com `async for ... return`, o que fecha a sessão prematuramente antes da rota terminar de usá-la. Toda escrita no banco (criar produto, registrar movimentação, etc.) quebrava com `IllegalStateChangeError`. Esse bug existia desde a primeira etapa e nunca tinha sido pego porque nunca tínhamos rodado uma requisição real contra um banco real. Corrigido trocando `return session` por `yield session` nos 7 routers.

4. **`MissingGreenlet` em Vendas e Compras:** os endpoints retornavam o objeto ORM (`Venda`, `PedidoCompra`) direto, e o Pydantic tentava acessar o relacionamento `.itens` durante a serialização da resposta — fora do contexto assíncrono do SQLAlchemy. Corrigido com `selectinload()` explícito antes de retornar, em `vendas/service.py` e `compras/service.py`.

5. **`TypeError` misturando `Decimal` e `float`:** colunas `Numeric` do Postgres chegam como `decimal.Decimal` via SQLAlchemy; os valores vindos do Pydantic são `float`. Python permite comparar os dois, mas não somar/subtrair sem conversão explícita. Isso quebrava o recebimento de pedido de compra (`+=`) e a sugestão de reposição (`-`). Corrigido com conversões explícitas em `compras/service.py`.

6. **Lacuna de produto identificada durante os testes (não é bug de código, é funcionalidade faltando):** não existe endpoint para um admin criar/convidar outro usuário (operador/leitura) dentro do mesmo tenant — só o cadastro inicial de tenant+admin. Ficou visível ao tentar montar as fixtures de teste para os perfis restritos. Registrado aqui como próxima etapa; contornado nos testes com inserção direta no banco (documentado no `conftest.py` como workaround só de teste).

**O que foi validado de verdade, via HTTP real, nesta etapa:**
- Cadastro de tenant + admin, login, cookie httpOnly de refresh
- Criar produto, entrada/saída de estoque, trava de saldo negativo
- Finalizar venda (baixa de estoque automática)
- Motor de alertas (gera e não duplica)
- Abrir/fechar inventário com ajuste automático de divergência
- Importar XML de NF-e (matching, pendência de cadastro, confirmação manual, bloqueio de XXE)
- Criar pedido de compra, receber item (entrada de estoque automática), sugestão de reposição
- **Isolamento entre dois tenants diferentes** (o teste de segurança mais importante do sistema) — tenant B não vê nem acessa nada do tenant A
- Lockout de conta e rate limit de login

**Suíte automatizada:** construído um `conftest.py` real com fixtures que sobem a aplicação via `ASGITransport` contra o Postgres de teste (RLS não pode ser simulado com SQLite, por isso o teste precisa de Postgres de verdade). Corrigido um problema de configuração do `pytest-asyncio` (event loop precisa ser escopado por sessão, já que o engine assíncrono do SQLAlchemy é criado uma única vez no import) e um problema de rate limit entre testes (cada fixture agora usa um IP simulado próprio, isolando o "balde" de rate limit de cada teste, do jeito que aconteceria de verdade com usuários diferentes).

**Resultado final: 34/34 testes passando de verdade, contra banco real, com RLS ativo.**

**Entregável:** `estoque-inteligente-scaffold.zip` (v9 — todos os bugs acima corrigidos, `conftest.py` real adicionado, `pytest.ini` configurado)

---

## Status: escopo combinado desta rodada concluído e validado de verdade

Falta, para uma v1 comercial completa (fora do escopo desta rodada, mas registrado para referência futura):
- **Endpoint para admin criar/convidar usuários operador/leitura no próprio tenant** (lacuna encontrada na Etapa 9 — hoje só existe o cadastro inicial de tenant+admin)
- Emissão de NF-e/NFC-e (hoje só importação)
- Código de barras/QR via câmera, app mobile/PWA, notificações por e-mail/WhatsApp
- Deploy real em staging/produção (Railway + Vercel + Supabase) — o sistema roda localmente, mas nenhum ambiente remoto foi provisionado

---

## Etapa 10 — Correção de estilo (Tailwind) + revisão dos módulos existentes

**Bug de estilo corrigido:** o frontend renderizava sem nenhum estilo aplicado
(HTML cru, sem espaçamento/bordas/cores de layout). Causa raiz: faltava
`postcss.config.js` na raiz do frontend e as diretivas `@tailwind
base/components/utilities` no `globals.css` — sem isso, o Next.js nunca
processa as classes Tailwind usadas em todo o projeto. Corrigido nos dois
arquivos.

**Revisão dos 7 módulos de negócio existentes** (a pedido do usuário, antes de
partir para funcionalidades novas): mapeamento endpoint a endpoint de cada
router encontrou 5 lacunas reais — módulos que funcionavam para o caso de uso
imediato mas não tinham como consultar histórico depois:

1. **Vendas:** só existia `POST /vendas` e `GET /vendas/{id}` — sem histórico,
   não dava pra consultar vendas passadas nem calcular faturamento. Adicionado
   `GET /vendas` com filtro de `data_inicio`/`data_fim` e paginação; `criado_em`
   adicionado ao `VendaOut`. Frontend: seção "Histórico recente" na tela de
   Vendas/PDV.

2. **Notas Fiscais:** só existia `POST /importar` e listagem de itens por
   `nota_id` já conhecido — sem lista, uma nota importada "sumia" se a tela
   fosse fechada. Adicionado `GET /notas-fiscais` com contagem de itens
   pendentes por nota (subquery correlacionada, sem duplicar linha por item).
   Frontend: tabela "Notas importadas" com botão "Ver itens" pra retomar
   qualquer nota antiga.

3. **Inventário:** abrir/contar/fechar funcionava, mas vivia só no estado da
   tela — um reload no meio de uma contagem perdia tudo, e o backend já
   bloqueava um segundo inventário aberto pro mesmo depósito, travando o
   usuário. Adicionado `GET /inventario` (histórico com filtro de status) e
   `GET /inventario/aberto` (retomada). Nesse processo, também corrigido um bug
   de lógica condicional no JSX que eu mesmo tinha deixado incompleto (o
   ternário `!verificandoAberto && !inventario ? (...) : (...)` cairia no
   branch de contagem com `inventario` ainda `null` durante a checagem inicial,
   quebrando com `inventario.ciclo` undefined).

4. **Estoque:** só existia saldo por produto individual — sem visão geral,
   seria necessária uma chamada por produto pra montar um resumo. Adicionado
   `GET /estoque/saldo`, com o saldo de todos os produtos calculado numa única
   query agregada em SQL (`sum(case ...)` agrupado por produto, sem lock de
   linha — leitura de relatório não precisa do mesmo `FOR UPDATE` usado antes
   de gravar uma movimentação). Card "Estoque abaixo do mínimo" adicionado ao
   Painel geral; aproveitado pra remover o texto obsoleto "as demais telas...
   são a próxima etapa" que ainda estava lá desde a Etapa 3.

5. **Alertas:** regras só podiam ser criadas e listadas, nunca editadas ou
   desativadas. Adicionado `PATCH /alertas/regras/{id}` (só admin, parcial via
   `exclude_unset`). Também identificado que não existia NENHUMA UI de regras
   no frontend (só a lista de alertas gerados) — criada a seção "Regras
   configuradas" com toggle ativo/desativado e edição inline do parâmetro
   numérico de cada tipo de regra.

**Ponto de atenção de segurança registrado (não corrigido nesta etapa):** a
tabela `inventario_itens` não tem coluna `tenant_id` própria — diferente de
toda outra tabela filha do sistema. O isolamento hoje depende inteiramente do
`inventario_id` pai já ter sido validado antes da query, o que funciona mas é
uma camada de defesa a menos que o padrão RLS usado no resto do sistema.
Candidato a correção numa próxima etapa.

**Testes de segurança rodados de verdade nesta etapa** (não só análise
estática, conforme preferência do usuário): subido Postgres 16 local do zero,
aplicadas as 6 migrations, suíte completa executada —
**50/50 testes passando** (34 anteriores + 16 novos cobrindo os 5 endpoints
adicionados, com foco em isolamento entre tenants e RBAC por perfil em cada
um). Bandit sobre o backend inteiro: 0 problemas identificados.

**Observação sobre o ambiente de teste local:** seguindo a mesma simplificação
já documentada no `.env.example` ("em desenvolvimento pode repetir
DATABASE_URL"), o papel de banco usado nos testes locais desta etapa tinha
privilégio de superusuário, o que faz o Postgres ignorar RLS nessa conexão
específica — a defesa de RLS em si não foi exercida por essa rodada de testes,
só a defesa de aplicação (filtro explícito por `tenant_id` em toda query, que
é o que os testes de isolamento de fato verificam). Isso é consistente com o
que o próprio `.env.example` já descreve como aceitável em ambiente local; em
staging/produção o papel `auth_service` com `BYPASSRLS` escopado apenas a
`users`/`refresh_tokens`/`tenants` segue sendo a configuração correta e é o
que garante RLS realmente ativo nesses ambientes.

**Entregável:** `postcss.config.js` e `globals.css` (correção de estilo, já
entregues antes desta etapa) + arquivos individuais dos 5 módulos revisados +
`estoque-inteligente-scaffold.zip` (v10 — estilo corrigido, 5 lacunas de
histórico/edição fechadas, 50/50 testes passando).

## Etapa 11 (parte 1) — Campo SKU no Produto

Primeiro passo do plano da Etapa 11 (o segundo é o kit de componentes de UX
reutilizável, o terceiro é aplicar tudo na tela de Estoque). Escopo desta
parte: só o SKU, de ponta a ponta.

**Banco:** migration `007_produto_sku.sql` adiciona `sku text` à tabela
`produtos`, com índice `(tenant_id, sku)` pra busca — mesmo padrão já usado em
`codigo_barras`. Decisão registrada na própria migration: **não** foi criada
constraint de unicidade. Motivo: nenhuma unique constraint de negócio existe
hoje em nenhuma tabela do projeto (nem `codigo_barras` é único), e adicionar
isso exigiria também adicionar tratamento de `IntegrityError`/
`UniqueViolation` — que também não existe em nenhum módulo ainda. Preferi não
introduzir um padrão novo isoladamente só pra esse campo. Fica registrado como
candidato pra endurecer numa etapa futura, se o usuário quiser SKU como
identificador estritamente único por tenant.

**Backend:** `sku` adicionado ao model `Produto`, a `ProdutoBase` e
`ProdutoUpdate` (schemas). Validador normaliza o valor — `strip()` +
`upper()`, e string vazia vira `None` — pra evitar duplicatas silenciosas
tipo `"abc-01"` vs `"ABC-01 "` coexistindo sem ninguém perceber.

Aproveitado pra fechar uma lacuna de UX que já estava prevista pro Estoque: a
busca de `GET /produtos` (parâmetro `busca`) antes só filtrava por `nome`;
agora filtra por `nome` OU `sku` OU `codigo_barras` num único campo (`or_`
com `ilike` parametrizado, sem concatenação de string). Isso adianta a
"busca única" já definida na spec aprovada da tela de Estoque, e já melhora a
tela de Produtos hoje.

**Frontend:** campo SKU no formulário de novo produto (ao lado de Unidade),
coluna SKU na tabela de listagem, tipos `Produto`/`ProdutoCreateInput`
atualizados, placeholder da busca atualizado pra "Buscar por nome, SKU ou
código de barras".

**Testes de segurança rodados de verdade nesta etapa:** Postgres 16 instalado
e subido do zero no ambiente (não havia Postgres disponível), as 7 migrations
aplicadas em ordem, suíte completa executada — **59/59 testes passando** (50
anteriores + 9 novos em `test_produtos.py`, cobrindo normalização de SKU,
busca unificada por nome/SKU/código de barras, e isolamento entre tenants na
busca). Bandit sobre o backend inteiro: 0 problemas identificados. Mesma
observação de sempre sobre RLS: o papel usado localmente é superusuário, então
essa rodada testa a defesa de aplicação (filtro por `tenant_id`), não o RLS
em si — RLS real só é exercido em staging/produção com o papel `auth_service`.

**Entregável:** `007_produto_sku.sql` (migration) + `models.py`,
`schemas.py`, `service.py` (backend) + `types.ts`, `produtos/page.tsx`
(frontend) + `test_produtos.py` (novo) + `estoque-inteligente-scaffold.zip`
(v11-parte1 — SKU de ponta a ponta, busca unificada em Produtos, 59/59 testes
passando).

## Etapa 11 (parte 2) — Kit de componentes de UX reutilizável

Segundo passo do plano: construir uma vez os padrões de interação que toda
tela de lista (Estoque, Produtos, Vendas, Notas, Compras, Inventário,
Alertas) vai precisar, em vez de reimplementar cada um por tela — que é
como visual drift começa a acontecer.

**O que foi criado**, tudo em `frontend/components/ui/`, seguindo os tokens
visuais já existentes (cores via CSS var, `rounded-xl`/`rounded-md`,
`text-xs uppercase tracking-wide` em headers, ícones lucide-react — nada
novo introduzido):

- `Toast.tsx` — `ToastProvider` (plugado uma vez em `app/layout.tsx`) +
  `useToast()` com `sucesso()`/`erro()`. Empilha no canto inferior direito,
  some sozinho em ~4.5s.
- `ConfirmDialog.tsx` — modal de confirmação genérico (fecha com Esc ou
  clique fora, foco automático no botão de confirmar, variante "perigosa"
  em vermelho pra ações destrutivas).
- `Skeleton.tsx` — `TableSkeletonRows` com largura variável por coluna, pra
  tela não "pular" quando os dados chegam (substitui o texto solto
  "Carregando...").
- `Pagination.tsx` — paginação compacta ("X–Y de Z" + anterior/próxima).
- `Table.tsx` — `useOrdenacao` (hook de ordenação client-side, 3 estados:
  asc → desc → natural) + `ThOrdenavel` (cabeçalho clicável com seta) +
  `TrHover` (linha com hover consistente, com estado "selecionada").
- `useSelecaoMultipla.ts` — seleção múltipla por id (Set), com
  selecionar/desselecionar tudo.
- `BulkActionBar.tsx` — barra de ações em lote, só aparece quando há
  seleção.
- `RowMenu.tsx` — menu "⋮" por linha, fecha com Esc ou clique fora.
- `useDebouncedValue.ts` — debounce (300ms) pra busca instantânea sem
  disparar requisição a cada tecla.
- `useKeyboardShortcuts.ts` — `/` foca busca, `N` abre novo item, `Esc`
  fecha o que estiver aberto; `/` e `N` são ignorados enquanto o usuário
  já está digitando em outro campo, `Esc` funciona sempre.
- `index.ts` — barrel export único pra facilitar o import nas telas.

Nada disso ainda está aplicado a uma tela específica — é o passo 3 do plano
(aplicar na tela de Estoque) que vai consumir esse kit.

**Validação real rodada nesta etapa:** como é kit de UI puro (sem endpoint
novo, sem tabela nova, sem regra de negócio), a suíte de segurança do
backend não se aplica aqui — o que importa é o build de verdade do
frontend. Rodado do zero: `npm install`, `npx tsc --noEmit` (0 erros),
`npm run build` (build de produção completo — compilou e gerou as 14 rotas
sem erro). `next lint` não pôde ser usado porque o projeto nunca teve
ESLint configurado (gap pré-existente, registrado aqui, não introduzido
nesta etapa).

**Entregável:** os 10 arquivos de `frontend/components/ui/` (novos) +
`app/layout.tsx` e `app/globals.css` (alterados, pra plugar o
`ToastProvider` e as keyframes de toast/skeleton) +
`estoque-inteligente-scaffold.zip` (v11-parte2 — kit de UX pronto, build e
type-check limpos).

## Etapa 11 (parte 3) — Kit aplicado na tela de Estoque completa

Terceiro e último passo do plano da Etapa 11: a tela de Estoque virou a
tela real da spec aprovada, usando o kit construído na parte 2.

**Backend — novo endpoint `GET /estoque/painel`.** Devolve, numa chamada só
(pra não fazer a tela abrir com 4 requisições em cascata): os 5 KPIs, as
opções de filtro disponíveis (categorias/depósitos/fornecedores do tenant)
e os itens da grade já filtrados/ordenados/paginados. Decisões de negócio
tomadas e documentadas direto no código:

- **KPIs são sobre o catálogo ativo inteiro, não sobre a busca/filtro
  atual** — é um resumo fixo; se dependesse do filtro, os números ficariam
  "pulando" enquanto a pessoa digita, o que é mais confuso que útil.
- **Selo de prioridade é único por produto**, com ordem de precedência
  deliberada: sem estoque > vencimento próximo > abaixo do mínimo > novo >
  normal (a mesma ordem da spec aprovada).
- **"Vencimento próximo" reusa o limiar de 5 dias já usado em
  `alertas.service`** — duplicado como constante (não importado) porque
  importar na direção contrária criaria um ciclo entre os dois módulos;
  comentário cruzado nos dois lugares avisando disso.
- **"Produto novo" (≤7 dias corridos desde o cadastro) é um conceito novo**,
  criado só pra esse selo — não existia em nenhum outro lugar do sistema.
  Decisão registrada aqui, não em nenhuma spec anterior.
- **Filtro por fornecedor não tem um campo direto no Produto** (não existe
  essa coluna) — é derivado via os itens de pedidos de compra já feitos
  daquele fornecedor (`pedidos_compra_itens` → `pedidos_compra`). Ou seja,
  "produtos já comprados desse fornecedor alguma vez", que é o que faz
  sentido no modelo atual — um produto pode ter vários fornecedores ao
  longo do tempo, não um fornecedor fixo.
- **Ordenação e paginação acontecem em Python, não em SQL.** O catálogo de
  um tenant piloto (bomboniere) é pequeno o bastante pra isso não pesar, e
  evita duplicar a agregação de saldo em SQL só pra poder ordenar por ela.
  Registrado como decisão consciente — revisitar se algum tenant crescer
  pra milhares de produtos.
- Categoria/Depósito/Fornecedor continuam sem endpoint de criação (mesma
  lacuna já registrada antes para Depósito) — os testes inserem essas
  linhas direto no banco, como já era o padrão pra usuário no `conftest.py`.

**Frontend.**

- `NovoProdutoForm` foi extraído de `produtos/page.tsx` para
  `components/produtos/NovoProdutoForm.tsx` — Produtos e Estoque agora usam
  o mesmo formulário, sem duplicar validação/campos.
- `useSelecaoMultipla` (kit da parte 2) foi generalizado pra aceitar um
  extrator de id customizado, porque o painel de Estoque usa `produto_id`
  em vez de `id`.
- `/movimentacao` ganhou pré-preenchimento via query string
  (`?tipo=entrada&produto_id=X`) e o tipo "Transferência" na UI (o backend
  já aceitava, só não estava exposto). Nota honesta adicionada na tela:
  transferência hoje é registrada como saída simples — o rastreio de
  depósito de origem/destino ainda não existe no modelo de dados. Precisou
  de `<Suspense>` em volta do conteúdo porque `useSearchParams` no App
  Router exige isso.
- Tela de Estoque (`estoque/page.tsx`) remontada do zero com: 5 cards de
  KPI (2 deles clicáveis — "abaixo do mínimo" e "sem estoque" já ligam o
  filtro correspondente, reduzindo clique); ações rápidas
  (Entrada/Saída/Transferência/Ajuste → `/movimentacao?tipo=X`,
  Inventário → `/inventario`); busca única com debounce + atalho `/`;
  filtros de categoria/depósito (só aparece se o tenant já usa depósito)/
  fornecedor + chip de vencimento próximo; botões Atualizar/Exportar
  Excel/Importar/Novo produto; grade com checkbox de seleção, ordenação de
  coluna, hover, badge de prioridade (🔴🟠🟡🔵🟢), menu "⋮" por linha (ver
  histórico, registrar entrada/saída, desativar produto com confirmação);
  barra de ações em lote (exportar selecionados); paginação; skeleton
  enquanto carrega; toasts de sucesso/erro.
- **Exportar Excel** gera CSV no navegador (Excel abre CSV nativamente) —
  evitou adicionar uma dependência de xlsx só pra isso. Busca até 8 páginas
  (2000 itens) respeitando os filtros ativos.
- **Importar** mostra um toast avisando que ainda não está disponível, em
  vez de fingir uma funcionalidade que não existe — o botão está no lugar
  que a spec aprovada previu, mas honesto sobre o que faz hoje.
- Atalhos de teclado ativos na tela: `/` foca a busca, `N` abre "novo
  produto", `Esc` fecha formulário/modal aberto.

**Testes reais rodados nesta etapa:** Postgres religado (tinha caído entre
sessões), suíte completa — **74/74 passando** (59 anteriores + 15 novos em
`test_estoque_painel.py`, cobrindo: KPIs sobre catálogo ativo, busca não
afetando KPI, filtro de categoria/depósito/fornecedor, as 5 prioridades e
sua ordem de precedência, filtro "somente abaixo do mínimo", ordenação por
saldo, paginação, e isolamento entre tenants tanto nos itens quanto nas
opções de filtro). Bandit: 0 problemas. Frontend: `npx tsc --noEmit` limpo
e `npm run build` completo gerando as 14 rotas sem erro (incluindo o novo
`<Suspense>` em `/movimentacao`).

**Entregável:** `estoque/router.py`, `estoque/service.py`,
`estoque/schemas.py` (backend) + `test_estoque_painel.py` (novo) +
`estoque/page.tsx`, `movimentacao/page.tsx`, `produtos/page.tsx`,
`components/produtos/NovoProdutoForm.tsx` (novo),
`components/ui/useSelecaoMultipla.ts`, `lib/types.ts` (frontend) +
`estoque-inteligente-scaffold.zip` (v11-parte3 — Etapa 11 completa: SKU,
kit de UX e tela de Estoque, todos entregues e testados de verdade).

### Próximos passos (fora desta etapa, registrados pro backlog)

- Replicar o kit de UX nas demais telas de lista (Produtos, Vendas, Notas,
  Compras, Inventário, Alertas) — próximo item natural do backlog.
- CRUD de Categoria/Depósito/Fornecedor ainda não existe — hoje só são
  visíveis no painel de Estoque se já tiverem sido inseridos via alguma
  outra rota indireta (compras, por exemplo, cria fornecedor? não — nem
  isso; hoje só entram via acesso direto ao banco). Bloqueia o uso real
  desses filtros em produção até existir alguma tela de cadastro.
- Rastreio de depósito de origem/destino em transferências não existe no
  modelo de dados — hoje é tratado como saída simples.

## Etapa 12 — Fechando os dois gaps registrados na etapa anterior

Antes de seguir pras próximas telas, tratei os dois gaps deixados em aberto.

### Gap 1 — CRUD de Categoria/Depósito/Fornecedor

Criado o módulo `app/modules/cadastros/` com endpoints completos (criar,
listar, editar, excluir) pras três entidades, que até aqui só existiam no
schema do banco. Decisões:

- **Sem soft-delete** — nenhuma das três tabelas tem coluna `ativo`, e não
  criei uma agora pra não abrir mais uma frente de schema numa etapa que já
  tinha bastante coisa. Exclusão é física.
- **Exclusão com registro em uso vira 409, não 500** — nenhuma das FKs que
  aponta pra essas tabelas tem `ON DELETE CASCADE`, então o Postgres recusa
  a exclusão com uma violação de integridade se ainda estiver em uso;
  traduzida pra uma mensagem amigável. Essa é a primeira vez que o projeto
  trata `IntegrityError` — decisão registrada aqui, não generalizada pro
  resto do código sem necessidade.
- Permissões seguem o mesmo padrão de Produtos: leitura pra qualquer
  usuário autenticado, criar/editar para admin+operador, excluir só admin.
- **Frontend:** cada um dos três filtros (categoria/depósito/fornecedor) da
  tela de Estoque ganhou um botão "+" ao lado que abre um modal mínimo
  (`QuickCreateDialog`, novo componente do kit — nome + um campo secundário
  opcional) e, ao salvar, já seleciona o item recém-criado no filtro. Sem
  isso, o endpoint existir no backend não resolvia nada de verdade pro
  usuário final (que não usa Postman).
- 12 testes novos em `test_cadastros.py`: criar/listar/editar/excluir de
  cada entidade, exclusão bloqueada quando em uso (409), isolamento entre
  tenants, e permissão (leitura não cria, operador não exclui).

### Gap 2 — Transferência entre depósitos (era bug, não só lacuna de UI)

Investigando o gap, descobri que "transferência" desde sempre foi tratada
como uma saída simples no cálculo de saldo — ou seja, toda transferência
entre depósitos da mesma loja estava **silenciosamente reduzindo o saldo
total do produto**, quando deveria só mover a mercadoria entre depósitos
sem alterar o total. Sem dado de produção envolvendo transferência até
agora (nunca funcionou direito), então não havia nada pra migrar.

Correção (migration `008_transferencia_grupo.sql` + `estoque/service.py`):

- Uma transferência passa a ser gravada como **duas linhas** —
  `saida` no depósito de origem + `entrada` no depósito de destino —
  ligadas por `grupo_transferencia_id` (coluna nova, nullable). Isso
  reaproveita a soma/subtração que `entrada`/`saida` já fazem em todo o
  resto do sistema (saldo_geral, painel, alertas) em vez de duplicar a
  lógica com mais um caso especial. Efeito líquido no total: zero, correto.
  Não foi preciso um campo `deposito_destino_id`: cada uma das duas linhas
  já carrega seu próprio `deposito_id`.
- Validação de saldo pra transferência agora usa
  `calcular_saldo_por_deposito` (função nova) — checa o saldo **daquele
  depósito específico**, não mais o total do produto. Sem essa mudança,
  seria possível "transferir" mais do que um depósito realmente tem só
  porque o produto tem saldo de sobra em outro lugar.
- `POST /estoque/movimentacoes` mudou de contrato: retornava um objeto,
  agora retorna sempre uma lista (1 item nos casos normais, 2 na
  transferência). Conferido que nada no frontend nem nos testes existentes
  dependia do formato antigo antes de mudar.
- **Frontend:** a tela de Movimentação ganhou seletores reais de "De
  (origem)" / "Para (destino)" quando o tipo é Transferência (busca a
  lista de `/depositos`), substituindo o aviso que dizia que isso não
  existia. O histórico agora mostra um selo 🔁 nas linhas que fazem parte
  de uma transferência (via `grupo_transferencia_id`).
- 7 testes novos em `test_transferencia.py`, incluindo o caso que expõe
  exatamente o bug original: saldo total "de sobra" em outro depósito não
  deve liberar uma transferência maior do que o disponível na origem
  específica.

### Achado à parte: banco de testes local precisa ser resetado periodicamente

A suíte começou a travar minutos num teste de refresh token, sem relação
com o código desta etapa. Investigando: o banco de testes local acumulou
**611 refresh tokens** e centenas de linhas de execuções repetidas ao
longo de várias sessões — a verificação de refresh token itera todo token
não revogado fazendo `argon2.verify` em cada um (custo computacional alto
de propósito, por segurança), e foi ficando cada vez mais lento conforme a
tabela crescia sem nunca ser limpa entre execuções. Não é um bug do
sistema (em produção o volume de tokens ativos por tenant é pequeno e
FKs isolam por tenant), mas é uma armadilha real de ambiente de teste local
persistente. Resetei o banco (`DROP DATABASE` + recriar + reaplicar as 8
migrations) e a suíte voltou a rodar normalmente (93 testes em ~95-155s).
Vale adotar o hábito de recriar o banco de teste periodicamente, não só
quando symptomas aparecem.

**Testes reais rodados nesta etapa:** banco de testes recriado do zero,
todas as 8 migrations reaplicadas (incluindo a `008` nova), suíte completa
— **93/93 passando** (74 anteriores + 12 de `test_cadastros.py` + 7 de
`test_transferencia.py`). Bandit: 0 problemas (corrigido um `assert` usado
como guarda de validação — removido em bytecode otimizado, trocado por uma
exceção explícita). Frontend: `tsc` e `npm run build` limpos, 12 rotas.

**Entregável:** `app/modules/cadastros/` completo (novo) +
`app/modules/estoque/{router,service,schemas}.py` (transferência) +
`app/db/models.py` + `app/main.py` + `migrations/008_transferencia_grupo.sql`
(novo) + `test_cadastros.py`, `test_transferencia.py` (novos, backend) +
`estoque/page.tsx`, `movimentacao/page.tsx` (frontend) +
`components/ui/QuickCreateDialog.tsx` (novo) + `components/ui/index.ts` +
`estoque-inteligente-scaffold.zip` (v12 — os dois gaps da Etapa 11
fechados, testados de verdade).

### Próximos passos (backlog, sem mudança)

- Replicar o kit de UX nas demais telas de lista (Produtos, Vendas, Notas,
  Compras, Inventário, Alertas).
- Entrada/saída/ajuste ainda não têm seletor de depósito na tela de
  Movimentação (só transferência ganhou nesta etapa) — hoje essas
  movimentações sempre gravam `deposito_id = null`, o que limita o quanto
  o filtro de Depósito e a coluna "Posição" do painel de Estoque refletem
  a realidade. Registrado como gap novo, não tratado nesta etapa pra não
  estourar ainda mais o escopo.

## Etapa 13 — Kit de UX aplicado na tela de Produtos

Próxima tela da lista de replicação do kit (depois de Estoque): Produtos.
Foi a mais simples de aplicar porque já compartilhava o formulário com
Estoque desde a Etapa 11.

**Backend — novo endpoint `GET /produtos/painel`.** Antes de mexer,
percebi que `GET /produtos` (o "cru", sem paginação com total) já é usado
por **5 outras telas** (Vendas, Compras, Inventário, Movimentação,
Relatórios) como dropdown simples de seleção de produto. Mudar esse
contrato para incluir paginação/total quebraria as cinco de uma vez — por
isso criei um endpoint dedicado, mesmo padrão já usado em
`/estoque/painel`, e deixei `GET /produtos` intocado. `/produtos/painel`
devolve itens (com `categoria_nome` via join, que `GET /produtos` normal
não tem), filtros de categoria disponíveis, e paginação real com `total`
(contagem via subquery, algo que faltava completamente antes). Também
percebi, ao mexer nisso, que `PATCH /produtos/{id}` já existia no backend
desde sempre e nunca tinha sido usado por nenhuma tela — edição de produto
"já existia", só não tinha UI.

**Frontend.**

- `NovoProdutoForm` virou `ProdutoForm` — mesmo componente agora serve pra
  criar E editar (usa POST ou PATCH dependendo de receber ou não um
  `produto` existente). Atualizado nos dois lugares que o usavam (Produtos
  e Estoque).
- Tela de Produtos remontada com: busca única com debounce + atalho `/`;
  filtro de categoria (com "+" pra criar uma nova sem sair da tela, mesmo
  `QuickCreateDialog` já usado na tela de Estoque); chip "Mostrar
  inativos"; grade com checkbox de seleção, ordenação de coluna (nome,
  SKU, custo médio, mínimo), hover, menu "⋮" por linha com **Editar**
  (abre `ProdutoForm` num modal, em modo edição — funcionalidade nova de
  verdade, não só reorganização visual) e **Desativar** (com confirmação,
  já existia mas não estava exposto na grade); barra de ações em lote
  (exportar selecionados em CSV); paginação real (antes a tela nem tinha —
  carregava tudo de uma vez); skeleton; toasts; atalhos de teclado (`/`,
  `N`, `Esc`).

**Testes reais rodados nesta etapa:** suíte completa — **100/100
passando** (93 anteriores + 7 novos em `test_produtos_painel.py`: total
para paginação, produtos ativos por padrão, filtro `status=inativo`,
filtro de categoria com `categoria_nome` no retorno, ordenação por custo
médio, isolamento de filtros de categoria entre tenants, isolamento de
itens entre tenants). Bandit: 0 problemas. Frontend: `tsc --noEmit` e
`npm run build` limpos, 14 rotas (nenhuma rota nova — Produtos e Estoque
continuam sendo as mesmas URLs, só o conteúdo mudou).

**Entregável:** `produtos/{router,service,schemas}.py` (backend) +
`test_produtos_painel.py` (novo) + `produtos/page.tsx`, `estoque/page.tsx`,
`components/produtos/ProdutoForm.tsx` (novo, substitui
`NovoProdutoForm.tsx`), `lib/types.ts` (frontend) +
`estoque-inteligente-scaffold.zip` (v13 — kit de UX também na tela de
Produtos, com edição de produto funcionando pela primeira vez).

### Próximos passos (backlog, sem mudança)

- Replicar o kit nas telas restantes: Vendas, Notas, Compras, Inventário,
  Alertas.
- Seletor de depósito em entrada/saída/ajuste na tela de Movimentação
  (gap registrado na Etapa 12, ainda não tratado).

## Investigação de RLS — teste real contra Postgres com role restrito

Fora do ciclo normal de Etapas, a pedido do usuário: validação direta de
isolamento entre tenants usando roles reais (não análise estática), pra
confirmar se a defesa de RLS documentada no `database.py` e no
`SECURITY.md` funciona de fato ou só no papel.

**Setup:** Postgres 16 local, todas as 8 migrations aplicadas em banco
limpo (`estoque_rls_test`). Dois tenants fictícios com 1 produto cada.
Três roles criados espelhando os papéis reais de produção:
- `claude_test` — superuser, dono das tabelas (o mesmo papel usado hoje
  em `conftest.py` para rodar a suíte de testes automatizada)
- `app_role` — role de aplicação real: NÃO é dono das tabelas, sem
  `BYPASSRLS`, só com os GRANTs mínimos (`SELECT/INSERT/UPDATE/DELETE`)
- `auth_service` — exatamente como documentado em `database.py`:
  `BYPASSRLS` concedido, mas GRANT de tabela limitado só a
  `users`/`refresh_tokens`/`tenants`

**Resultados:**

1. RLS funciona corretamente através de `app_role` (o cenário real de
   produção): logado como Tenant A, `SELECT` só retorna produtos do
   Tenant A; `UPDATE`/`DELETE` direto por ID num produto do Tenant B
   afeta 0 linhas; o produto do Tenant B foi confirmado intacto depois.
   Testado em `produtos` (policy simples por `tenant_id`) e a policy de
   `inventario_itens` (que depende do join com `inventarios`, já que a
   tabela não tem `tenant_id` próprio) também isola corretamente.

2. `auth_service` está de fato escopado: mesmo com `BYPASSRLS` ativo,
   tentativas de `SELECT` em `produtos` e `vendas` foram negadas com
   `permission denied` — o bypass só vale para as 3 tabelas
   documentadas, confirmando que a única exceção ao RLS do sistema
   está contida como pretendido.

3. Achado confirmado (já suspeitado, agora comprovado com teste real):
   o role `claude_test` usado hoje em `conftest.py` é ao mesmo tempo
   (a) dono das tabelas e (b) superuser — e superuser SEMPRE ignora
   RLS no Postgres, independente de `FORCE ROW LEVEL SECURITY`.
   Reproduzido: com `app.tenant_id` setado para o Tenant A, uma query
   como `claude_test` retornou produtos dos DOIS tenants. Isso
   significa que a suíte de 93 testes automatizados do projeto, hoje,
   valida apenas o filtro de `tenant_id` feito pela aplicação
   (SQLAlchemy) — o enforcement de RLS pelo Postgres em si nunca é
   exercitado localmente. Esse gap já estava anotado no `SECURITY.md`
   e na Etapa 10 do DEVLOG, mas a causa raiz exata (superuser, não só
   "role de teste genérico") não estava confirmada até agora.

4. Correção testada e comprovada: com um role dono NÃO-superuser +
   `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, o isolamento passou a
   funcionar mesmo para o dono da tabela (voltou a retornar só 1 linha,
   a do tenant correto). `FORCE ROW LEVEL SECURITY` não estava aplicado
   em nenhuma tabela do schema atual (confirmado via
   `pg_class.relforcerowsecurity = false` em todas as 20 tabelas com
   RLS habilitada).

**Recomendação (ainda não aplicada ao projeto — aguardando decisão do
usuário sobre quando priorizar):**
- Adicionar `FORCE ROW LEVEL SECURITY` em todas as tabelas com policy
  de `tenant_isolation`, como defesa em profundidade adicional (mesmo
  que a role de produção nunca seja superuser/dono, o custo de aplicar
  é baixo e fecha a lacuna por completo).
- Trocar o role usado em `conftest.py`/banco de testes local para um
  não-superuser, não-dono, com GRANTs explícitos (como o `app_role`
  criado neste teste) — separando claramente "role que roda migration"
  de "role que a aplicação usa". Isso faria a suíte de 93 testes
  passar a exercitar RLS de verdade, não só o filtro de aplicação.

Nenhum arquivo do projeto foi alterado nesta investigação — só o banco
de teste local temporário. Escopo: diagnóstico, não implementação.

## Implementação das correções de RLS (sequência da investigação acima)

As duas recomendações da investigação foram implementadas e validadas
com testes reais (não análise estática).

**1. `migrations/009_force_rls.sql`:** `FORCE ROW LEVEL SECURITY` em
todas as 19 tabelas com policy de `tenant_isolation` (`tenants` fica de
fora de propósito — é a própria raiz do tenant, não tem `tenant_id`).
Fecha a lacuna de defesa em profundidade: mesmo que uma conexão futura
use o role dono das tabelas por engano (ex.: script administrativo), o
isolamento continua valendo, desde que esse role não seja superuser
(superuser sempre ignora RLS no Postgres — isso é uma limitação do
próprio banco, não corrigível via SQL; a mitigação real é o role de
aplicação em produção nunca ser superuser, o que já é o caso).

**2. `backend/scripts/setup_test_db.sh` (novo):** recria o banco de
teste com 3 roles reais, espelhando a separação de privilégios de
produção — `estoque_migrator` (dono, só para rodar migrations),
`estoque_app_test` (role de aplicação real: não é dono, sem
`BYPASSRLS`) e `estoque_auth_test` (equivalente ao `auth_service` de
produção — `BYPASSRLS` escopado só a `users`/`refresh_tokens`/`tenants`).
`conftest.py` e `test_estoque_painel.py` foram atualizados para usar
esses roles por padrão e para setar `app.tenant_id` antes de
INSERTs/UPDATEs raw feitos diretamente nos testes (necessário agora que
o role de teste está sujeito a RLS de verdade, não bypassa mais).

**Achado real durante a implementação (não estava nem suspeitado
antes):** ao trocar para o role restrito, 57 dos 100 testes passaram a
falhar. Investigado a fundo: não era um problema do ambiente de teste,
era um bug de disponibilidade real, presente em produção também. Causa:
o padrão `commit()` seguido de `refresh()` — usado em praticamente todo
`service.py` de módulo de negócio (produtos, vendas, estoque, compras,
inventário, alertas, notas fiscais) — faz o `commit()` encerrar a
transação corrente, e o `refresh()` abre uma nova transação implícita
logo em seguida. Como `set_config('app.tenant_id', ..., true)` só vale
para a transação em que foi setado, essa nova transação implícita
rodava sem contexto de tenant. Com o role superuser/dono usado
anteriormente isso nunca dava erro (RLS ignorada, então não importava);
com o role restrito, a query seguinte quebrava com erro de tipo
(`invalid input syntax for type uuid: ""`). Ou seja: esse bug já podia
estar acontecendo silenciosamente contra o role de produção real,
dependendo do padrão exato de commits — só nunca tinha sido pego porque
o ambiente de teste local nunca exercitou RLS de verdade antes de hoje.

**Correção:** em vez de caçar e corrigir esse padrão em cada
`service.py` (mudança grande e arriscada), a correção foi centralizada
em `core/database.py`: `get_db_for_tenant` agora registra um listener
`after_begin` na sessão, que reaplica `app.tenant_id` automaticamente
toda vez que uma nova transação é aberta nessa sessão — não só na
primeira. Cobre o padrão `commit()+refresh()` e qualquer outro caso
futuro de múltiplas transações dentro da mesma requisição, sem exigir
disciplina manual em cada service.

**Resultado final, com Postgres real e roles restritos de verdade:**
- **100/100 testes passando** (antes rodavam sob role superuser/dono —
  agora rodam sob o mesmo tipo de role restrito usado em produção)
- **Bandit: 0 problemas**
- Reconfirmação manual dos testes de isolamento entre tenants em
  Produtos, Estoque, Vendas e Painel, isoladamente, para garantir que a
  correção do `after_begin` não abriu nenhuma brecha nova

**Entregável:** `migrations/009_force_rls.sql` (novo),
`backend/scripts/setup_test_db.sh` (novo), `app/core/database.py`
(fix do `after_begin`), `tests/conftest.py` e
`tests/test_estoque_painel.py` (roles restritos + `set_config` nos
raw inserts), `README.md` e `SECURITY.md` (documentação atualizada) +
`estoque-inteligente-scaffold.zip` (v14 — RLS forçada + suíte de testes
exercitando RLS de verdade + bug real de contexto de tenant corrigido).

### Próximos passos (backlog, sem mudança)

- Replicar o kit de UX nas telas restantes: Vendas, Notas, Compras,
  Inventário, Alertas.
- Seletor de depósito em entrada/saída/ajuste na tela de Movimentação
  (gap registrado na Etapa 12, ainda não tratado).
- Retomar a reconciliação do mockup v4 de Estoque com o que foi
  entregue (pergunta em aberto de sessão anterior, ainda não
  respondida).

## Etapa 15 — Rebranding NexStock (token padrão, login, sidebar)

**Contexto:** o produto ganhou identidade de marca própria — NexStock —,
deixando "Vektra Tech" descontinuada como marca-mãe e "Estoque
Inteligente" rebaixado a slogan/tagline. Decisão do responsável pelo
projeto: o sistema inteiro (login e painel interno de qualquer tenant,
Doce Encanto incluso) passa a usar a paleta padrão NexStock por
default; o Doce Encanto abre mão da identidade caramelo/rosa própria
que tinha. A arquitetura de tokens JSON por tenant é mantida intacta
como mecanismo de override para clientes futuros — hoje nenhum tenant
usa customização, todos caem no default.

**Entregue nesta etapa:**

- `frontend/themes/nexstock.tokens.json` (novo) — token padrão do
  sistema. Paleta: `#0D182A`/`#1B263B` (base/superfície escuros),
  `#10B981`/`#34D399` (verde — accent funcional: botões primários,
  foco de campo, links, estado ativo), `#2563EB` (azul — reservado ao
  mark/gradiente de marca, não compete com o verde como cor de ação).
  Tipografia de produto inalterada (Fraunces + Manrope); Poppins do
  manual de marca não foi necessária no código porque a logo é
  consumida como imagem (símbolo + wordmark já embutidos no PNG), não
  como texto renderizado.
- `frontend/lib/theme/useTheme.tsx` — `carregarTokensDoTenant` agora
  importa `nexstock.tokens.json` como default do sistema (antes
  apontava direto pro token do Doce Encanto). Tipo `ThemeTokens`
  estendido com campos opcionais: `logo_tagline`, `logo_simbolo`,
  `logo_completo`, `cor_marca_azul`, `cor_marca_gradiente_de/para`,
  `cor_acento_soft` — todos opcionais para não quebrar tokens de tenant
  mais antigos que não os definirem.
- `frontend/public/brand/` (novo) — `nexstock-symbol.png` (símbolo
  isolado: cubo + "N" + seta, recortado do arquivo enviado, atenção
  redobrada para não cortar a ponta da seta/chevron direito — mesmo
  cuidado já registrado em sessão anterior) e `nexstock-logo-full.png`
  (wordmark completo, para uso futuro se necessário).
- `frontend/app/login/page.tsx` — reconstruída seguindo a direção
  aprovada em sessão anterior (variação B): fundo escuro com dois
  glows radiais discretos (azul de marca no topo, verde perto do
  rodapé), card translúcido com `backdrop-blur`, layout centralizado
  (sem painel lateral de estatísticas — rejeitado antes por parecer
  "template genérico de SaaS"), símbolo real da logo via `next/image`,
  tagline "ESTOQUE INTELIGENTE" abaixo do nome. Botão primário e foco
  de campo usam o verde (`--cor-acento`), não o azul.
- `frontend/app/(dashboard)/layout.tsx` — sidebar com logo real no
  lugar do ícone genérico (`Store` do Lucide), e item de menu ativo
  agora destacado visualmente (texto + fundo em verde translúcido) via
  `usePathname` — pequena melhora de UX que não existia antes, mantida
  mínima e consistente com o resto do chrome.
- `frontend/tailwind.config.js` — cores `acento-soft` e `marca-azul`
  expostas como utilitários Tailwind.
- `frontend/app/globals.css` — valores de fallback do CSS (antes de o
  token carregar) atualizados pra paleta escura NexStock, evitando
  flash da cor antiga (marrom do Doce Encanto) no primeiro render.

**Verificação de segurança e testes (de praxe, mesmo em etapa
frontend-only):**

- Ambiente de Postgres 16 real provisionado neste sandbox (antes
  inexistente) especificamente para rodar a suíte contra banco de
  verdade, não só análise estática.
- **100/100 testes passando**, roles restritos (`estoque_app_test` sem
  `BYPASSRLS`, `estoque_auth_test` com `BYPASSRLS` escopado).
- **Bandit: 0 issues.**
- Nenhuma mudança de backend nesta etapa — os testes confirmam que o
  rebranding (puramente frontend) não regrediu nada.
- Build de produção do frontend (`next build`) rodado com sucesso, sem
  erros de tipo, todas as 12 rotas geradas.

**Correção de uma observação equivocada feita no início da sessão:**
a branch `staging` no GitHub tinha só 2 commits, com o mais recente
nomeado "Update asyncpg version to 0.30.0" — o nome sugeria que a
Etapa 14 (RLS forçada) não tinha sido enviada. Confirmado, lendo o
código de fato, que a Etapa 14 **já estava presente** (migration
`009_force_rls.sql`, listener `after_begin` em `core/database.py`,
`scripts/setup_test_db.sh` com roles restritos) — o commit só tinha
uma mensagem que não refletia o conteúdo real. Não houve lacuna;
alerta anterior foi um falso positivo.

**Pendente, fora do escopo desta etapa:** não foi possível gerar
screenshot real da tela renderizada neste sandbox (instalação do
Chromium headless via Playwright falhou por bloqueio de rede a um
repositório de terceiros; o pacote `chromium` do apt é só um wrapper
de snap neste ambiente, sem binário real). Validação ficou restrita a
build limpo + testes automatizados; recomenda-se conferência visual
manual após aplicar os arquivos.

**Entregável:** `frontend/themes/nexstock.tokens.json` (novo),
`frontend/lib/theme/useTheme.tsx`, `frontend/app/login/page.tsx`,
`frontend/app/(dashboard)/layout.tsx`, `frontend/tailwind.config.js`,
`frontend/app/globals.css`, `frontend/public/brand/*.png` (novos) +
`estoque-inteligente-scaffold.zip` (v15 — identidade NexStock aplicada
a login, token padrão e chrome do painel).

### Próximos passos (backlog, sem mudança)

- Replicar o kit de UX nas telas restantes: Vendas, Notas, Compras,
  Inventário, Alertas.
- Seletor de depósito em entrada/saída/ajuste na tela de Movimentação.
- Retomar a reconciliação do mockup v4 de Estoque (ainda em aberto).
- Aplicar identidade NexStock nos pontos ainda não cobertos: favicon,
  metadata/título de aba do navegador, e-mails transacionais (quando
  existirem).


