# Segurança — Sistema de Gestão de Estoque

## O que já está implementado no código

| Risco | Mitigação | Onde |
|---|---|---|
| Vazamento de dados entre clientes (tenants) | Row Level Security no Postgres (com `FORCE ROW LEVEL SECURITY`, válida até para o dono da tabela) + filtro explícito por `tenant_id` em toda query (defesa em profundidade) | `migrations/001_init_core_schema.sql`, `migrations/009_force_rls.sql`, `core/database.py`, `modules/produtos/service.py` |
| Senhas fracas/vazadas | Hash com Argon2 (recomendação OWASP atual, resistente a GPU) | `core/security.py` |
| Token forjado ou expirado | JWT assinado (HS256) com expiração curta (30min) + validação em toda rota | `core/security.py` |
| Escalonamento de privilégio | Autorização por perfil (admin/operador/leitura) em cada endpoint sensível | `modules/produtos/router.py` |
| XXE / bilhão de risadas no upload de XML da NF-e | `defusedxml` em vez de parser XML padrão + limite de 5MB por arquivo | `modules/notas_fiscais/parser_xml.py` |
| SQL Injection | ORM parametrizado (SQLAlchemy) em 100% das queries — nunca string concatenada | todos os `service.py` |
| Força bruta em login | Rate limit dedicado e mais restritivo em `/auth/login` (5/min) vs. geral (100/min) | `core/config.py`, `main.py` |
| CORS aberto | `ALLOWED_ORIGINS` é lista fechada por ambiente, nunca `*` | `main.py` |
| Vazamento de stacktrace/dados sensíveis em erro | Exceções tratadas explicitamente, mensagens genéricas ao cliente | `parser_xml.py`, routers |
| Documentação da API exposta em produção | `/docs`, `/redoc`, `/openapi.json` desligados quando `ENV=production` | `core/config.py`, `main.py` |
| Enumeração de recursos de outro tenant | 404 (não 403) quando o recurso pertence a outro tenant | `test_tenant_isolation.py` |
| Headers de resposta inseguros | `X-Content-Type-Options`, `X-Frame-Options`, `HSTS` em produção, etc. | `main.py` |
| Paginação usada para DoS | `limit` máximo de 100 itens por página, obrigatório | `modules/produtos/router.py` |
| Força bruta em login (por conta, além de por IP) | Lockout de 5 tentativas / 15 min por conta, somado ao rate limit de IP | `modules/auth/service.py` |
| Enumeração de e-mail cadastrado via login | Mensagem de erro idêntica para e-mail inexistente, senha errada e conta bloqueada | `modules/auth/service.py` |
| Roubo/reuso de refresh token | Rotação a cada uso + hash (nunca texto puro) + revogação de todos os tokens no logout | `modules/auth/service.py`, migration 004 |
| Isolamento de tenant antes do login (não há tenant conhecido ainda) | Conexão de banco dedicada e restrita (`auth_service`, bypass de RLS só em users/refresh_tokens/tenants) — única exceção documentada ao RLS do sistema, e a única forma de bypass que existe tanto em produção quanto no ambiente de teste (`estoque_auth_test`, ver `scripts/setup_test_db.sh`) | `core/database.py` |
| Roubo de refresh token via XSS no frontend | Refresh token em cookie **httpOnly** (inacessível a JavaScript), nunca no corpo da resposta ou em localStorage | `modules/auth/router.py`, `frontend/lib/api.ts` |
| CSRF no cookie de refresh token | Cookie com `SameSite=Strict` — não é enviado em requisições disparadas por outro site | `modules/auth/router.py` |
| Roubo de access token via XSS no frontend | Access token vive só em variável de módulo (memória), nunca em localStorage/sessionStorage | `frontend/lib/api.ts` |
| CVEs conhecidas em dependências do frontend | `npm audit` rodado após cada mudança de dependência — Next.js atualizado de 14.2.15 (22 CVEs corrigidas ao longo do backend + 2 no frontend) até 15.5.20 (0 vulnerabilidades conhecidas) | `frontend/package.json` |
| Upload de XML sem autenticação | Endpoint de importação de nota exige perfil admin/operador, mesmo padrão dos demais endpoints de escrita | `modules/notas_fiscais/router.py` |

## Testes de vulnerabilidade executados

- **Bandit** (análise estática — SAST) rodado em todo o código do backend: **0 problemas encontrados**.
- **pip-audit** (CVEs em dependências): 2 vulnerabilidades sem correção disponível em dependências transitivas (`ecdsa`, `pyasn1`, via `python-jose`) — documentadas e com risco mitigado, já que o projeto usa apenas HS256.
- **npm audit** (frontend): 0 vulnerabilidades.
- **Suíte automatizada real — 100/100 testes passando contra Postgres de verdade, com RLS efetivamente exercitada** (não apenas análise estática, e não apenas o filtro de aplicação): a partir desta etapa, os testes rodam com um role de banco que NÃO é dono das tabelas e NÃO tem `BYPASSRLS` — o mesmo tipo de role usado pela aplicação em produção (ver `scripts/setup_test_db.sh`). Antes disso, os testes rodavam com um role superuser/dono, que o Postgres sempre deixa ignorar RLS por padrão — então a suíte validava só o filtro de `tenant_id` feito em código, nunca o enforcement real do banco. Corrigido: agora um bug de aplicação que esqueça o filtro de tenant seria pego pelo Postgres, não só pela revisão de código.
- **Achado real desta validação:** ao trocar para o role restrito, a suíte revelou um bug de disponibilidade genuíno (não só de teste): o padrão `commit()` seguido de `refresh()`, usado na maioria dos módulos de negócio, abre uma nova transação implícita após o commit — e o contexto de tenant (`set_config('app.tenant_id', ..., true)`, escopado à transação) se perdia nesse meio-tempo, quebrando a query seguinte sob um role sem `BYPASSRLS`. Esse bug já existia em produção potencialmente, só nunca tinha sido detectado porque o ambiente de teste local sempre rodou com um role que ignora RLS. Corrigido de forma centralizada em `core/database.py`: a sessão agora reaplica `app.tenant_id` automaticamente a cada nova transação aberta (evento `after_begin`), sem precisar alterar cada `service.py` individualmente.
- Ver `DEVLOG.md` (Etapa 9, e a investigação de RLS mais recente) para o histórico completo de bugs reais encontrados e corrigidos por essa validação contra Postgres de verdade — incluindo o bug de ciclo de vida de sessão de banco da Etapa 9 e o de reaplicação de tenant_id desta etapa.

## O que ainda falta (próximas etapas, à medida que os módulos avançam)

- Testes de penetração (pentest) manuais ou automatizados (ex: OWASP ZAP) contra o ambiente de **staging** antes de cada release para produção — nunca contra produção diretamente
- Rotina de rotação de `SECRET_KEY` e revogação de tokens
- Logging estruturado de auditoria (quem fez o quê) já modelado no schema (`usuario_id` em `movimentacoes`), falta implementar a leitura/relatório
- Política de backup e teste de restauração do banco de produção
- Verificação de segurança 2FA para perfis `admin`

## Processo contínuo

A cada novo módulo (estoque, inventário, vendas, notas fiscais completas), replicar:
1. Query sempre escopada por `tenant_id`
2. Validação de entrada rígida via Pydantic (tipo, tamanho, regras de negócio)
3. Autorização por perfil quando a ação for sensível
4. Rodar `bandit` e `pip-audit` antes de cada PR (ver `ENVIRONMENTS.md` — pipeline de CI)
