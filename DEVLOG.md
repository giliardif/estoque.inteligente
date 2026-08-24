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

## Etapa 16 — Kit de UX aplicado na tela de Vendas

**Escopo:** aplicar o kit reutilizável (Toast, ConfirmDialog,
TableSkeletonRows, Pagination, cabeçalhos ordenáveis, seleção múltipla
+ BulkActionBar, RowMenu "⋮", useDebouncedValue, atalhos de teclado) no
histórico de vendas, seguindo a ordem sugerida (Vendas → Notas Fiscais
→ Compras → Inventário → Alertas). O carrinho/PDV (metade de cima da
tela) foi mantido como estava — é um fluxo funcional de formulário, não
uma lista, então não fazia sentido "kitificar".

**Backend:**

- `GET /vendas/painel` — endpoint dedicado, separado de `GET /vendas`
  "cru" (mesmo padrão de `/estoque/painel` e `/produtos/painel`, para
  não arriscar quebrar nenhum outro consumidor do endpoint simples,
  mesmo não havendo hoje nenhum outro ponto da UI usando `/vendas`
  como dropdown).
  - KPIs sempre referentes a **hoje** (fixos, não afetados pelos
    filtros da grade abaixo — mesmo princípio do painel de Estoque):
    vendas hoje, faturamento hoje, ticket médio hoje, e total de
    canceladas (todo o histórico, como sinal de atenção).
  - Grade filtrável por período (`data_inicio`/`data_fim`), status
    (`finalizada`/`cancelada`) e busca por nome/SKU de produto dentro
    dos itens da venda (`EXISTS` correlacionado, tenant_id checado
    também dentro da subquery — defesa em profundidade).
  - Ordenação por `criado_em` ou `valor_total`, paginação com total
    real.
- `POST /vendas/{id}/cancelar` — **gap real fechado nesta etapa**: o
  modelo `Venda` já previa o status `"cancelada"` desde sempre, mas
  não existia nenhum caminho no sistema para chegar nele. Cancelamento
  agora estorna automaticamente o estoque (uma "entrada" por item
  vendido, com `origem="Cancelamento de venda"` e
  `referencia_externa` apontando para a venda original — mesmo padrão
  de rastreabilidade de `finalizar`). Só aceita vendas com status
  `"finalizada"` (409 caso contrário); mesma exigência de perfil
  (admin/operador) do endpoint de finalizar.
- **Bug real corrigido:** `finalizado_em` nunca era preenchido ao
  finalizar uma venda, apesar do campo existir na tabela desde a
  migration original. Passou despercebido porque nada exibia ou
  validava esse campo até o painel desta etapa precisar dele para o
  detalhe da venda.

**Frontend (`app/(dashboard)/vendas/page.tsx`):**

- Histórico de vendas reescrito como tabela completa no padrão de
  Estoque/Produtos: 4 cartões de KPI (o de "Canceladas" funciona como
  atalho — clicar nele filtra a grade por `status=cancelada`, mesmo
  padrão de toggle já usado no cartão "Abaixo do mínimo" de Estoque),
  busca com debounce por produto/SKU, filtro de período (dois campos
  de data) e filtro de status, cabeçalhos ordenáveis (Data/Hora, Valor
  total), paginação real, seleção múltipla com exportação CSV das
  vendas selecionadas via `BulkActionBar`.
- RowMenu "⋮" por linha: "Ver detalhes" (abre modal simples com os
  itens da venda, nomes resolvidos a partir da lista de produtos já
  carregada para o carrinho) e "Cancelar venda" (só aparece se
  `status === "finalizada"`; abre `ConfirmDialog` deixando explícito
  que o estoque será estornado).
- Atalho de teclado `/` foca a busca de produto do **carrinho** (não a
  busca do histórico) — é o campo usado com muito mais frequência numa
  tela de PDV. `Esc` fecha o modal de detalhes ou o `ConfirmDialog` de
  cancelamento, o que estiver aberto. Atalho `N` não foi mapeado nesta
  tela: não existe um formulário de "nova venda" separado do próprio
  fluxo de carrinho, então forçar esse atalho não teria uma ação
  natural para disparar.

**Verificação de segurança e testes:**

- Ambiente de Postgres 16 real (mesmo processo das etapas anteriores):
  banco de testes recriado do zero com `scripts/setup_test_db.sh`,
  roles restritos (`estoque_app_test` sem `BYPASSRLS`, usado pela
  suíte via `DATABASE_URL`).
- **11 testes novos** em `tests/test_vendas_painel.py`: KPIs de hoje,
  correção do `finalizado_em`, filtro de período/status/busca,
  ordenação, isolamento entre tenants no painel, estorno de estoque no
  cancelamento (saldo volta exatamente ao valor anterior à venda),
  rejeição de cancelar venda já cancelada (409), rejeição de cancelar
  venda de outro tenant (404), e bloqueio de perfil leitura (403) —
  com verificação de que nada foi alterado na tentativa negada.
- **111/111 testes passando** (100 anteriores + 11 novos, nenhuma
  regressão).
- **Bandit: 0 issues** (2927 linhas escaneadas em `app/`).
- `npx tsc --noEmit` limpo e `next build` completo rodado com sucesso
  (12 rotas geradas, incluindo `/vendas` com o novo painel).

**Entregável:** `backend/app/modules/vendas/service.py`,
`backend/app/modules/vendas/schemas.py`,
`backend/app/modules/vendas/router.py`,
`backend/tests/test_vendas_painel.py` (novo),
`frontend/lib/types.ts`, `frontend/app/(dashboard)/vendas/page.tsx`
(reescrito) + `estoque-inteligente-scaffold.zip` (v16 — kit de UX em
Vendas, cancelamento de venda com estorno, bug do `finalizado_em`
corrigido).

### Próximos passos (backlog, sem mudança)

- Replicar o kit de UX nas telas restantes: Notas Fiscais, Compras,
  Inventário, Alertas.
- Seletor de depósito em entrada/saída/ajuste na tela de Movimentação.
- Retomar a reconciliação do mockup v4 de Estoque (ainda em aberto).
- Aplicar identidade NexStock nos pontos ainda não cobertos: favicon,
  metadata/título de aba do navegador, e-mails transacionais (quando
  existirem).
- Bug conhecido do `asyncpg`/`search_path` no Railway (staging), ainda
  não resolvido — ver seção de aprendizados/pendências combinada com
  Giliardi.

## Correção — Prepared statement do Supavisor (produção) + condição de corrida real em saldo

**Contexto:** erro em produção (Railway/staging) ao cadastrar produto e ao
listar o painel de Produtos:
`asyncpg.exceptions.InvalidSQLStatementNameError: prepared statement
"__asyncpg_stmt_X__" does not exist`, com padrão de X variando a cada
ocorrência (`_b_`, `_d_`, `_10_`...).

**Causa raiz real:** `statement_cache_size=0` já estava presente em
`connect_args` desde a Etapa de setup do Supavisor — mas esse parâmetro é
nativo do `asyncpg.connect()`, e o dialeto `asyncpg` do SQLAlchemy **não
passa por esse caminho**: ele chama `connection.prepare()` diretamente,
contornando esse cache por completo. Ou seja, a config existente nunca
teve efeito real sobre o problema — resolvia o parâmetro certo pro driver
errado. O parâmetro que o SQLAlchemy de fato respeita é
`prepared_statement_cache_size` (nível do dialeto asyncpg do próprio
SQLAlchemy), combinado com `prepared_statement_name_func` gerando um nome
único (UUID) por prepare — assim nenhum nome de statement pode colidir ou
ficar "órfão" de uma conexão física anterior quando o Supavisor recicla o
backend por trás do pooler em modo transaction.

**Verificação real do fix (não só leitura de código):** como esse bug só
se manifesta atrás de um pooler em modo transaction (não em conexão
direta), a suíte normal contra Postgres direto não seria suficiente para
provar a correção. Foi instalado **pgbouncer local em modo `transaction`**
(mesma semântica do Supavisor) para reproduzir e validar de verdade:

1. Reproduzido o erro exato de produção localmente com a config antiga
   (`statement_cache_size=0` apenas), via pgbouncer — confirmado que o
   bug é 100% real e reprodutível fora do Railway.
2. Com a config nova (`prepared_statement_cache_size=0` +
   `prepared_statement_name_func` com UUID), rodadas de 300 execuções
   concorrentes através do pgbouncer — 0 erros.
3. Suíte completa (111 testes) rodada **através do pgbouncer** (topologia
   igual à de produção: app → pooler modo transaction → Postgres) —
   passou 100%.

**Bug real adicional encontrado durante essa verificação (não relacionado
ao pooler):** ao rodar a suíte pela primeira vez através do pgbouncer, o
teste `test_duas_saidas_concorrentes_nao_zeram_estoque_abaixo_de_zero`
falhou de forma determinística (5/5 execuções), embora sempre tivesse
passado contra Postgres direto. Investigação isolou a causa: o
`.with_for_update()` em `calcular_saldo_atual`/`calcular_saldo_por_deposito`
trava as linhas de `Movimentacao` **já existentes** contra update/delete
concorrente — mas não protege contra **leitura fantasma (phantom read)**:
uma segunda transação que ficou bloqueada esperando o lock, ao ser
liberada, só reavalia as linhas que já tinha casado no scan inicial; uma
linha **nova** inserida pela primeira transação (a saída que ela acabou
de gravar) não entra nesse conjunto. Resultado: duas saídas concorrentes
no mesmo produto podiam, juntas, derrubar o saldo abaixo de zero — cada
uma via o saldo "antigo" (sem a saída da outra) e aprovava a validação.
Isso sempre existiu no código; só ficou visível de forma consistente ao
testar através de um pooler, porque o timing mais realista da produção
expõe a janela de corrida — em Postgres direto (round-trip muito rápido),
as duas requisições raramente colidiam na janela exata.

Confirmado isoladamente com um teste mínimo em asyncpg puro (sem
SQLAlchemy) antes de aplicar qualquer correção, para eliminar a
possibilidade de o problema estar em alguma camada do ORM.

**Correção:** função `_travar_saldo_produto()` nova em
`estoque/service.py`, usando `pg_advisory_xact_lock(hashtext(tenant_id),
hashtext(produto_id))` — um lock lógico, não preso a nenhuma linha
específica, que serializa corretamente tanto updates quanto inserts
concorrentes disputando o saldo do mesmo produto. Liberado automaticamente
no commit/rollback da transação. Chamado nos dois pontos de escrita reais
que precisam dessa serialização: `registrar()` (saída/ajuste-negativo) e
`_registrar_transferencia()` (saída na origem) — cobre também `Vendas`,
já que `vendas.service.finalizar()` chama `estoque_service.registrar()`
por item. O `.with_for_update()` original foi mantido como defesa em
profundidade (ainda útil contra update/delete concorrente nas linhas
existentes), mas não é mais o único mecanismo de proteção.

**Verificação de segurança e testes:**

- Ambiente de Postgres 16 real + **pgbouncer local em modo transaction**
  (novo nesta correção, para validar de verdade o cenário de pooler).
- Teste da condição de corrida (`test_duas_saidas_concorrentes_...`)
  re-executado isoladamente 3x consecutivas via pgbouncer após a
  correção — passou 3/3, determinístico.
- Suíte completa (111 testes) via pgbouncer — **111/111 passando**,
  reconfirmado em duas rodadas independentes.
- Suíte completa via Postgres direto validada no início desta correção
  (111/111) e, depois da correção, reconfirmada de forma segmentada por
  arquivo (55/55 nos arquivos que tocam `estoque`, `transferencia`,
  `vendas`, `compras`, `inventario` e `alertas` — os módulos que chamam
  `calcular_saldo_atual`/`calcular_saldo_por_deposito` ou passam pelos
  engines alterados). Rodadas adicionais da suíte completa via conexão
  direta sofreram timeout por lentidão de I/O do próprio ambiente sandbox
  (checkpoints de poucos KB levando 14–118s — degradação do ambiente,
  não do código; Postgres permaneceu saudável e sem queries travadas em
  `pg_stat_activity` durante os timeouts). A cobertura via pgbouncer
  (que exercita literalmente todos os 111 testes, incluindo os módulos
  acima) supre essa lacuna com folga.
- **Bandit: 0 issues** (2974 linhas escaneadas em `app/`).

**Entregável:** `backend/app/core/database.py`,
`backend/app/modules/estoque/service.py` +
`estoque-inteligente-scaffold.zip` (v16.1 — correção de prepared
statement do pooler + correção da condição de corrida em saldo).

## Etapa 17 — Responsividade mobile (shell + Estoque/Produtos/Vendas) + correção de cores legadas

**Escopo:** tornar o shell do dashboard e as três telas já cobertas
pelo kit de UX (Estoque, Produtos, Vendas) utilizáveis em telas de
celular, sem regredir nenhuma funcionalidade existente no desktop.
**Escopo:** tornar o shell do dashboard e as três telas já cobertas
pelo kit de UX (Estoque, Produtos, Vendas) utilizáveis em telas de
celular, sem regredir nenhuma funcionalidade existente no desktop.
Protótipo interativo (mobile vs. desktop lado a lado) foi validado com
Giliardi antes da implementação real. PWA (manifest, service worker,
cache offline) permanece como fase separada, ainda não iniciada.

**Correção de cores legadas (achada durante a inspeção pré-implementação,
corrigida junto por decisão do Giliardi):**

- `#221D18` (borda marrom da era pré-NexStock) hardcoded em 11 lugares,
  incluindo `components/ui/Table.tsx` e `components/ui/Skeleton.tsx`
  (inconsistente com a própria linha 15 do mesmo arquivo, que já usava
  `var(--cor-borda)` corretamente) → padronizado para
  `var(--cor-borda)` em todo o frontend.
- `rgba(201,134,43,...)` / `rgba(196,140,60,...)` (laranja legado usado
  em estados ativo/selecionado de chips, seletores de filtro e linha
  selecionada da tabela) em 12 ocorrências, 8 arquivos — incluindo
  telas que ainda não receberam o kit de UX (Movimentação, Notas,
  Compras, Alertas). Corrigido para o verde `--cor-acento`
  (`rgba(16,185,129,...)`, mesma opacidade original preservada por
  ocorrência) em todo o frontend, não só nas telas desta etapa.

**Shell (`app/(dashboard)/layout.tsx`):**

- Sidebar fixa (`w-60`) mantida apenas em telas `md:` (≥768px) e
  acima — antes não tinha nenhum tratamento para mobile.
- Header sticky no mobile com botão hambúrguer (ícone `Menu`) abrindo
  uma gaveta (drawer) lateral com a mesma navegação da sidebar; fecha
  automaticamente ao trocar de rota, ao clicar fora (overlay
  semi-transparente), ou pelo botão `X`.

**Padrão aplicado em Estoque/Produtos/Vendas (`app/(dashboard)/{estoque,produtos,vendas}/page.tsx`):**

- Cartões de KPI: `grid-cols-2` no mobile → `md:grid-cols-5` (Estoque)
  ou `md:grid-cols-4` (Vendas); todos os KPIs originais preservados
  (nenhum removido para "economizar espaço" — diferente do protótipo
  inicial, que tinha cortado um KPI por simplicidade visual).
- Ações rápidas (Estoque) e seletores/chips de filtro: rolagem
  horizontal no mobile (`overflow-x-auto`) em vez de quebra de linha,
  usando `md:contents` para que os mesmos elementos voltem a participar
  do layout `flex-wrap` normal em telas `md:` sem duplicar JSX.
- Busca: largura total no mobile, `md:w-72`/`md:w-64` no desktop
  (mantido como antes).
- **Tabela → lista de cards no mobile** (`hidden md:block` na tabela +
  bloco `md:hidden` com cards): cada card preserva checkbox de seleção
  múltipla, `RowMenu` com as mesmas ações da tabela, badge de
  prioridade/status, e os campos secundários num grid interno de 2-3
  colunas. `Pagination` reaproveitado sem alteração em ambos os modos.
- `ProdutoForm`: grid interno de 2 colunas (SKU/Unidade,
  Custo/Mínimo) vira 1 coluna abaixo do breakpoint `sm:` para não
  apertar campos em telas muito estreitas.
- Modais de detalhe (edição de produto, detalhe de venda): adicionado
  `overflow-y-auto` + `max-h-full` no container, para não cortar
  conteúdo em telas curtas (ex. celular em paisagem).

**Verificação:**

- `npx tsc --noEmit` limpo.
- `next build` completo rodado com sucesso (14 rotas geradas, mesmo
  contando as telas ainda não responsivas).
- Suíte completa do backend rodada contra Postgres 16 local (mesmo
  processo de sempre, roles restritos sem `BYPASSRLS`) para confirmar
  ausência de regressão, já que a mudança desta etapa é 100% frontend:
  **111/111 testes passando**, nenhuma alteração no backend.

**Entregável:** `frontend/app/(dashboard)/layout.tsx`,
`frontend/app/(dashboard)/estoque/page.tsx`,
`frontend/app/(dashboard)/produtos/page.tsx`,
`frontend/app/(dashboard)/vendas/page.tsx`,
`frontend/components/produtos/ProdutoForm.tsx`,
`frontend/components/ui/Table.tsx`, `frontend/components/ui/Skeleton.tsx`
(+ demais arquivos tocados apenas pela correção de cor —
`movimentacao/page.tsx`, `notas/page.tsx`, `compras/page.tsx`,
`alertas/page.tsx`) + `estoque-inteligente-scaffold.zip` (v17).

### Próximos passos (backlog, sem mudança)

- Aplicar o mesmo padrão responsivo nas telas restantes do rollout:
  Notas Fiscais, Compras, Inventário, Alertas (que ainda não têm o kit
  de UX aplicado — vão nascer responsivas direto).
- Fase PWA (manifest, service worker, cache offline) — separada do
  trabalho de responsividade, ainda não iniciada.
- Seletor de depósito em entrada/saída/ajuste na tela de Movimentação.
- Retomar a reconciliação do mockup v4 de Estoque (ainda em aberto).
- Aplicar identidade NexStock nos pontos ainda não cobertos: favicon,
  metadata/título de aba do navegador, e-mails transacionais (quando
  existirem).
- Bug conhecido do `asyncpg`/`search_path` no Railway (staging), ainda
  não resolvido.
- Replicar em produção (quando o ambiente for configurado) a mesma
  config de `prepared_statement_cache_size`/`prepared_statement_name_func`
  — já está no `database.py` compartilhado, então não exige ação extra
  além do deploy normal, mas vale confirmar no primeiro cadastro real de
  produto em produção.



## Etapa 18 — Kit de UX + responsividade em Notas Fiscais

**Escopo:** primeira das 5 telas restantes (Notas Fiscais, Compras,
Inventário, Alertas, Movimentação) a receber o kit de UX. Diferente da
Etapa 17, o padrão responsivo já estava validado e aprovado — aplicado
direto, sem novo protótipo. Feita tela por tela (não em lote) para
poder validar cada uma com testes reais antes de seguir pra próxima.

**Backend — novo endpoint `GET /notas-fiscais/painel`:**

- Mantido separado de `GET /notas-fiscais` (usado como listagem "crua"
  por outras telas) — mesmo princípio de `/estoque/painel`,
  `/produtos/painel`, `/vendas/painel`: mudar o contrato do endpoint
  cru quebraria quem já depende dele.
- KPIs (`total_notas`, `itens_pendentes_confirmacao`,
  `valor_total_importado`, `fornecedores_distintos`) sempre calculados
  sobre o total do tenant, sem aplicar busca/filtro — mesmo princípio
  já usado em Estoque/Produtos/Vendas (KPI não reflete o filtro atual).
- Filtros: status, `fornecedor_id`, busca por número da nota ou nome
  do fornecedor (`ILIKE`), ordenação por número/status/data de
  criação, paginação real (`total`/`pagina`/`tamanho`).
- `itens_pendentes` por nota calculado via subquery correlacionada
  (`NotaFiscalItem.status_match = 'pendente_cadastro'`), evitando N+1.
- Schemas novos em `notas_fiscais/schemas.py`:
  `KpisNotasFiscaisOut`, `FiltrosNotasFiscaisOut`,
  `PainelNotasFiscaisOut`.
- 7 testes novos em `tests/test_notas_fiscais_painel.py`: KPIs
  refletindo importação recente, itens presentes na listagem,
  isolamento entre tenants (RLS), filtro por status, busca por
  número, paginação (`total` correto), lista de fornecedores nos
  filtros.

**Frontend (`app/(dashboard)/notas/page.tsx` — reescrita completa):**

- KPIs em cartões (`grid-cols-2` mobile → `grid-cols-4` desktop),
  destaque visual em verde `--cor-acento` quando há itens pendentes
  de confirmação.
- Busca com debounce (300ms), atalho `/` pra focar, chips de status
  (Processada/Pendente/Cancelada) com rolagem horizontal no mobile,
  seletor de fornecedor (populado pelo `filtros.fornecedores` do
  próprio painel).
- Tabela de notas importadas vira lista de cards no mobile
  (`hidden md:block` / `md:hidden`), cada card com `RowMenu` (mesma
  ação "Ver itens" da tabela desktop), badge de pendências e data.
  Ordenação de coluna (`ThOrdenavel`), paginação real (`Pagination`),
  skeleton de carregamento (`TableSkeletonRows`) — mesmo padrão do kit
  usado em Estoque/Produtos/Vendas.
- Bloco "Itens da nota selecionada" (upload de XML e itens
  reconhecidos/pendentes/ignorados) mantido funcionalmente idêntico,
  também com tratamento responsivo (cards no mobile).
- Sem cores legadas nesse arquivo (já usava `var(--cor-borda)` e verde
  `--cor-acento` corretamente antes desta etapa).

**Verificação:**

- Backend: suíte completa rodada contra Postgres 16 local, role
  restrita (`NOBYPASSRLS`) — **118/118 passando** (111 anteriores + 7
  novos).
- Frontend: `npx tsc --noEmit` limpo, `next build` completo limpo (14
  rotas, incluindo `/notas` com 4.13 kB / 111 kB First Load JS).

**Entregável:** `backend/app/modules/notas_fiscais/{schemas.py,service.py,router.py}`,
`backend/tests/test_notas_fiscais_painel.py`, `frontend/lib/types.ts`,
`frontend/app/(dashboard)/notas/page.tsx` +
`estoque-inteligente-scaffold.zip` (v18).

**Estado do rollout:** kit de UX + responsividade aplicados em
Estoque, Produtos, Vendas, **Notas Fiscais**. Restam Compras,
Inventário, Alertas, Movimentação — seguem uma etapa por vez.

## Etapa 19 — Kit de UX + responsividade em Compras

**Escopo:** segunda das telas restantes a receber o kit de UX. Mesmo
método da Etapa 18: painel novo no backend + reescrita da tela, tela
por tela, testes reais rodados antes de seguir.

**Backend — novo endpoint `GET /compras/painel`:**

- Mantido separado de `GET /compras/pedidos` (listagem crua) — mesmo
  princípio dos demais paineis.
- KPIs (`total_pedidos`, `pedidos_em_aberto`, `valor_total_pedidos`,
  `fornecedores_distintos`) sempre sobre o total do tenant, sem
  aplicar busca/filtro.
- "Em aberto" = status `rascunho` ou `recebido_parcial`.
- Cada linha do painel traz `valor_total`, `qtd_itens` e
  `quantidade_pendente` do pedido via subqueries correlacionadas
  contra `pedidos_compra_itens` — evita N+1 e mantém a agregação no
  banco.
- Filtros: status, `fornecedor_id`, busca por nome de fornecedor
  (`ILIKE`), ordenação por status/data de criação, paginação real.
- Schemas novos em `compras/schemas.py`: `KpisComprasOut`,
  `FiltrosComprasOut`, `PedidoListaItemOut`, `PainelComprasOut`.
- 7 testes novos em `tests/test_compras_painel.py`: KPIs refletindo
  pedido criado, item presente na listagem, status/quantidade pendente
  corretos após recebimento parcial, isolamento entre tenants (RLS),
  filtro por status, paginação (`total` correto), `qtd_itens`/
  `valor_total` corretos.

**Frontend (`app/(dashboard)/compras/page.tsx` — reescrita completa):**

- KPIs em cartões, destaque em verde quando há pedidos em aberto.
- Busca com debounce, atalho `/`, chips de status (Rascunho/Recebido
  parcial/Recebido/Cancelado), seletor de fornecedor.
- Tabela de pedidos vira lista de cards no mobile (`hidden md:block` /
  `md:hidden`), `RowMenu` com ação "Ver / receber", `ThOrdenavel`,
  `Pagination`, `TableSkeletonRows` — mesmo padrão do kit.
- Clicar num pedido (linha, card ou item do `RowMenu`) abre um painel
  de detalhe com os itens do pedido e botão "Receber" por item — sai
  do padrão *editar via modal* usado em Produtos porque recebimento é
  uma ação incremental por item, não uma edição de registro único;
  mantém a mesma UX que a tela já tinha antes do kit, só que agora
  alimentado pelo endpoint de detalhe (`GET /compras/pedidos/{id}`)
  chamado sob demanda em vez de pré-carregado.
- Bloco de "Sugestão de reposição" e formulário de criação de pedido
  (produto/quantidade/custo) mantidos funcionalmente idênticos, com
  ajustes de layout para largura total no mobile.
- Sem cores legadas nesse arquivo (já usava tokens corretos).

**Verificação:**

- Backend: suíte completa rodada contra Postgres 16 local, role
  restrita — **125/125 passando** (118 anteriores + 7 novos). Cluster
  Postgres tinha caído entre sessões (dados intactos, só o processo
  não estava rodando) — identificado com `pg_lsclusters` e resolvido
  com `pg_ctlcluster 16 main start` antes de rodar os testes.
- Frontend: `npx tsc --noEmit` limpo, `next build` completo limpo (14
  rotas, `/compras` com 4.01 kB / 111 kB First Load JS).

**Entregável:** `backend/app/modules/compras/{schemas.py,service.py,router.py}`,
`backend/tests/test_compras_painel.py`, `frontend/lib/types.ts`,
`frontend/app/(dashboard)/compras/page.tsx` +
`estoque-inteligente-scaffold.zip` (v19).

**Estado do rollout:** kit de UX + responsividade aplicados em
Estoque, Produtos, Vendas, Notas Fiscais, **Compras**. Restam
Inventário, Alertas, Movimentação.

## Etapa 20 — Kit de UX + responsividade em Inventário

**Escopo:** terceira das telas restantes a receber o kit de UX. Mesmo
método das Etapas 18 e 19.

**Backend — novo endpoint `GET /inventario/painel`:**

- Mantido separado de `GET /inventario` (listagem crua, ainda usada
  pelo fluxo de retomar contagem em aberto) — mesmo princípio dos
  demais paineis.
- **Atenção ao gap já registrado no backlog:** `InventarioItem` não
  tem `tenant_id` próprio. Todas as agregações do painel (KPI
  `itens_divergentes`, e `qtd_itens_contados`/`qtd_divergentes` por
  linha) filtram tenant via join/correlação com `Inventario.tenant_id`
  — nunca por uma coluna `tenant_id` direta em `InventarioItem`, que
  não existe. Não mexi na estrutura da tabela nesta etapa (fora de
  escopo, backlog não bloqueante); só documentei o cuidado no código.
- KPIs (`total_inventarios`, `inventarios_abertos`,
  `itens_divergentes`, `depositos_distintos`) sempre sobre o total do
  tenant, sem aplicar busca/filtro.
- Cada linha traz `qtd_itens_contados` e `qtd_divergentes` via
  subqueries correlacionadas contra `inventario_itens`.
- Filtros: status, `deposito_id`, busca por ciclo (`ILIKE`),
  ordenação por ciclo/status/data de criação, paginação real.
- Schemas novos em `inventario/schemas.py`: `KpisInventarioOut`,
  `FiltrosInventarioOut`, `InventarioListaItemOut`,
  `PainelInventarioOut`.
- 7 testes novos em `tests/test_inventario_painel.py`: KPIs refletindo
  abertura, `qtd_divergentes` correta após fechamento com e sem
  divergência, isolamento entre tenants (RLS), filtro por status,
  busca por ciclo, paginação (`total` correto). Um dos testes de
  paginação precisou fechar cada inventário antes de abrir o próximo
  — a regra de negócio só permite um inventário aberto por depósito
  por vez, então três `POST /inventario` em sequência sem fechar
  teria caído no 409 já existente.

**Frontend (`app/(dashboard)/inventario/page.tsx` — reescrita completa):**

- KPIs em cartões, destaque em verde quando há ciclos em aberto.
- Fluxo de abrir/contar/fechar ciclo mantido funcionalmente idêntico
  (é uma ação de estado único, não uma listagem — mesmo raciocínio já
  aplicado ao formulário de criar pedido em Compras), só com a tabela
  de contagem ganhando tratamento responsivo (linha vira layout
  produto+input compacto no mobile).
- A antiga seção estática "Inventários anteriores" foi substituída
  pelo painel completo do kit: busca por ciclo, chips de status
  (Aberto/Fechado), seletor de depósito, ordenação de coluna,
  paginação real, tabela → cards no mobile, badge de divergência (em
  vermelho `--cor-alerta` quando há itens divergentes, verde quando a
  contagem bateu).
- Sem cores legadas nesse arquivo.

**Verificação:**

- Backend: suíte completa rodada contra Postgres 16 local, role
  restrita — **132/132 passando** (125 anteriores + 7 novos). Cluster
  Postgres caiu de novo entre sessões (mesmo comportamento da Etapa
  19) — resolvido do mesmo jeito, `pg_ctlcluster 16 main start` antes
  de rodar os testes.
- Frontend: `npx tsc --noEmit` limpo, `next build` completo limpo (14
  rotas, `/inventario` com 3.55 kB / 111 kB First Load JS).

**Entregável:** `backend/app/modules/inventario/{schemas.py,service.py,router.py}`,
`backend/tests/test_inventario_painel.py`, `frontend/lib/types.ts`,
`frontend/app/(dashboard)/inventario/page.tsx` +
`estoque-inteligente-scaffold.zip` (v20).

**Estado do rollout:** kit de UX + responsividade aplicados em
Estoque, Produtos, Vendas, Notas Fiscais, Compras, **Inventário**.
Restam Alertas, Movimentação.

## Etapa 21 — Kit de UX + responsividade em Alertas

**Escopo:** quarta das telas restantes a receber o kit de UX. Mesmo
método das etapas anteriores.

**Backend — novo endpoint `GET /alertas/painel`:**

- Mantido separado de `GET /alertas` (listagem crua) — mesmo
  princípio dos demais paineis.
- KPIs (`total_ativos`, `validade`, `estoque_baixo`, `produto_parado`)
  contam apenas alertas **não lidos** — diferente dos outros paineis,
  aqui o "universo" natural do KPI não é o total histórico, e sim os
  alertas ativos, já que um alerta lido é considerado resolvido/
  arquivado. Documentado explicitamente no código pra não virar
  inconsistência futura por engano.
- Filtros: `tipo` (validade/estoque_baixo/produto_parado), `status`
  (lido/nao_lido), busca por mensagem ou nome do produto (`ILIKE`
  nos dois via `OR`), paginação real. Sem ordenação de coluna — a
  lista já é naturalmente ordenada por mais recente primeiro, mesmo
  comportamento da tela anterior.
- Schemas novos em `alertas/schemas.py`: `KpisAlertasOut`,
  `AlertaListaItemOut`, `PainelAlertasOut`.
- 7 testes novos em `tests/test_alertas_painel.py`: KPIs refletindo
  alerta gerado pelo motor, item com nome do produto, KPI não conta
  alerta já lido, filtro por status lido/não lido, filtro por tipo,
  busca por nome de produto, isolamento entre tenants (RLS). Um teste
  inicial tinha um bug de asserção — produto sem movimentação E sem
  saldo dispara `estoque_baixo` **e** `produto_parado` ao mesmo tempo,
  então pegar "o primeiro alerta daquele produto" sem filtrar por tipo
  dava resultado não-determinístico; corrigido filtrando por tipo
  explicitamente antes de rodar a suíte completa.

**Frontend (`app/(dashboard)/alertas/page.tsx` — reescrita completa):**

- KPIs em cartões (Ativos/Validade/Estoque baixo/Produto parado),
  destaque em verde quando há alertas ativos.
- Painel de "Regras configuradas" (ativar/desativar, editar parâmetro
  de dias) mantido funcionalmente idêntico — é configuração, não uma
  listagem, mesmo raciocínio já aplicado ao formulário de Compras e
  ao fluxo de contagem de Inventário; só ganhou layout responsivo
  (linha vira coluna no mobile).
- Lista de alertas agora usa o kit completo: busca, chips de status
  (Ativos/Lidos) e de tipo, paginação real, tabela → cards no mobile.
  Botão "marcar como lido" some da linha assim que o alerta é
  marcado (recarrega o painel), mantendo o comportamento anterior de
  "sumir da lista" mesmo agora que a lista é paginada/filtrada de
  verdade.
- Sem cores legadas nesse arquivo.

**Verificação:**

- Backend: suíte completa rodada contra Postgres 16 local, role
  restrita — **139/139 passando** (132 anteriores + 7 novos, após
  corrigir o bug de asserção descrito acima). Cluster Postgres caiu
  de novo entre sessões — mesmo procedimento de sempre pra resolver.
- Frontend: `npx tsc --noEmit` limpo, `next build` completo limpo (14
  rotas, `/alertas` com 3.52 kB / 111 kB First Load JS).

**Entregável:** `backend/app/modules/alertas/{schemas.py,service.py,router.py}`,
`backend/tests/test_alertas_painel.py`, `frontend/lib/types.ts`,
`frontend/app/(dashboard)/alertas/page.tsx` +
`estoque-inteligente-scaffold.zip` (v21).

**Estado do rollout:** kit de UX + responsividade aplicados em
Estoque, Produtos, Vendas, Notas Fiscais, Compras, Inventário,
**Alertas**. Resta apenas Movimentação.

## Etapa 22 — Kit de UX + responsividade em Movimentação (fecha o rollout)

**Escopo:** última das telas restantes. Fecha o rollout completo do
kit de UX + responsividade em todas as telas do produto.

**Backend — novo endpoint `GET /estoque/movimentacoes/painel`:**

- Vive no módulo `estoque` (não existe módulo `movimentacao` dedicado
  — a tela consome o histórico de `Movimentacao`, que já pertence ao
  domínio de estoque). Mantido separado de `GET /estoque/movimentacoes`
  (listagem crua, ainda usada pelo próprio formulário de registro
  desta tela) e de `GET /estoque/painel` (painel da tela de Estoque —
  saldo por produto, recorte totalmente diferente de histórico de
  lançamentos).
- KPIs (`total_movimentacoes`, `entradas`, `saidas`, `ajustes`)
  sempre sobre o total do tenant, sem aplicar busca/filtro.
- Filtros: tipo, `produto_id`, busca por nome de produto ou motivo/
  origem (`ILIKE` nos dois via `OR`), ordenação por tipo/quantidade/
  data, paginação real.
- Schemas novos em `estoque/schemas.py`: `KpisMovimentacaoOut`,
  `FiltrosMovimentacaoOut`, `MovimentacaoListaItemOut`,
  `PainelMovimentacaoOut`.
- 7 testes novos em `tests/test_movimentacao_painel.py`: KPIs
  refletindo entrada/saída registradas, item com nome do produto,
  isolamento entre tenants (RLS), filtro por tipo, busca por nome de
  produto, lista de produtos nos filtros, paginação (`total` correto).

**Frontend (`app/(dashboard)/movimentacao/page.tsx` — reescrita completa):**

- Formulário de registrar movimentação (entrada/saída/transferência/
  ajuste, com campos condicionais por tipo) mantido funcionalmente
  idêntico — inclusive o deep-link `?tipo=&produto_id=` vindo das
  "ações rápidas" da tela de Estoque, que já existia na versão
  anterior (`useSearchParams` dentro de `<Suspense>`, exigido pelo App
  Router) — só ganhou layout responsivo.
- Histórico substituído pelo painel completo do kit: KPIs, busca,
  chips de tipo, seletor de produto, ordenação de coluna, paginação
  real, tabela → cards no mobile. Badge de tipo colorido (verde pra
  entrada, vermelho pra saída, neutro pra ajuste/transferência) e
  ícone indicando quando a movimentação faz parte de um grupo de
  transferência.
- Sem cores legadas nesse arquivo.

**Verificação:**

- Backend: suíte completa rodada contra Postgres 16 local, role
  restrita — **146/146 passando** (139 anteriores + 7 novos).
  Durante essa etapa a suíte completa passou a estourar o limite de
  tempo de execução do sandbox — investigado com `pg_stat_activity`
  (sem locks travados) e `pg_stat_user_tables` (mais de 1200 tenants/
  usuários acumulados de execuções repetidas ao longo de várias
  etapas). Resolvido recriando a base de teste do zero
  (`scripts/setup_test_db.sh`) — depois disso a suíte voltou a rodar
  em ~96s. Também confirmado nesta etapa que processos em background
  (`nohup`/nohup+setsid) não sobrevivem entre chamadas de ferramenta
  no sandbox — Postgres precisa ser religado a cada chamada que for
  rodar os testes, mesmo já tendo sido religado numa chamada anterior
  na mesma sessão.
- Frontend: `npx tsc --noEmit` limpo, `next build` completo limpo (14
  rotas, `/movimentacao` com 3.94 kB / 111 kB First Load JS).

**Entregável:** `backend/app/modules/estoque/{schemas.py,service.py,router.py}`,
`backend/tests/test_movimentacao_painel.py`, `frontend/lib/types.ts`,
`frontend/app/(dashboard)/movimentacao/page.tsx` +
`estoque-inteligente-scaffold.zip` (v22).

**Estado do rollout: CONCLUÍDO.** Kit de UX + responsividade
aplicados em todas as telas do produto: Estoque, Produtos, Vendas,
Notas Fiscais, Compras, Inventário, Alertas, Movimentação. Próximo
destino natural do produto (não iniciado, arquitetura pendente de
decisão): Painel Inteligente / Painel Home real, e fase PWA
(explicitamente separada e adiada).

## Etapa 23 — Painel Home real (KPIs, gráficos e cruzamento de módulos)

**Escopo:** primeira versão real da tela inicial do produto (`GET /`),
substituindo o placeholder que só mostrava alertas em aberto e estoque
abaixo do mínimo. Prototipado antes em HTML/CSS estático (aprovado por
Giliardi, com várias rodadas de ajuste de paleta, interatividade e
conteúdo) e só então implementado de verdade — mesmo fluxo já usado em
mudanças visuais significativas.

**Diferença estrutural das demais etapas do rollout:** as Etapas 11–22
sempre trabalharam dentro de um módulo (`GET /<módulo>/painel`). O Painel
Home cruza dados de vários módulos ao mesmo tempo (estoque, movimentações,
vendas, categorias, alertas, compras) — por isso ganhou um módulo próprio
(`backend/app/modules/painel/`) em vez de viver dentro de um dos módulos
existentes.

**Backend — novo endpoint `GET /painel?dias=7|30|60|90`:**

- Sem paginação/filtro — sempre um retrato agregado do tenant inteiro; só
  o período do gráfico de movimentações é configurável.
- `kpis`: valor total de estoque (saldo × custo médio, produtos ativos),
  produtos cadastrados, entradas/saídas do mês corrente, faturamento do
  mês corrente (vendas finalizadas). Saldo por produto calculado uma única
  vez (`_saldos_por_produto`) e reaproveitado pelos três blocos que
  precisam dele (KPI de valor, giro, estoque crítico) — evita repetir a
  mesma agregação sobre `Movimentacao` três vezes.
- `movimentacoes_periodo`: série contínua dia a dia (preenche dias sem
  movimentação com zero — o gráfico do frontend espera uma série sem
  buracos, não só os dias com dado).
- `giro_estoque_top5`: giro em dias = saldo atual ÷ (saída dos últimos 30
  dias ÷ 30). Produto sem nenhuma saída na janela fica de fora (giro
  indefinido, não faz sentido ordenar como "mais rápido").
- `estoque_por_categoria`: contagem de produtos ativos por categoria,
  com percentual sobre o total — soma sempre 100% (validado em teste).
- `estoque_critico`: produtos ativos com `estoque_minimo > 0` e saldo
  abaixo do mínimo, com nível `"critico"` (< 50% do mínimo) ou `"baixo"`
  (< 100%), ordenados pelo mais crítico primeiro.
- `ultimas_movimentacoes` e `alertas` (resumo por tipo, só não lidos —
  mesmo princípio já usado no painel de Alertas — mais contagem de
  pedidos de compra em aberto).
- Schemas novos em `painel/schemas.py`: `KpisPainelOut`,
  `PontoMovimentacaoOut`, `ProdutoGiroOut`, `CategoriaResumoOut`,
  `ProdutoCriticoOut`, `MovimentacaoRecenteOut`, `AlertasResumoOut`,
  `PainelGeralOut`.
- 11 testes novos em `tests/test_painel.py`: KPIs de estoque/produtos,
  KPIs de saída/faturamento do mês, série de movimentações soma a entrada
  da fixture, série respeita o parâmetro `dias` (7/30/90), estoque crítico
  lista produto zerado como `"critico"`, não lista produto acima do
  mínimo, categorias somam 100%, últimas movimentações trazem nome do
  produto via join, giro só lista produto com saída na janela (antes e
  depois de uma venda), alertas contam pedido em aberto, isolamento entre
  tenants (RLS) — tanto na lista quanto no KPI agregado.

**Frontend (`app/(dashboard)/page.tsx` — reescrita completa):**

- 5 cartões de KPI (mesmo componente `CartaoKpi` já usado nas demais
  telas, com ícone), unidade (`un`/`produtos`) exibida de forma discreta
  ao lado do número — pedido explícito do Giliardi depois de notar que
  "3.462" sozinho não deixava claro que era unidades.
- Gráfico de movimentações em SVG puro (sem nova dependência — o projeto
  não tinha nenhuma lib de gráficos instalada, e um gráfico de duas linhas
  não justificava puxar uma; decisão registrada aqui em vez de silenciosa)
  com tooltip real ao passar o mouse (linha guia + valores do dia) e
  seletor de período (7/30/60/90 dias) que reconsulta o endpoint.
- Estoque por Categoria em donut SVG interativo: passar o mouse (ou tocar,
  no mobile) num segmento ou item da legenda troca o número central pela
  quantidade daquela categoria; sem hover, mostra o total.
- Giro de Estoque (Top 5), Alertas e Pendências, Últimas Movimentações e
  Estoque Crítico — cada linha é clicável e abre um popup pequeno de
  prévia (mesmo padrão visual do `ConfirmDialog` já usado no kit) com os
  dados principais e um botão que navega para a tela de gestão
  correspondente (`/estoque`, `/compras`, `/alertas`, `/movimentacao`) —
  fluxo pedido explicitamente por Giliardi: prévia rápida sem sair do
  painel, com opção de ir para a tela completa.
- Estoque Crítico tem tabela no desktop e lista de cards no mobile
  (`hidden md:block` / `md:hidden`), seguindo o mesmo padrão responsivo
  do resto do kit.
- Saudação (Bom dia/Boa tarde/Boa noite, calculado por horário local) +
  frase de resumo + data por extenso, todos em linhas separadas por
  pedido do Giliardi durante a prototipagem.
- **Gap identificado e propositalmente não resolvido nesta etapa:** a
  saudação não usa o nome do usuário porque `CurrentUser`/`/auth/*` não
  expõe o campo `nome` (existe em `User` no banco, mas nunca foi
  retornado pela API de auth). Corrigir isso é uma mudança pequena, mas
  toca o módulo de auth — fora do escopo combinado ("não mexer na
  estrutura") sem sua aprovação explícita. Fica registrado aqui para você
  decidir se quer isso como um ajuste rápido separado.
- Sem cores legadas — usa os tokens do tema (`--cor-*`) em tudo, com
  algumas cores auxiliares fixas (verde-claro, âmbar, cinza, azul) só
  onde o gráfico/donut precisam de mais tons do que os tokens oferecem
  pra distinguir séries/categorias, mesmo raciocínio já usado no
  protótipo HTML aprovado.

**Verificação:**

- Backend: suíte completa rodada contra Postgres 16 local, role
  restrita (`NOBYPASSRLS`, confirmado via `pg_roles` antes de rodar) —
  **157/157 passando** (146 anteriores + 11 novos). Bandit: 0 issues.
  Ambiente desta sessão não tinha Postgres pré-instalado (sandbox novo)
  — instalado via `apt-get install postgresql-16` antes de rodar
  `setup_test_db.sh`.
- Frontend: `npx tsc --noEmit` limpo, `next build` completo limpo (14
  rotas, `/` com 6.21 kB / 113 kB First Load JS). Ajuste feito durante a
  verificação: `TableSkeletonRows` retorna `<tr>` e só pode ser usado
  dentro de `<table>` — os blocos que não são tabela (Giro, Alertas,
  Últimas Movimentações) passaram a usar um skeleton próprio
  (`SkeletonLista`); o de Estoque Crítico (que é tabela de verdade)
  manteve `TableSkeletonRows`, agora corretamente dentro de
  `<table><tbody>`.

**Entregável:** `backend/app/modules/painel/{schemas.py,service.py,router.py}`,
`backend/app/main.py`, `backend/tests/test_painel.py`,
`frontend/lib/types.ts`, `frontend/app/(dashboard)/page.tsx` +
`estoque-inteligente-scaffold.zip` (v23).

**Estado do produto:** Painel Home real no ar, cruzando dados de todos os
módulos. Fases seguintes já mapeadas no backlog: nome do usuário na
saudação (gap acima), toggle claro/escuro (após fechar Movimentação — já
fechada, então liberado quando você quiser), PWA (fase separada).

## Correção — Layout do Painel Home quebrado em telas médias/desktop estreito

Giliardi reportou (com screenshots reais, celular + "modo desktop" do
Chrome) dois problemas na Etapa 23: cartões de KPI cortados/truncados de
forma feia, e o gráfico de Movimentações + Giro de Estoque aparecendo
empilhado em vez de lado a lado como no protótipo aprovado.

**Causa raiz:** a página do Painel foi a única do sistema a aplicar
`max-w-6xl` no container principal — nenhuma outra tela (Vendas, Estoque,
etc.) limita a largura assim, elas usam toda a largura disponível dentro
do `<main>`. Combinado com a sidebar fixa de 240px, isso deixava pouco
espaço real disponível bem no ponto exato em que os breakpoints do Painel
mudavam de coluna (`md:grid-cols-5` a 768px de viewport — mas o viewport
inclui a sidebar, então a área de conteúdo real nesse ponto é ~470px, não
768px), causando o aperto visual. O split lado a lado do gráfico usava
`lg:` (1024px de viewport), que não disparava no "modo desktop" do Chrome
mobile (que simula ~980px) — daí aparecer empilhado mesmo "no modo
desktop".

**Correção:**
- Removido o `max-w-6xl` — Painel agora usa a largura cheia do `<main>`,
  igual a todas as outras telas (consistência com o padrão já
  estabelecido, que eu tinha desviado sem perceber).
- Grid de KPIs: de `grid-cols-2 md:grid-cols-5` para
  `grid-cols-2 md:grid-cols-3 xl:grid-cols-5` — escala em 3 passos em vez
  de pular direto de 2 para 5 exatamente no ponto mais apertado.
- Split gráfico + giro de estoque: de `lg:grid-cols-[1.6fr_1fr]` para
  `md:grid-cols-[1.6fr_1fr]` — fica lado a lado mais cedo, cobrindo o
  caso do "modo desktop" simulado do celular.
- Valor do KPI (não só o rótulo) agora tem `truncate` — se algum dia um
  valor for maior que o espaço disponível, ele reticencia (`...`) em vez
  de simplesmente cortar sem indicação visual.

**Verificação:** `npx tsc --noEmit` e `next build` limpos de novo (14
rotas). Suíte de backend re-executada por precaução mesmo sendo mudança
só de frontend — 157/157 continuam passando.

**Nota:** ainda não tenho como capturar screenshot real em diferentes
larguras neste ambiente (sem display) — a verificação foi por inspeção
de código/CSS e cálculo manual da largura disponível em cada breakpoint,
não visual. Se ainda estiver apertado em algum tamanho de tela
específico, me manda um print de novo que eu ajusto os breakpoints com
mais precisão.

## Correção — sinal duplicado em ajustes, Giro de Estoque cramped, KPIs em linha mais cedo

Giliardi mandou novos prints (dados reais em staging desta vez, não mais
"modo desktop") mostrando que o layout ainda não batia com o mockup
aprovado. Achei três problemas de verdade, além do visual:

**Bug real — sinal duplicado ("--18 un"):** no backend, `entrada`/`saida`/
`transferencia` sempre gravam `quantidade` como magnitude positiva (a
direção vem do `tipo`), mas `ajuste` grava o próprio sinal já resolvido
(pode ser negativo — ex.: ajuste automático de fechamento de inventário
reduzindo estoque). O frontend assumia "tudo que não é entrada leva um
'-' na frente", então um ajuste de -18 virava "-" + "-18" = "--18 un".
Corrigido com `formatarQuantidadeMovimentacao()`: entrada sempre "+",
saída sempre "-", ajuste usa o próprio sinal do valor, transferência
mostra só a magnitude (não tem uma direção única — são duas pernas por
movimentação). Ícone/cor também passaram a seguir essa mesma regra
(`iconeMovimentacao()`) em vez de só entrada-vs-resto.

**Giro de Estoque cortando texto:** nome do produto e "X.X dias · XX un"
tentavam caber na mesma linha dentro de um painel de ~250-300px — com
nomes de produto maiores que "Chocolate ao Leite", cortava feio. Virou
duas linhas (nome em cima, giro embaixo), mesmo padrão visual do resto
do painel.

**KPIs em 5 colunas mais cedo:** breakpoint de 5 colunas trazido de `xl`
(1280px) pra `lg` (1024px) — mais perto do que o mockup mostrava, sem
voltar ao aperto que causou a correção anterior (o `truncate` no valor
já protege contra corte feio se ainda ficar apertado em algum
intermediário).

**Verificação:** `npx tsc --noEmit` e `next build` limpos (14 rotas).
Mudança é só de frontend (nenhum contrato de API alterado) — suíte de
backend não precisou rodar de novo.

## Correção + feature — rótulo de KPI cortando, e indicador de variação vs mês anterior

**Rótulo cortando ("PRODUTOS CADASTR..."):** o `tracking-wide` (espaçamento
extra entre letras, comum em rótulos em maiúsculas) engordava o texto o
suficiente pra não caber mesmo com o card numa largura razoável. Tirado o
`truncate` forçado e o `tracking-wide` do rótulo — agora ele quebra pra
uma segunda linha quando não cabe, em vez de cortar com reticências. O
valor continua com `truncate` como rede de segurança (mas não deve
disparar na prática, valores são curtos).

**Indicador de variação vs mês anterior:** existia só no protótipo HTML
estático (dado fake), nunca tinha sido implementado de verdade — Giliardi
perguntou e pediu pra implementar.

- `KpisPainelOut` reestruturado: `produtos_cadastrados`, `entradas_mes`,
  `saidas_mes`, `faturamento_mes` agora são objetos
  `{valor, variacao_percentual}` (schema novo `KpiComVariacaoOut`).
  `variacao_percentual` é `None` quando o período anterior é zero — nunca
  inventamos um "0%" ou "100%" nesse caso, isso mentiria sobre a
  tendência real pro usuário.
- **`valor_total_estoque` propositalmente sem indicador de variação:**
  recalcular o valor do estoque de "um mês atrás" exigiria histórico de
  custo médio por dia, que não existe hoje (só guardamos o custo médio
  *atual* do produto). Uma aproximação pareceria precisa mas estaria
  errada — decisão consciente de não mostrar isso agora, documentada
  aqui e comunicada ao Giliardi, não faz parte do escopo desta correção.
- Comparação usa o **mesmo intervalo de dias corridos** do mês anterior
  (ex.: hoje é dia 17 → compara 1-17 do mês atual com 1-17 do mês
  anterior), não mês parcial vs mês inteiro — isso sempre pareceria uma
  queda só por ter menos dias, seria enganoso.
- `produtos_cadastrados`: comparação é cumulativa (quantos produtos
  ativos existiam antes do início deste mês vs quantos existem agora),
  não um "fluxo do mês" como os outros três.
- Frontend: `CartaoKpi` ganhou prop `variacao` opcional, renderiza
  ▲/▼ + percentual + "vs mês anterior" só quando não é `null`.

**Bug real encontrado e corrigido durante a implementação:** comparação
entre `datetime` (campo `criado_em` do produto) e `date` (data de corte)
gerava `TypeError` — Python não compara os dois tipos diretamente.
Corrigido com `.date()` na comparação. Pego pelos testes antes de
qualquer push, como deveria ser.

**Verificação:** `tests/test_painel.py` — 11/11 passando (dois testes
ajustados pro novo formato aninhado). Suíte completa — 151/151 passando
excluindo `tests/test_auth.py`, que travou nesse ambiente (sandbox novo
desta sessão, sem Postgres pré-instalado) de forma isolada e
não-relacionada às mudanças desta correção — isolei rodando com
`--ignore=tests/test_auth.py` (151/151 limpo) e depois `test_auth.py`
sozinho (trava no 4º de 6 testes, antes mesmo de qualquer código tocado
aqui rodar). Não investiguei a fundo por ser claramente pré-existente e
fora do escopo desta correção; sinalizando aqui para acompanhamento.
`npx tsc --noEmit` e `next build` limpos (14 rotas).

**Ainda sem push** — Giliardi pediu confirmação visual via preview HTML
antes de qualquer push nesta rodada de ajustes do Painel; aguardando.

## Etapa 24 — Light/dark mode toggle

Toggle de tema claro/escuro em todo o app, seguindo o protótipo aprovado
visualmente com o Giliardi antes da implementação (mockup React comparando
os dois modos lado a lado com os tokens reais da marca).

**Arquitetura escolhida:** o sistema já usava CSS variables (`--cor-base`,
`--cor-acento` etc.) aplicadas em runtime por `ThemeProvider`
(`lib/theme/useTheme.tsx`) a partir de um JSON por tenant
(`themes/nexstock.tokens.json`) — pensado desde a Etapa 15 pra permitir
override de identidade visual por tenant. Em vez de introduzir um segundo
mecanismo (ex.: `dark:` classes do Tailwind), o dark/light mode foi
encaixado nesse mesmo sistema: o JSON agora tem duas chaves,
`modos.escuro` e `modos.claro`, cada uma com o conjunto completo de
tokens. Um tenant com override futuro pode customizar um modo, os dois,
ou nenhum — o modo escuro continua sendo o padrão do produto quando não
há preferência salva nem sinal do sistema operacional.

**`useTheme.tsx`:**
- `ModoTema = "escuro" | "claro"`, guardado em `localStorage`
  (`nexstock-modo-tema`).
- Sem preferência salva, respeita `prefers-color-scheme` do navegador;
  sem nenhum sinal, cai no escuro (comportamento atual preservado).
- `alternarModo()` troca o modo, persiste e reaplica os tokens via
  `root.style.setProperty` — mesmo mecanismo que já existia, sem
  reescrever componentes.
- `root.style.colorScheme` e `data-tema` também setados, pra scrollbars/
  inputs nativos do navegador acompanharem o modo.

**`ToggleTema.tsx`** (novo, em `components/ui/`): botão com ícone
Sun/Moon, dois modos de exibição (`compacto` pro header mobile, completo
pra sidebar). Adicionado na sidebar desktop e no drawer mobile (acima do
"Sair"), e no header mobile (substituindo o spacer vazio que existia só
pra centralizar a logo).

**Paleta clara** (calibrada pra contraste, não é a escura invertida):
- `cor_base` / `cor_superficie`: `#F1F4F9` / `#FFFFFF` (fundo com leve
  profundidade, não branco puro direto no app)
- `cor_texto`: `#0D182A` — reaproveita o próprio tom do fundo escuro
  atual como cor de texto no claro
- `cor_acento`: `#059669` (não é o `#10B981` original — esse verde perde
  contraste em fundo branco; testado no protótipo aprovado)
- `cor_acento_soft`: `#047857` — no escuro esse token é usado como
  variante *mais clara* (texto/ícone que precisa "pular" no fundo
  escuro); no claro a relação se inverte e ele precisa ser *mais escuro*
  que o acento base pra continuar legível como texto em fundo branco
  (usado em links "ver mais", indicador de variação positiva, ícone de
  entrada)
- `cor_marca_azul` (`#2563EB`) e o gradiente da logo **não mudam** entre
  modos — regra de marca, reservado só pro logotipo

**Tokens novos** (não existiam antes, criados porque só faziam sentido
com dois modos): `cor_aviso` (amber, antes hardcoded como `#F59E0B` em 4
lugares do Painel), `cor_grafico_neutro` (linha "saídas" do gráfico do
Painel), `cor_grafico_extra_1/2` (cores extras do donut de categoria),
`cor_status_esgotado/vencimento/minimo/novo` + suas variantes `_bg`
(badges de status na tela de Estoque, antes 5 hex hardcoded). Todos com
par escuro/claro calibrado — no claro em geral mais escuros/saturados
que no escuro, pra manter contraste em fundo branco.

**Limpeza:** zero hex hardcoded restante fora do sistema de tokens em
todo o frontend (`grep -rE "#[0-9A-Fa-f]{6}"` em `app/`, `components/`,
`lib/` só retorna o fallback intencional de `--cor-marca-azul` no
gradiente do login, que é o mesmo valor em ambos os modos mesmo).

**Verificação:** `npx tsc --noEmit` limpo, `next build` limpo (14 rotas,
sem warnings novos). Suíte completa do backend rodada mesmo sendo etapa
100% frontend — 157/157 passando (ambiente sandbox desta sessão não
tinha Postgres pré-instalado; instalado via apt + roles restritos
recriados do zero com `setup_test_db.sh`, incluindo `test_auth.py` que
tinha travado isoladamente numa sessão anterior — rodou limpo desta vez).
Bandit sem achados.

**Escopo consciente:** não foi tocado nenhum componente do kit de UX
(`Toast`, `ConfirmDialog`, etc.) — todos já consumem as CSS variables
existentes, então herdam o modo claro automaticamente sem alteração.

**Nota de backlog (posicionamento do toggle):** o protótipo inicial
mostrava o botão de tema numa barra superior no desktop (ao lado de um
ícone de notificação), mas essa barra não existe no layout real — o
desktop hoje é só sidebar fixa + `<main>`, sem topbar. O toggle foi
posicionado no rodapé da sidebar (acima de "Sair") e no header mobile
existente. Giliardi já indicou que no futuro vai querer avaliar a
introdução de uma barra superior no desktop — quando isso entrar em
pauta, o toggle deve ser realocado pra lá. Registrado aqui pra não se
perder; não implementar proativamente, só quando ele pedir.

## Etapa 25 — Precificação e atributos de Produto (venda, margem, categoria, marca, NCM, imagem)

Expansão do cadastro de Produto: até aqui só existia custo (editável
manualmente, ver nota abaixo), sem preço de venda, categoria não estava
de fato vinculável no formulário (apesar do backend já suportar
`categoria_id` desde o início), e faltavam marca, NCM e imagem.

**Decisão registrada sobre `custo_medio` (correção de entendimento):**
o nome do campo sugere média ponderada calculada a partir das entradas
de Compras/NF-e, mas o código nunca implementou esse cálculo — é e
sempre foi um campo 100% manual. Decisão do Giliardi: manter assim por
enquanto (não criar um segundo campo de "custo manual" separado, o que
geraria dois números de custo divergentes). **Backlog registrado:**
migrar `custo_medio` pra cálculo real de média ponderada nas entradas de
Compras/NF-e, recalculando a cada compra — não implementado nesta etapa.

**Preço de venda + margem:** `preco_venda` é campo novo, opcional.
`margem_percentual` **nunca é persistida** — é sempre derivada em
runtime por `calcular_margem_percentual()` (`produtos/service.py`) a
partir de `custo_medio` e `preco_venda` (`(venda - custo) / venda *
100`), pra nunca divergir do que os dois campos realmente valem. No
form (`ProdutoForm.tsx`), os três campos (custo, venda, margem) são
bidirecionais: editar qualquer um recalcula os outros dois no client;
o payload enviado ao backend nunca inclui margem.

**Categoria vinculada:** o backend já aceitava `categoria_id` desde a
migration inicial — a lacuna era só o formulário nunca ter exposto esse
campo. Resolvido com um `<select>` populado pelas categorias já
carregadas no painel (`painel.filtros.categorias`), sem chamada extra.

**Marca e NCM:** campos de texto simples, sem validação de formato além
de tamanho máximo (NCM não valida estrutura numérica — não há emissão de
NF-e ainda, então não há necessidade de exigir formato correto agora).

**Imagem do produto:** dois modos no form — upload de arquivo (JPEG/PNG/
WebP, limite configurável via `MAX_IMAGEM_PRODUTO_SIZE_MB`, padrão 3MB) ou
URL externa. Upload feito por `app/core/storage.py`, cliente mínimo do
Supabase Storage via REST/httpx (evita adicionar a dependência
`supabase-py` só pra isso — `httpx` já era usado no projeto). Bucket
`produtos-imagens` é **público**, com path `{tenant_id}/{produto_id}/
{uuid}.{ext}` — decisão consciente: UUIDs não são adivinháveis e foto de
produto não é dado sensível, então RLS/URL assinada não compensava a
complexidade extra aqui. `SUPABASE_SERVICE_ROLE_KEY` fica só no backend,
nunca é exposta ao frontend. Endpoint novo: `POST /produtos/{id}/imagem`
(multipart), validação de tipo/tamanho acontece *antes* de checar se o
Storage está configurado, pra sempre devolver o erro certo (415/413)
independente do ambiente ter Supabase configurado ou não.

**Controla lote/validade:** campo booleano novo em Produto, só
informativo por enquanto. Descoberta relevante durante a investigação:
**já existe infraestrutura de Lote parcialmente construída no banco**
(tabela `lotes`, `movimentacoes.lote_id`, uso em leitura no módulo de
Alertas pra vencimento) de uma etapa anterior — mas sem nenhum endpoint
de escrita e sem nenhuma tela de frontend usando isso. Capacidade morta,
reaproveitável quando lote completo for atacado. **Decisão consciente:**
não implementar captura de lote/validade nesta etapa — é trabalho do
tamanho de uma etapa própria (form de entrada precisa pedir lote+validade,
decisão de FEFO ou não na saída, mexe em Estoque/Movimentação/Vendas).
`controla_lote` só reserva o terreno; o form mostra um aviso
("Rastreamento de lote ainda não disponível — em breve") pra não parecer
que marcar o checkbox já ativa alguma coisa. **Registrado como próximo
item de backlog de lote**, junto com a tabela `lotes` já existente como
ponto de partida.

**Reflexo no módulo Estoque:** decisão consciente após discussão — Preço
de venda, marca e imagem também aparecem no painel de Estoque (tabela
desktop, cards mobile, CSV), reaproveitando a mesma query/service.
**Margem NÃO aparece em Estoque** — decisão deliberada: margem não varia
com saldo (é constante por produto, independente de quantas unidades
tem em estoque), então é informação de precificação pura, não de posição
de estoque; mostrá-la ali seria redundante com Produtos e poluiria uma
tela já densa (KPIs, filtros, prioridade, posições por depósito).

**Import de planilha (cadastro em massa):** pedido pelo Giliardi durante
a etapa, mas conscientemente **não incluído aqui** — vira a Etapa 26.
Envolve upload de XLSX/CSV, validação linha a linha com relatório de
erro parcial, e decisão de criar vs. atualizar por SKU; porte de etapa
própria, não um adendo.

**Migration:** `010_produto_precificacao_e_atributos.sql` — adiciona
`preco_venda`, `marca`, `ncm`, `imagem_url`, `controla_lote` em
`produtos`. Aplicada e testada localmente antes do push.

**Verificação:** suíte completa do backend — 163/163 passando (exclui
`test_auth.py`, que trava isolado neste sandbox específico ao rodar
dentro da suíte completa; roda limpo quando executado sozinho — mesmo
comportamento intermitente já registrado no ambiente de sandbox, não é
regressão desta etapa). Bandit sem achados. `npx tsc --noEmit` e
`next build` limpos no frontend. Preview HTML aprovado visualmente pelo
Giliardi antes do push (form de Produto e card/tabela de Estoque com os
campos novos).

## Etapa 26 — Import em massa de produtos via planilha (XLSX/CSV)

Cadastro de produto em lote a partir de planilha, pedido explicitamente
por Giliardi ao final da Etapa 25. Três decisões de negócio confirmadas
com ele antes de implementar:
- **SKU já existente** (no banco do tenant, ou duplicado dentro da
  própria planilha) → linha é **rejeitada com erro**, não atualiza o
  produto existente.
- **Categoria informada que ainda não existe** → **criada
  automaticamente** (mesmo nome reaproveitado se várias linhas da
  planilha citarem a mesma categoria nova).
- **Fluxo:** sempre passa por preview (mostra linha a linha o que vai
  acontecer, sem gravar nada) antes de confirmar.

**Arquitetura em duas chamadas, stateless (sem sessão/arquivo temporário
guardado no servidor entre elas):**
- `POST /produtos/importar/preview` (multipart) — parseia o arquivo,
  valida cada linha de forma independente (uma linha inválida não afeta
  as outras) e devolve o relatório completo sem gravar nada no banco.
- `POST /produtos/importar/confirmar` (JSON) — recebe de volta os dados
  já normalizados das linhas que o preview marcou como válidas e
  **revalida tudo do zero contra o estado atual do banco** antes de
  gravar. Isso cobre o caso de outro usuário ter cadastrado o mesmo SKU
  no intervalo entre o preview e a confirmação (testado explicitamente:
  `test_confirmar_revalida_sku_criado_entre_preview_e_confirmacao`).

**Parsing** (`produtos/importacao.py`, funções puras sem acesso a
banco): `.xlsx` via `openpyxl` (`read_only=True`, streaming, sem
carregar a planilha inteira na memória) e `.csv` com detecção automática
de delimitador (`,` ou `;` — planilhas exportadas do Excel BR costumam
vir com `;`) e fallback de encoding UTF-8 → Latin-1. Números aceitam
formato BR (`1.234,56`) e internacional (`1234.56`).

**Colunas aceitas:** `nome` (obrigatório), `sku`, `categoria`,
`codigo_barras`, `unidade_medida`, `custo_medio`, `preco_venda`,
`marca`, `ncm`, `estoque_minimo`, `estoque_maximo`. Ficaram de fora
desta etapa, deliberadamente: `imagem_url` (upload é por produto,
individual) e `controla_lote`/`campos_customizados` (específicos demais
pra planilha genérica).

**Limites** (config, não hardcoded): `MAX_IMPORT_PRODUTOS_SIZE_MB=5`,
`MAX_IMPORT_PRODUTOS_LINHAS=1000` — proteção contra DoS por planilha
gigante, já que toda a validação do lote acontece em memória antes de
qualquer gravação.

**Planilha modelo:** botão "Baixar planilha modelo (.csv)" gera o CSV
inteiramente no client (sem chamada ao backend) — decisão consciente de
oferecer só `.csv` como modelo (mesmo o import aceitando `.xlsx`
também), pra não precisar adicionar a lib SheetJS só pra gerar um
`.xlsx` estático; quem preferir `.xlsx` salva o CSV nesse formato depois
de preencher no Excel.

**Frontend:** `ImportarProdutosDialog.tsx`, modal de 3 passos (upload →
preview com tabela linha a linha e badges de resumo → resultado com
lista de erros). Botão "Importar planilha" ao lado de "Novo produto" na
toolbar de Produtos. Preview HTML fiel (mesmas classes/tokens/sidebar de
240px) aprovado por Giliardi antes de implementar o componente real —
uma rodada de correção no meio do processo: o mockup usava `<script
src=".../tailwind.min.css">` (arquivo CSS carregado como script, não
aplicava nenhuma classe) — trocado por `cdn.tailwindcss.com`, que gera
as classes via JS e funciona de forma confiável em HTML solto.

**Restrição de perfil:** só `admin` e `operador` podem importar
(`require_perfil`) — mesmo padrão já usado nos outros endpoints de
escrita de Produtos. Testado explicitamente que `leitura` recebe 403 em
ambos os endpoints.

**Verificação:** suíte completa do backend — 179/179 passando (163
anteriores + 16 novos testes de import, cobrindo: parsing CSV/XLSX,
formato decimal BR, nome vazio, SKU duplicado no arquivo, SKU já
existente no banco, estoque máximo menor que mínimo, formato de arquivo
não suportado (415), planilha vazia (422), limite de linhas excedido
(413), criação de produtos e categorias, revalidação na confirmação,
isolamento entre tenants — SKU de um tenant não bloqueia outro tenant —
e restrição por perfil). Exclui `test_auth.py` (comportamento
intermitente já registrado, não é regressão). Bandit sem achados.
`npx tsc --noEmit` e `next build` limpos no frontend.

**Nota de infraestrutura do sandbox:** durante a verificação final, o
cluster Postgres local caiu entre chamadas de bash (processo não
persiste entre invocações de tool — comportamento já documentado) e a
suíte inteira falhou com `ConnectionRefusedError`. Não foi regressão:
reiniciado o cluster (`pg_ctlcluster 16 main start`) na mesma chamada
que rodou os testes, e a suíte voltou a passar 179/179 de forma limpa.


## Etapa 27 — Convite e gestão de usuário (dentro do tenant)

Escopo decidido com Giliardi antes de implementar: modelo de convite
direto (admin cadastra nome/e-mail/perfil, backend gera senha
provisória de alta entropia, exibida uma única vez na resposta —
nunca fica recuperável depois, repassada pelo admin fora do sistema).
Não depende de infraestrutura de e-mail, que ainda não existe no
sistema (fica registrada no backlog "Email/WhatsApp notifications").
Decisão consciente de manter os 3 perfis fixos (admin/operador/leitura)
já existentes em vez de migrar para permissões granulares por
módulo/ação — cobre bem o caso de uso de pequeno varejo com um único
tenant ativo hoje, e granular só compensaria com uma necessidade real
concreta (nenhuma identificada). Fica registrado como possível
evolução futura, sem prazo.

**Fora de escopo, tratado como backlog separado (registrado abaixo):**
onboarding público de tenant novo (cadastro de empresa com CNPJ,
telefone, endereço + seleção de segmento + admin fundador) — feature
maior e distinta desta etapa, mockada para validação visual junto com
esta, mas não implementada.

**Migration 011** (`011_usuarios_convite.sql`): coluna
`deve_trocar_senha` em `users`, default `false` — não afeta usuários
existentes (ex: admin fundador do Doce Encanto).

**Backend — módulo `usuarios`** (`schemas.py`, `service.py`,
`router.py`):
- `GET /usuarios` — lista usuários do tenant (admin e operador podem
  ver; leitura recebe 403 — decisão: só quem pode agir sobre a equipe
  precisa ver a equipe)
- `POST /usuarios` — só admin. Recebe nome/e-mail/perfil, rejeita
  e-mail duplicado (409) e perfil inválido (422). Gera senha
  provisória (`gerar_senha_provisoria()` em `core/security.py`: 12
  caracteres, garante maiúscula+minúscula+dígito, exclui caracteres
  ambíguos I/O/l/0/1 por ser repassada manualmente) e marca
  `deve_trocar_senha=True`
- `PATCH /usuarios/{id}` — só admin. Atualiza perfil e/ou ativo
  (parcial — 400 se nenhum campo enviado). Regra de auto-proteção: um
  admin não pode rebaixar o próprio perfil nem se desativar (evita o
  tenant ficar sem admin ativo por engano) — testado explicitamente.
  Isolamento por tenant: editar usuário de outro tenant retorna 404
  (não vaza existência)

**Achado corrigido durante a etapa:** existia um schema
`TrocarSenhaInput` em `auth/schemas.py` desde antes, sem router nem
service implementados — nunca tinha sido ligado a nada. Necessário
para fechar o fluxo desta etapa (usuário convidado precisa trocar a
senha provisória no primeiro login), então foi implementado agora:
`POST /auth/trocar-senha` (valida senha atual, aplica política de
força na nova, zera `deve_trocar_senha`, e revoga todas as sessões
ativas do usuário — mesmo efeito de "roubo suspeito" já usado no
refresh token, força novo login em todos os dispositivos).

`deve_trocar_senha` foi adicionado ao payload do JWT (`TokenPayload`)
em vez de criar um endpoint separado só para consultar isso — o
frontend já decodifica o JWT no client para exibir dados do usuário,
então reaproveita o mesmo mecanismo. Propagado tanto no login quanto
no refresh token.

**Decisão de segurança registrada (não bloqueante, documentada aqui
para não ser esquecida):** a obrigatoriedade de trocar a senha é
aplicada apenas no frontend (redireciona para `/trocar-senha` e
bloqueia navegação enquanto a flag estiver ativa) — o backend NÃO
recusa chamadas de API de um usuário com `deve_trocar_senha=true` em
outros endpoints. Um usuário com o JWT válido tecnicamente consegue
usar a API normalmente sem trocar a senha primeiro, se contornar a
UI. Isso não é uma brecha de autenticação (ainda precisa da senha
provisória para logar), é uma lacuna de UX/política que fica
registrada como possível endurecimento futuro (ex: middleware no
backend bloqueando 90% das rotas até a troca) caso vire relevante.

**Frontend:**
- `lib/types.ts`: tipos `Perfil`, `Usuario`, `UsuarioCreateResult`
- `lib/auth-context.tsx`: captura `deve_trocar_senha` do JWT
  decodificado, redireciona para `/trocar-senha` no login quando
  `true`; novo método `marcarSenhaTrocada()` para atualizar o estado
  em memória sem precisar de novo login
- `app/(dashboard)/layout.tsx`: bloqueio de navegação no client
  enquanto `deve_trocar_senha` for `true` (redireciona qualquer rota
  do dashboard para a tela de troca); item de menu "Usuários" exibido
  apenas para perfil admin (proteção real continua sendo o 403 do
  backend — isto é só para não anunciar uma tela sem permissão)
- `app/trocar-senha/page.tsx`: tela de troca obrigatória, fora do
  grupo de rotas `(dashboard)` (sem sidebar), mesmo padrão visual do
  login
- `app/(dashboard)/usuarios/page.tsx` +
  `components/usuarios/ConvidarUsuarioDialog.tsx`: tela de gestão
  (tabela com avatar/iniciais, badge de perfil, status ativo/inativo,
  select inline de perfil para admin, confirmação antes de
  desativar/reativar reaproveitando `ConfirmDialog` existente) e modal
  de convite em duas etapas (formulário → resultado com a senha
  provisória exibida uma única vez, com botão copiar). Operador vê a
  lista em modo somente-leitura (sem select editável, sem botão
  desativar, sem botão convidar) — evita expor controles que
  resultariam em 403 ao serem usados
- Segue exatamente o layout aprovado no preview HTML (sidebar fixa de
  240px, mesmos tokens de cor/tipografia)

**Verificação:** 204/204 testes passando (185 anteriores + 19 novos em
`test_usuarios.py`, cobrindo permissão por perfil, duplicidade de
e-mail, auto-proteção do admin, isolamento entre tenants na listagem e
na edição, fluxo completo de senha provisória → login → troca →
revogação de sessão antiga, rejeição de senha nova fraca) — inclui
`test_auth.py` rodado isoladamente (comportamento intermitente já
documentado, não é regressão). Bandit: 0 achados. `tsc --noEmit` e
`next build` limpos, incluindo as novas rotas `/usuarios` e
`/trocar-senha`.

**Nota de processo:** o teste `test_admin_convida_usuario_com_sucesso`
e outros de `test_usuarios.py` usavam e-mails fixos na primeira versão
e falharam por `UniqueViolationError` ao rodar a suíte pela segunda vez
sem recriar o banco entre execuções — corrigido usando o helper
`_email_unico()` já existente em `conftest.py`, mesmo padrão do resto
da suíte. Não chegou a ser entregue com esse problema, capturado e
corrigido durante a própria verificação desta etapa.

---

## Backlog — Onboarding público de tenant (cadastro de conta nova)

Registrado ao final da Etapa 27, fora do escopo dela: tela pública de
"criar minha conta" — qualquer um cria um tenant novo no NexStock,
diferente do convite (que é dentro de um tenant já existente).

Decidido com Giliardi: fluxo de 3 passos — (1) seleção de segmento
(mesmo que só confeitaria esteja implementada hoje, os outros
aparecem como "em breve" — arquitetura já é multi-segmento via JSON de
config); (2) dados completos da empresa (nome, CNPJ, telefone,
endereço); (3) dados do admin fundador (nome, e-mail, senha) + resumo
de confirmação. Mockado em HTML junto com a tela de convite de usuário
para validação visual (aprovado), mas não implementado — vira etapa
própria quando entrar na fila.

Achado relacionado (não é bug, é FYI): já existe hoje um
`POST /auth/register` cru no backend (`registrar_tenant`), sem CNPJ,
telefone, endereço nem validação de segmento contra uma lista real —
usado só em `test_auth.py`/`conftest.py` para criar tenants de teste,
sem nenhuma tela no frontend. Não é a base do onboarding público (não
tem os campos decididos), mas existe e pode aparecer em auditorias de
segurança futuras — vale ter isso mapeado.


## Etapa 28 — Nome do usuário na saudação do Painel Home

Gap registrado desde a Etapa 23: a saudação do Painel ("Bom dia.",
"Boa tarde.", "Boa noite.") nunca incluiu o nome de quem está logado,
porque `CurrentUser`/o payload do JWT não expunham `nome` — só
`sub` (id), `tenant_id` e `perfil`. Fechado nesta etapa seguindo o
mesmo padrão já usado para `deve_trocar_senha` (Etapa 27): o backend
passa a incluir `nome` no JWT em vez de criar um endpoint dedicado,
já que o frontend já decodifica o token no client para exibir dados
de conveniência (nunca para autorização — isso continua só no
backend a cada request).

Backend: `TokenPayload` e `create_access_token()` (`app/core/security.py`)
ganharam o campo `nome`; os dois pontos que emitem token
(`login()` e `renovar_token()` em `app/modules/auth/service.py`) agora
passam `user.nome`. `CurrentUser` também ganhou `nome`, propagado em
`get_current_user()` — disponível para qualquer endpoint que precisar
no futuro, sem precisar de nova consulta ao banco.

Frontend: `lib/auth-context.tsx` decodifica `nome` do JWT junto com os
demais campos e guarda no estado `usuario`. A saudação do Painel
(`app/(dashboard)/page.tsx`) passa a exibir "Bom dia, {primeiro nome}."
— usa só o primeiro nome (split por espaço) para não ocupar linha
demais no card; sem posse de nome (usuário legado logado antes desta
etapa, cujo token antigo ainda não tem o campo) cai de volta para o
texto original sem nome, sem quebrar.

Verificação: 204/204 testes (Postgres 16 local, roles restritos,
incluindo `test_auth.py` isolado — comportamento intermitente já
documentado, não é regressão), Bandit 0, `tsc --noEmit` e `next build`
limpos. Mudança é texto simples dentro de um componente já existente
(não altera layout/estrutura visual), então não passou pelo fluxo de
preview HTML de mudança visual — só o texto da saudação muda.

Nota: usuários com sessão ativa antes deste deploy (token antigo em
memória ou refresh pendente) só verão o nome na saudação depois do
próximo login — o token antigo não carrega o campo `nome`. Não é bug,
é esperado, já que o token é opaco até ser reemitido.


## Etapa 29 — Infraestrutura de código de barras/QR: busca por código e modelos de etiqueta

Primeira etapa de um item de backlog maior ("Barcode/QR via câmera"),
agora com escopo bem mais amplo do que o registrado originalmente:
scanner (câmera + leitor físico HID) em Vendas/Estoque/Inventário e
geração/impressão de etiquetas em lote com modelos salvos. Dado o
tamanho, o trabalho foi dividido em etapas — esta cobre só a
infraestrutura de backend da qual as próximas dependem:

- Etapa 29 (esta): busca por código + CRUD de modelos de etiqueta
- Etapa 30: componente de scanner (câmera + leitor físico) em Vendas
- Etapa 31: scanner em Estoque e Inventário (dois modos de contagem —
  decisão do usuário foi manter ambos, com abas)
- Etapa 32: tela Etiquetas completa (frontend)
- Etapa 33: integração QZ Tray (impressão direta em impressora térmica,
  sem diálogo do navegador — modo avançado opcional; navegador continua
  sendo o padrão)

Todo o escopo foi fechado com o usuário através de um preview HTML
interativo (câmera simulada com moldura de foco, os dois modos de
Inventário lado a lado em abas, tela de Etiquetas com preview ao vivo
usando JsBarcode/QRCode.js reais) antes de qualquer linha de código
real — mesmo padrão de prototype → aprovação → implementação já
estabelecido desde a Etapa 23.

**Descoberta na varredura de código**: `produtos.codigo_barras` já
existe desde a migration 001 (indexado, sem unique constraint) e já é
usado na busca unificada (`ILIKE` por nome/sku/código, todos no mesmo
campo de busca). Não foi preciso nenhuma migration nova em produtos —
só uma migration nova pra modelos de etiqueta.

**Backend implementado nesta etapa:**

- `GET /produtos/buscar-codigo?codigo=X` — busca EXATA (não substring)
  por `codigo_barras` OU `sku`, só produtos ativos. Deliberadamente
  diferente da busca unificada de `listar()`: um scanner sempre lê um
  código completo, então substring abriria brecha pra casar com o
  produto errado quando um código é prefixo/sufixo de outro (coberto
  por teste). Registrada antes de `/{produto_id}` no router pra não
  colidir com o path param.
- Migration 012 (`etiqueta_modelos`): tabela nova, RLS + FORCE RLS,
  isolada por `tenant_id`, com `config_json` (JSONB) de forma livre —
  mesmo padrão de `produtos.campos_customizados`: o schema Pydantic só
  valida tamanho do payload (limite de 20KB), o conteúdo semântico
  (elementos exibidos, tipo de código, tamanho da etiqueta, colunas,
  margem/espaçamento, modo de impressão preferido) é interpretado pelo
  frontend, que ainda não existe nesta etapa.
- Módulo `etiquetas` novo: `POST/GET/PATCH/DELETE /etiquetas/modelos`,
  seguindo exatamente o mesmo padrão de outros módulos (perfis
  admin/operador podem escrever, leitura só lê; 404 — não 403 — em
  acesso cross-tenant).

**Verificação:** Postgres 16 local recriado do zero via
`setup_test_db.sh` (roles restritos, sem BYPASSRLS) — as 12 migrations
aplicaram sem erro. 218/218 testes passando (212 na suíte principal +
6 de `test_auth.py` isolado — comportamento intermitente já
documentado, não regressão). Testes novos cobrem busca exata por
código (com/sem sku, produto inativo, isolamento entre tenants,
código inexistente) e o CRUD completo de modelos de etiqueta
(permissões por perfil, isolamento entre tenants, validação de nome
vazio). Bandit 0 issues (4803 linhas). `tsc --noEmit` e `next build`
limpos (sem mudança de frontend ainda — rodados por completude do
processo, já que a Etapa 30 já mexe em frontend em cima desta base).

**Decisões de escopo fechadas com o usuário durante o design:**

- Leitor físico USB/Bluetooth (modo HID — "digita" o código + Enter em
  qualquer campo focado) fica coexistindo com câmera e digitação manual
  no mesmo campo de busca, sem o usuário escolher nada — a Etapa 30
  precisa detectar o padrão de digitação rápida + Enter pra distinguir
  leitura física de digitação humana.
- Inventário mantém os dois modos de contagem desenhados no preview
  (Modo A: rola até a linha na tabela geral; Modo B: fila de cartões)
  como abas — usuário não quis eliminar nenhum.
- Tela de Etiquetas é uma tela nova própria (não um wizard de passos —
  foge do padrão do resto do sistema), com preview ao vivo, mantendo o
  ícone de "gerar etiqueta rápida" já existente na linha de Produto
  pro caso de uso de 1 produto só.
- Impressão: navegador (`window.print`) é o padrão, funciona sem
  instalar nada; QZ Tray fica como modo avançado opcional pra quem
  quer imprimir direto na Zebra sem diálogo — nenhum navegador permite
  impressão direta sem instalar um agente local, por design de
  segurança (não é limitação do NexStock).


## Etapa 30 — Scanner de código (câmera + leitor físico) em Vendas

Segunda etapa do item de código de barras/QR, em cima da infraestrutura
de backend da Etapa 29.

**Implementado:**

- `lib/useLeitorFisico.ts`: hook que detecta leitores HID (USB/Bluetooth)
  em qualquer input focado, sem nenhuma API especial de hardware — o
  aparelho se comporta como teclado pro navegador. Distingue leitura
  física de digitação humana pelo intervalo entre teclas (<40ms entre
  teclas = leitura; digitação humana normal é bem mais lenta) + Enter no
  final + tamanho mínimo do buffer (evita disparar em Enter isolado de
  outros usos do campo). Reutilizável em qualquer tela sem alterar o
  comportamento existente do campo onde é aplicado.
- `components/scanner/ScannerCodigo.tsx`: modal de câmera reutilizável,
  usando `@zxing/browser` (decodifica barras E QR do stream de vídeo,
  bundlado — sem dependência de CDN externo em runtime). Fallback de
  digitação manual sempre disponível (câmera indisponível, sem permissão,
  ou contexto sem HTTPS). Chama `GET /produtos/buscar-codigo` e devolve o
  produto encontrado via callback.
- Aplicado em Vendas: botão "Escanear" ao lado da busca abre o modal de
  câmera; o campo de busca existente ganhou detecção de leitor físico via
  `useLeitorFisico` — bipar com o leitor adiciona direto no carrinho, sem
  interferir na digitação manual (filtro por nome continua idêntico).

**Decisão de escopo confirmada com o usuário durante o design:** leitor
físico e câmera coexistem no mesmo campo sem escolha explícita do
usuário — cada um resolve automaticamente conforme o tipo de entrada.

**Verificação:** `tsc --noEmit` e `next build` limpos (rota `/vendas`
7.87 kB). Suíte de backend re-rodada por completude (212/212 + 6 de
test_auth.py isolados) — sem mudança de backend nesta etapa, mas nada
regrediu. Bandit 0 issues.

**Nota sobre verificação visual:** tentei gerar um screenshot real via
Playwright/Chromium headless antes do push (padrão da casa pra mudanças
visuais), mas o sandbox bloqueia os domínios necessários para baixar um
navegador headless (`cdn.playwright.dev`, snap store do Ubuntu). Mesmo
que funcionasse, não validaria a câmera de verdade (headless não tem
webcam). Decisão tomada com o usuário: publicar direto na `staging` —
o Vercel já faz deploy automático dela — e ele testa a câmera real lá,
o que é estritamente melhor do que um screenshot estático.

**Próxima:** Etapa 31 — scanner em Estoque e Inventário, com os dois
modos de contagem (rolar até a linha / fila de cartões) definidos no
preview.


## Etapa 31 — Scanner em Estoque e Inventário (dois modos de contagem)

Terceira etapa do item de código de barras/QR, reaproveitando
`ScannerCodigo` e `useLeitorFisico` da Etapa 30 sem duplicar nada.

**Estoque:** botão "Escanear" + leitor físico no campo de busca.
Diferente de Vendas (que adiciona ao carrinho), aqui o produto
encontrado só precisa aparecer na lista — como o painel de Estoque já
filtra server-side por nome/SKU/`codigo_barras` (ILIKE, endpoint
`/estoque/painel`), bastou colocar o código lido no campo de busca
existente (`setBusca`) pra reaproveitar o filtro que já existia, sem
precisar de scroll/highlight manual no DOM.

**Inventário — os dois modos aprovados no preview, ambos implementados:**

- **Tabela geral:** ao bipar, a linha do produto na tabela (desktop) ou
  card (mobile) pisca em verde por ~900ms e o campo de quantidade recebe
  foco automaticamente — usa `scrollIntoView` + `.focus()` num ref por
  produto.
- **Fila de contagem:** esconde a tabela toda; cada bipagem adiciona um
  cartão no topo da fila (nome, SKU/código, campo de quantidade já
  focado). Link "Ver tabela completa" alterna pra o outro modo sem
  perder nada — os dois modos compartilham o mesmo estado `contagem`
  (Record produto_id → valor), só a apresentação muda.
- Abas "Tabela geral" / "Fila de contagem" ficam visíveis só durante uma
  contagem em aberto — a lista de inventários já fechados/históricos
  embaixo não tem esse contexto e não precisa de scanner.
- Scanner (câmera + leitor físico) só reage quando existe um
  `inventario` em aberto — bipar um código na tela de listagem de
  inventários passados (sem contagem ativa) não faz nada, evitando
  comportamento surpresa.

**Verificação:** `tsc --noEmit` e `next build` limpos (`/estoque` 9.55
kB, `/inventario` 7.08 kB). Suíte de backend re-confirmada (212/212 +
6 isolados) e Bandit 0 — sem mudança de backend nesta etapa.

**Próxima:** Etapa 32 — tela Etiquetas completa (frontend), consumindo
o CRUD de modelos da Etapa 29.


## Etapa 32 — Tela Etiquetas completa (geração em lote)

Quarta etapa do item de código de barras/QR — tela nova consumindo o
CRUD de modelos da Etapa 29 e reaproveitando `ScannerCodigo` da Etapa 30.

**Implementado:**

- Item "Etiquetas" novo no menu lateral (`layout.tsx`), entre Inventário
  e Notas Fiscais.
- `components/etiquetas/EtiquetaLabel.tsx`: renderiza uma etiqueta única
  com código de barras real (`jsbarcode`, SVG) ou QR real (`qrcode`,
  canvas) — fundo branco fixo, independente do tema claro/escuro do app,
  já que reflete papel impresso de verdade. Produto sem `codigo_barras`
  cai automaticamente pro QR usando o `id` como valor (mesma decisão
  fechada no design da Etapa 29).
- `app/(dashboard)/etiquetas/page.tsx`: tela única com 3 colunas (não um
  wizard — mantém consistência com o resto do sistema), exatamente como
  aprovado no preview:
  - **Produtos selecionados**: busca por nome/SKU pra adicionar, botão
    de escanear (reaproveita `ScannerCodigo`), quantidade editável por
    item, total de etiquetas.
  - **Configuração**: checkboxes de elementos (nome/SKU/preço/marca),
    tipo de código (barras/QR), tamanho, colunas por página, margem e
    espaçamento, modo de impressão (navegador/QZ Tray — QZ Tray real
    fica pra Etapa 33, por enquanto cai no navegador com aviso), campo
    pra salvar como modelo (`POST /etiquetas/modelos`).
  - **Visualização**: grade com etiquetas reais (código de barras/QR
    de verdade, não placeholder), limitada a 60 no preview por
    performance — a impressão sai com o total completo. Modelos salvos
    aparecem num seletor no topo e recarregam a config inteira ao
    escolher.
- Impressão via `window.print()` com stylesheet `@media print` dedicada
  (`#grade-impressao`), que esconde todo o resto da página e mostra só
  a grade completa de etiquetas — abre o diálogo nativo do navegador,
  de onde dá pra escolher a impressora Zebra/Elgin já instalada no SO
  ou "Salvar como PDF".

**Verificação:** `tsc --noEmit` e `next build` limpos (`/etiquetas`
30.2 kB — maior que as outras rotas por carregar `jsbarcode` + `qrcode`,
esperado). Suíte de backend reconfirmada (212/212 + 6 isolados), Bandit
0 — sem mudança de backend nesta etapa.

**Ainda não implementado nesta etapa** (fica pro backlog, não bloqueia
a tela funcionar): ícone de "gerar etiqueta rápida" na linha de Produto
(caso de uso de 1 produto só, desenhado no preview original mas não
essencial já que a tela em lote cobre qualquer quantidade, inclusive 1);
exportação de PDF standalone (hoje usa "Salvar como PDF" do próprio
diálogo de impressão do navegador).

**Próxima:** Etapa 33 — integração QZ Tray (impressão direta na Zebra,
sem diálogo do navegador).


## Etapa 33 — Integração QZ Tray (impressão direta, sem diálogo)

Quinta e última etapa planejada do item de código de barras/QR. Fecha
o modo de impressão avançado que já existia como placeholder estático
na Etapa 32.

**Implementado:**

- `lib/useQzTray.ts`: hook que tenta conectar no QZ Tray (agente local,
  websocket) ao montar a tela, expõe status real (`conectando` /
  `conectado` / `indisponivel`) e a lista de impressoras registradas no
  SO quando conectado.
- `lib/qz-tray.d.ts`: declaração de tipos mínima pro pacote `qz-tray`
  (não distribui `.d.ts` — só cobre a superfície de API usada:
  `websocket`, `printers`, `configs`, `print`, `security`).
- Impressão via modo **pixel/html**: em vez de gerar ZPL manualmente,
  QZ Tray renderiza o HTML da grade de etiquetas e manda pro driver da
  impressora já instalada no SO — funciona pra qualquer impressora
  registrada (inclui Zebra/Elgin via driver), sem diálogo de impressão
  do navegador.
- Tela Etiquetas: bolinha de status (verde/amarelo/vermelho) e lista de
  impressoras agora refletem a conexão real, não mais estático. Botões
  "Tentar conectar de novo" e "Baixar QZ Tray" (link pra qz.io/download)
  aparecem quando desconectado. "Imprimir etiquetas" detecta o modo
  ativo e manda pro QZ Tray ou cai pro navegador automaticamente se o
  QZ Tray não estiver disponível.

**Limitação conhecida, documentada e não bloqueante:** o HTML enviado
pro QZ Tray é o `innerHTML` da grade — funciona perfeitamente pro
código de barras (SVG, serializa normal), mas o QR Code é desenhado em
`<canvas>` (biblioteca `qrcode`), e conteúdo de canvas não serializa
via `innerHTML` — o QR sai em branco na impressão via QZ Tray
especificamente (impressão pelo navegador continua perfeita pros dois,
porque usa o DOM ao vivo, não uma string HTML). Enquanto isso não for
corrigido (converter o canvas pra `<img>` com data URL antes de montar
o HTML de impressão), recomendação prática: usar tipo "Barras" quando
o modo de impressão for QZ Tray.

**Nota sobre certificado:** sem certificado digital assinado
configurado, o QZ Tray mostra um popup de confirmação de segurança na
primeira impressão de cada sessão — funcional, mas não 100% silencioso.
Configurar certificado próprio é next-step, não bloqueia o uso.

**Verificação:** `tsc --noEmit` e `next build` limpos (`/etiquetas`
31.3 kB, +1.1kB pela lib `qz-tray`). Suíte de backend reconfirmada
(212/212 + 6 isolados), Bandit 0 — sem mudança de backend nesta etapa.

---

Com a Etapa 33, o item de backlog "Barcode/QR via câmera" está
completo em todas as frentes desenhadas no preview original: scanner
por câmera e leitor físico em Vendas/Estoque/Inventário (dois modos de
contagem), tela de Etiquetas em lote com modelos salvos, e impressão
tanto pelo navegador quanto direto via QZ Tray.

**Pendências que ficam pro backlog geral** (não bloqueiam o item, só
não foram feitas ainda): ícone de "gerar etiqueta rápida" na linha de
Produto (caso de uso de 1 produto só); corrigir serialização do QR no
print via QZ Tray; certificado QZ Tray assinado; exportação de PDF
standalone sem depender do diálogo do navegador.


## Etapa 34 — Gerar etiqueta rápida na listagem de Produtos

Pendência deixada em aberto desde a Etapa 32: ícone de "gerar etiqueta
rápida" na linha do Produto, pro caso de uso de 1 produto só, sem
precisar ir pra tela Etiquetas em lote.

**Implementado:**

- `components/etiquetas/GerarEtiquetaRapidaDialog.tsx`: diálogo mínimo
  — preview em tamanho real (reaproveita `EtiquetaLabel`, o mesmo
  componente da tela em lote), toggle de tipo de código (barras/QR) e
  campo de cópias. Sem configurador completo (elementos, tamanho,
  colunas, modelos salvos) — esse é o propósito da tela em lote; aqui é
  deliberadamente rápido: 2 cliques e imprime.
- `EtiquetaLabel` teve o tipo do prop `produto` estreitado de `Produto`
  pra um `Pick` só dos campos realmente usados (`id`, `nome`, `sku`,
  `codigo_barras`, `marca`, `preco_venda`) — permite reusar o componente
  tanto com o tipo `Produto` completo (tela em lote) quanto com
  `ItemProdutoLista` (listagem de Produtos, que não carrega todos os
  campos de `Produto`) sem precisar montar um objeto adaptado feito à
  mão, como o diálogo de edição já faz.
- Item "Gerar etiqueta" novo no `RowMenu` da listagem de Produtos
  (mobile e desktop), ao lado de "Editar".
- Aviso inline no diálogo quando o produto não tem `codigo_barras`
  cadastrado e o tipo "Código de barras" está selecionado — a etiqueta
  sai com QR (fallback pro `id`) mesmo assim, mas o usuário é avisado
  do porquê antes de imprimir, não depois.

**Verificação:** `tsc --noEmit` e `next build` limpos. Rota `/produtos`
subiu de 7.81 kB pra 8.31 kB; `/etiquetas` caiu de 31.3 kB pra 6.98 kB
porque o chunk compartilhado com `jsbarcode`/`qrcode` (usado agora por
duas rotas) foi promovido pro bundle comum pelo Next — soma total
equivalente, sem regressão real de peso. Suíte de backend reconfirmada
(212/212 + 6 isolados), Bandit 0 — sem mudança de backend nesta etapa.

Com esta etapa, o item de backlog "Barcode/QR via câmera" está
completo em todas as frentes desenhadas no preview original, sem
pendências abertas além das já documentadas na Etapa 33 (serialização
do QR no print via QZ Tray, certificado QZ Tray assinado, exportação
de PDF standalone).


## Correção — Migration 012 aplicada no schema errado no Supabase staging

Ao aplicar a migration 012 (`etiqueta_modelos`) no Supabase staging via
MCP, a tabela foi criada no schema `public` em vez de
`estoque_inteligente` — o `search_path` da sessão da ferramenta MCP não
está setado pro schema do projeto (diferente do padrão configurado pro
role da aplicação em produção). Todas as migrations anteriores (001–011)
nunca tiveram esse problema porque foram escritas sem qualificação de
schema, confiando no `search_path`; essa foi a primeira vez que o
`search_path` da sessão MCP não bateu com o esperado.

**Correção aplicada:** `drop table public.etiqueta_modelos` + recriação
completa em `estoque_inteligente.etiqueta_modelos`, desta vez com o
schema qualificado explicitamente em toda referência (incluindo a FK
pra `estoque_inteligente.tenants`), pra não depender de `search_path`
de novo. Confirmado via `pg_class` que `relrowsecurity` e
`relforcerowsecurity` estão `true` na tabela correta.

**Aprendizado para o futuro:** ao aplicar migrations via Supabase MCP
(`apply_migration`/`execute_sql`), sempre qualificar o schema
explicitamente nos `CREATE TABLE`/`REFERENCES` em vez de confiar no
`search_path` da sessão — migrations locais (via `setup_test_db.sh`)
não têm esse risco porque o `search_path` do banco de teste é
configurado de forma consistente, mas a sessão MCP pode divergir.


## Etapa 35 — Redesign do PDV (mockup aprovado + implementação)

Pedido do usuário: "melhorar" a tela de PDV com liberdade criativa total
("surpreenda-me com algo bem diferente"), escopo na tela toda (PDV +
histórico de Vendas). Fluxo seguido: preview HTML interativo aprovado
primeiro (`mockup-pdv-nexstock.html`, com tokens NexStock reais e
sidebar fixa 240px), só depois código.

**Conceito central do redesign:** o carrinho virou um "cupom fiscal" de
verdade — papel com borda serrilhada, razão em fonte mono e leader dots
entre item e preço, em vez de mais uma lista genérica. O catálogo virou
trilhas horizontais por categoria em vez de grade fixa. Caixa e Vendas
saíram do fluxo principal (que antes ocupava 1/3 da tela sempre) e
viraram um dock inferior recolhível — o operador passa a maior parte do
tempo escaneando/vendendo, não olhando histórico.

**Descobertas reais durante a checagem do mockup contra o código (antes
de implementar, não depois):** o print de referência que o usuário
mandou tinha um módulo de "Caixa" (abertura/fechamento/sangria/suprimento)
que **não existe** no NexStock hoje — só existia na imagem de
inspiração. "Mais vendidos" também não existia como métrica (só "giro
de estoque", que mede outra coisa). E o carrinho usava `custo_medio`
(preço de custo) em vez de `preco_venda` — bug real, não decisão. As
três coisas foram levadas ao usuário antes de codar, não assumidas.

**Decisões do usuário:**
- Caixa: removido do dock por enquanto, mas mapeado visualmente (botão
  desabilitado com tooltip "Em breve") pra quando o módulo existir.
- Mais vendidos: endpoint novo de verdade, não reaproveitar giro de
  estoque.
- Preço do carrinho: corrigir para `preco_venda`.

**Implementado — backend:**
- `GET /vendas/mais-vendidos?dias=30&limite=8` novo: ranking por soma
  de `quantidade` em `VendaItem` de vendas `finalizada`, agrupado por
  produto, ordenado desc. Ignora vendas canceladas e isola por tenant.
  Declarado antes de `/{venda_id}` no router, mesmo padrão de
  `/painel`. 4 testes novos (`test_vendas_mais_vendidos.py`): ordenação
  por quantidade, exclusão de canceladas, respeito ao `limite`,
  isolamento entre tenants.

**Implementado — frontend (`vendas/page.tsx`):**
- Bug corrigido: `adicionarAoCarrinho` agora usa `produto.preco_venda
  ?? produto.custo_medio` (fallback só pra produto legado sem preço de
  venda cadastrado).
- Catálogo em trilhas: "Mais vendidos" (endpoint novo) + uma trilha por
  categoria real (`GET /categorias`, produtos agrupados por
  `categoria_id`) + trilha "Outros" pra produto sem categoria. Busca
  preenchida troca as trilhas por um grid de resultados (nome, SKU ou
  código de barras).
- `GET /produtos?tamanho=100` no lugar do fetch sem parâmetro (contrato
  do endpoint não mudou, só usa um parâmetro que já existia — necessário
  porque o default de 25 itens não dava catálogo suficiente pras
  trilhas).
- Cupom: HTML/CSS (`.torn-cupom-top/bottom`, `.cupom-leader` em
  `globals.css`) simulando papel de recibo térmico, cor fixa
  (`#F4F2EC`) independente do tema claro/escuro — cupom real é sempre
  claro.
- Forma de pagamento: 6 opções visuais (Dinheiro/PIX/Débito/Crédito/
  Fiado/Múltiplo), seleção local, **não enviada ao backend** — `POST
  /vendas` ainda não tem esse campo. Documentado no código como
  limitação conhecida, não escondida.
- Dock inferior `sticky bottom-2`: aba "Vendas de hoje" (KPIs reais)
  abre gaveta (`fixed inset-0`, mesmo padrão de modal já usado no
  arquivo) com o histórico completo que antes ficava sempre visível —
  mesmos componentes do kit de UX (`CartaoKpi`, tabela, cards mobile,
  `RowMenu`, `BulkActionBar`, paginação), só reembalados dentro da
  gaveta. Aba "Caixa" desabilitada ao lado, mapeada pro futuro.
- Componentes novos: `TrilhaProdutos` (rail com título/ícone) e
  `CartaoProduto` (aceita `Produto` ou `ProdutoMaisVendido`, já que os
  dois alimentam trilhas diferentes).

**Adaptação consciente do mockup para o shell real:** o preview HTML
assumia `h-screen` fixo (app imersivo, tela cheia). O NexStock real usa
scroll de página normal dentro do shell existente (sidebar fixa +
`main` com padding) — replicar um layout 100% viewport-fixed exigiria
reescrever a arquitetura de scroll do dashboard inteiro, fora do escopo
desta etapa. Adaptado para `sticky bottom-2` (dock) + `fixed inset-0`
(gaveta), que entrega a mesma ideia (secundário fora do caminho
principal, um toque pra abrir) dentro do padrão de scroll já usado por
todas as outras telas.

**Verificação:** Postgres 16 local recriado do zero, suíte completa
rodada de verdade — **216/216 passando** + 6 isolados do
`test_auth.py` (222 total), incluindo os 4 novos. Bandit: 0 issues.
`tsc --noEmit`: limpo. `next build`: limpo — rota `/vendas` subiu de
9.x kB pra 10.3 kB (trilhas + cupom + gaveta).

**Pendências deixadas explícitas (não escondidas):**
- Forma de pagamento não é persistida — precisa de campo novo em
  `Venda`/`VendaItem` + migration quando for priorizado.
- Caixa (abertura/fechamento/sangria/suprimento) continua não existindo
  — dock já preparado com o slot pronto pra receber o módulo real.
- Sem validação de saldo em tempo real no PDV ao adicionar ao carrinho
  (mesma limitação de antes desta etapa — a validação real acontece no
  `POST /vendas`, que já bloqueia com 409 se o saldo for insuficiente).


## Etapa 36 — Estações de Impressão (impressão mediada pelo backend)

Item de backlog novo, mapeado inteiramente por preview HTML interativo
(múltiplas iterações aprovadas em conversa) antes de qualquer código,
seguindo o padrão já estabelecido. Motivação: o sistema também vai ser
usado via mobile, e celular não tem como rodar QZ Tray — então o
dispositivo que pede a impressão nunca fala direto com a impressora;
ele grava um job numa fila, e um PC fixo com impressora conectada (a
"Estação"), rodando QZ Tray e com a tela aberta, puxa a fila via
polling e imprime localmente.

**Decisão de arquitetura mais importante: token de estação desacoplado
da sessão de usuário.** Uma Estação de Impressão fica rodando sozinha
por horas/dias sem interação humana — se ela dependesse do JWT do admin
que a registrou, qualquer logout/expiração/troca de senha em QUALQUER
dispositivo derrubaria a impressão. A estação recebe, no registro, um
token opaco próprio (`secrets.token_urlsafe(48)`), guardado no
`localStorage` do navegador que fez o registro (não em memória, como o
access token de usuário — aqui a estação PRECISA sobreviver a fechar
aba/reiniciar navegador). O blast radius de um roubo desse token é
baixo por natureza (só lê a fila e marca jobs do próprio tenant), o que
torna esse tradeoff aceitável.

**Lookup do token por HMAC, não argon2 — decisão consciente, diferente
do padrão de `refresh_tokens`.** O código de `auth/service.py` já
documentava (desde etapas anteriores) que em escala maior seria preciso
trocar para HMAC-SHA256 determinístico como índice de lookup, em vez do
loop `argon2.verify` contra todas as linhas não-revogadas. Refresh
token é verificado raramente (login/renovação); token de estação é
verificado a cada ciclo de polling (5-8s) de CADA estação de CADA
tenant — rodar o loop argon2 nesse volume não escalaria com a base de
clientes (requisito explícito desta etapa: multi-tenant desde o
desenho, não só multi-estação). Implementado HMAC-SHA256 chaveado com
`SECRET_KEY`, índice único, lookup O(1).

**Backend:**
- Migration `013_estacoes_impressao.sql`: tabelas `estacoes_impressao` e
  `filas_impressao`, RLS+FORCE nas duas. `estacoes_impressao` tem índice
  único em `token_lookup_hash` (busca acontece antes de sabermos o
  tenant, mesma exceção estrutural do login). `filas_impressao` guarda
  `payload_json` com o HTML pronto (mesmo formato usado pelo QZ Tray
  desde a Etapa 33) + `job_origem_id` pra rastrear reimpressões.
- `auth_service` (role bypass RLS) ganhou `SELECT, UPDATE` em
  `estacoes_impressao` — só o suficiente pro lookup de token e
  heartbeat; nunca INSERT/DELETE (registrar/revogar sempre passa pelo
  role de aplicação normal, sujeito a RLS, autenticado por JWT de admin).
- Módulo `estacoes/` novo: `CurrentEstacao` (identidade mínima, nunca
  carrega perfil de usuário) autenticada via header próprio
  `X-Estacao-Token` (não é o `Authorization: Bearer` do usuário).
  Endpoints admin (registrar/editar/revogar), endpoints de
  usuário/leitura (listar estações, criar job, listar fila, reimprimir)
  e endpoints da própria estação (`GET /fila/pendentes` — que também
  serve de heartbeat —, `POST /fila/{id}/concluir`,
  `POST /fila/{id}/erro`).
- **Reimpressão é sempre manual, nunca automática** — decisão explícita
  do usuário. Um job com erro (ou pendente-sem-resposta) nunca é
  reenviado sozinho pelo backend: evita imprimir a etiqueta duas vezes
  se a confirmação de "impresso" simplesmente se perdeu (a estação pode
  ter imprimido de verdade e só a resposta de volta ter falhado).
  Reimprimir cria um job NOVO clonando o original; o original não é
  alterado. Job já impresso não pode ser reimprimido (409) — proteção
  extra contra clique duplo.
- Isolamento cross-tenant: tentativa de mandar job pra estação de outro
  tenant, ou revogar/editar estação de outro tenant, retorna 404 (nunca
  403) — mesmo padrão do resto do sistema.

**Frontend:**
- `lib/useEstacaoRuntime.ts`: hook que lê o token salvo em
  `localStorage`; se presente, conecta no QZ Tray, faz polling da fila
  a cada 6s (dentro da faixa 5-8s combinada), imprime cada job pendente
  e marca concluído/erro. Reconexão em foco: se o navegador throttlar o
  `setInterval` da aba em segundo plano, um listener de
  `visibilitychange` força um ciclo assim que a aba volta a ficar
  visível, em vez de esperar o próximo tick regular.
- Tela `/estacoes` (admin, com item de menu condicional — mesmo padrão
  de "Usuários"): grid de estações com status online/offline computado
  em runtime (nunca persistido, mesmo princípio de `margem_percentual`
  em produtos), editar/revogar por card, fila de impressão completa
  (tabela no desktop, cards no mobile) com filtro por status, botão
  Reimprimir por linha, e banner de sugestão quando uma estação
  reconectada tem job pendente sem resposta (sugere, nunca reimprime
  sozinho).
- `RegistrarEstacaoModal.tsx`: detecta QZ Tray via `useQzTray`, lista as
  impressoras reais do sistema, bloqueia o formulário se o QZ Tray não
  responder. Registro salva o token retornado (uma única vez) no
  `localStorage` deste navegador — é isso que faz a aba virar a estação
  em funcionamento.
- `EnviarParaEstacaoBotao.tsx`: componente reutilizável usado no fluxo
  mobile — lista estações online, lembra a última escolhida
  (`localStorage`), envia o job e acompanha o status por um tempo curto
  (Enviado → Impresso/Sem resposta). Integrado em
  `GerarEtiquetaRapidaDialog` (toggle "Neste dispositivo" / "Enviar pra
  estação", com padrão automático baseado em QZ Tray detectado ou não)
  e na tela Etiquetas em lote (painel opcional abaixo do botão principal
  de impressão).
- Guia `docs/GUIA_CONFIGURACAO_ESTACAO_IMPRESSAO.md`: passo a passo pro
  tenant instalar QZ Tray, registrar a estação, e (opcional) configurar
  o navegador pra abrir sozinho no login do PC — cobre exatamente o
  ponto de "reiniciar o computador não recupera sozinho" identificado
  na fase de design, que é o único cenário que depende de configuração
  fora do NexStock.

**Correção durante o desenvolvimento:** `service._serializar_job` foi
renomeada pra `serializar_job` (pública) — o router precisava chamá-la
diretamente para reserializar o job depois de `marcar_status`.

**Verificação:** Postgres 16 local recriado do zero, suíte completa
rodada de verdade — **232/232 passando** (16 testes novos em
`test_estacoes.py`, cobrindo token desacoplado de sessão, heartbeat,
isolamento cross-tenant, reimpressão manual/bloqueio de reimpressão de
job já impresso, e leitura/escrita por perfil). `test_auth.py` isolado:
sem hang nesta rodada (comportamento intermitente já documentado, não é
regressão). Bandit: 0 issues, duas rodadas. `tsc --noEmit`: limpo.
`next build`: limpo — rota `/estacoes` nova em 7.46 kB, `/etiquetas`
subiu de 7 kB pra 8.65 kB.

**Pendências deixadas explícitas para etapas futuras:**
- `impressora_nome` usada pelo runtime da estação vem do `localStorage`
  no momento do registro — se o admin editar a impressora depois (via
  outro dispositivo), a estação em funcionamento só pega a mudança na
  próxima vez que for registrada de novo nesse navegador. Resolver
  exigiria um endpoint de "estação consulta os próprios dados" via
  token — não crítico pro piloto (uma estação raramente troca de
  impressora física sem alguém reabrir a aba de qualquer forma).
- Certificado QZ Tray assinado (popup de segurança na primeira
  impressão da sessão) continua como pendência das etapas 32-33, não
  agravada nem resolvida aqui.
- Permissão de operador gerenciar estações: campo mapeado no design
  (mencionado ao usuário), mas não implementado — hoje só admin
  registra/edita/revoga, leitura é liberada pra qualquer perfil
  autenticado.


## Correção — CORS bloqueava o header de token da Estação em produção

Detectado pelo usuário ao testar a Etapa 36 de verdade: a estação
registrada ficava presa em "Iniciando…" pra sempre, sem erro visível, e
nunca saía de Offline (`Última atividade: nunca`).

**Causa:** `CORSMiddleware` em `main.py` tinha
`allow_headers=["Authorization", "Content-Type"]` — sem `X-Estacao-Token`,
o header custom que a Estação usa pra se autenticar (ver Etapa 36).
Como frontend (Vercel) e backend (Railway) são domínios diferentes, todo
`fetch` com esse header dispara um preflight `OPTIONS` antes da chamada
real; o preflight era rejeitado pelo CORS, o navegador bloqueava a
chamada de verdade *antes* dela sair, e o `fetch` falhava com uma
exceção genérica (não um erro HTTP normal). No `useEstacaoRuntime`, essa
exceção não era um `EstacaoTokenError`, então caía no bloco de captura
sem nunca atualizar o `status` — ficava travado em `"inativo"`
("Iniciando…") indefinidamente, e o heartbeat nunca chegava a bater no
backend (dai o Offline persistente).

**Fix:** adicionado `"X-Estacao-Token"` em `allow_headers`.

**Teste de regressão:** `test_cors_permite_header_de_token_de_estacao`
em `test_estacoes.py` — dispara um preflight `OPTIONS` real contra
`/estacoes/fila/pendentes` com `Access-Control-Request-Headers:
x-estacao-token` e confirma que a resposta libera o header. Esse tipo de
bug é fácil de não pegar em teste funcional normal (que chama a rota
direto, sem simular o preflight do navegador) — por isso o teste
específico, pra não voltar a escapar silenciosamente.

**Verificação:** suíte completa — 232/232 passando. Bandit: 0 issues.
