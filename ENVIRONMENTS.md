# Ambientes — Produção e Testes/Staging

## Topologia

| | Development (local) | Staging | Production |
|---|---|---|---|
| Backend | docker-compose local | Railway — projeto `estoque-staging` | Railway — projeto `estoque-production` |
| Frontend | `next dev` local | Vercel — branch `develop` (preview) | Vercel — branch `main` |
| Banco de dados | Postgres local (docker) | Supabase — projeto separado, dados fictícios | Supabase — projeto separado, dados reais de clientes |
| Domínio | localhost | staging.dominio.com.br | app.dominio.com.br |
| `.env` | `.env` (não commitado) | `.env.staging` (secrets no Railway) | `.env.production` (secrets no Railway) |
| Logs/erros | console | Railway logs + alertas leves | Railway logs + alertas críticos |
| `/docs` (Swagger) | habilitado | habilitado | **desabilitado** (ver `config.py`) |

## Regras não-negociáveis

1. **Bancos de dados nunca se misturam.** Staging e produção são projetos Supabase distintos, com credenciais distintas. Isso evita que um teste em staging jamais toque dado real de cliente.
2. **Deploy em produção só a partir da branch `main`**, e só depois de o mesmo commit ter passado por staging.
3. **Migrations rodam primeiro em staging.** Só promovidas para produção depois de validadas.
4. **Secrets nunca em arquivo versionado.** `.env.staging` e `.env.production` ficam fora do git (`.gitignore`); os valores reais vivem nas variáveis de ambiente do Railway/Vercel.
5. **`SECRET_KEY` é diferente em cada ambiente** — um token emitido em staging jamais é válido em produção (garantido pelo validador em `core/config.py`).

## Fluxo de deploy

```
feature branch → PR → CI (testes + bandit + pip-audit) → merge em develop
              → deploy automático em staging → validação manual
              → merge develop → main → deploy automático em produção
```

## Pipeline de segurança (CI, roda em toda PR)

- `pytest` — inclui os testes de isolamento entre tenants (`tests/test_tenant_isolation.py`)
- `bandit -r app/` — análise estática de vulnerabilidades no código
- `pip-audit -r requirements.txt` — CVEs conhecidas nas dependências
- PR é bloqueada se qualquer uma dessas etapas falhar
