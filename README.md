# Sistema de Gestão Inteligente de Estoque — Doce Encanto

Backend (FastAPI) + Frontend (Next.js), arquitetura multi-tenant/multi-segmento.
Ver `DEVLOG.md` para o histórico de desenvolvimento e `SECURITY.md` para o
resumo de segurança. `ENVIRONMENTS.md` documenta staging x produção.

## Rodando localmente (passo a passo)

### 1. Banco de dados
```bash
docker compose up -d db
```

### 2. Aplicar as migrations (em ordem)
```bash
cd backend
for f in migrations/*.sql; do
  docker exec -i estoque-inteligente-db-1 psql -U dev -d estoque_dev < "$f"
done
```

### 3. Configurar variáveis de ambiente
```bash
cp .env.example .env
# Gere uma SECRET_KEY forte:
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
# Cole o resultado em SECRET_KEY no .env
```

### 4. Instalar dependências e rodar o backend
```bash
pip install -r requirements.txt --break-system-packages
uvicorn app.main:app --reload
```
A API sobe em `http://localhost:8000`. Documentação interativa em `/docs`
(só disponível fora de produção — ver `core/config.py`).

### 5. Criar o primeiro tenant + usuário admin
```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "nome_empresa": "Doce Encanto",
    "segmento_slug": "bomboniere",
    "admin_nome": "Seu Nome",
    "admin_email": "voce@doceencanto.com",
    "admin_senha": "UmaSenhaForte123"
  }'
```
(a senha precisa ter 10+ caracteres, maiúscula, minúscula e número)

### 6. Rodar o frontend
```bash
cd ../frontend
cp .env.example .env.local
npm install
npm run dev
```
Acesse `http://localhost:3000/login` e entre com o e-mail/senha criados no passo 5.

## Rodando os testes de segurança
Os testes precisam de um Postgres real rodando e migrado — RLS não pode ser
simulado com SQLite, e além disso os testes agora rodam com um role
**restrito** (não dono das tabelas, sem `BYPASSRLS`), o mesmo tipo de role
que a aplicação usa em produção. Isso é proposital: rodar os testes com o
role dono/superuser faria o Postgres ignorar RLS silenciosamente, e a
suíte estaria validando só o filtro de `tenant_id` em código, não o
enforcement de verdade do banco.

```bash
cd backend
./scripts/setup_test_db.sh       # recria o banco de teste + roles restritos + aplica migrations
export DATABASE_URL=postgresql+asyncpg://estoque_app_test:apppass@localhost:5432/estoque_test
export AUTH_DATABASE_URL=postgresql+asyncpg://estoque_auth_test:authpass@localhost:5432/estoque_test

pytest                          # 100 testes: isolamento entre tenants, saldo, auth, alertas, compras...
bandit -r app/                  # análise estática de segurança
pip-audit -r requirements.txt   # CVEs conhecidas nas dependências

cd ../frontend
npm audit                       # CVEs conhecidas nas dependências do frontend
npm run build                   # build de produção + checagem de tipos
```

O script `setup_test_db.sh` usa `sudo -u postgres psql` por padrão para
criar o banco/roles; ajuste a variável `ADMIN_PSQL` se seu ambiente local
for diferente (ex: Postgres via docker-compose).

## O que já funciona hoje
- **Backend completo**: Produtos, Estoque, Inventário, Notas Fiscais (import XML),
  Vendas/PDV, Alertas, Compras, Autenticação — todos com testes de segurança
- **Frontend conectado**: Painel, Produtos, Estoque, Vendas, Inventário, Notas
  Fiscais, Compras, Alertas e Relatórios — todas as telas do menu consomem a API real

## O que ainda falta (próximos passos naturais)
- Emissão de NF-e/NFC-e (hoje só importação está implementada)
- Código de barras/QR (leitura via câmera no frontend)
- App mobile/PWA
- Notificações por e-mail/WhatsApp
- Deploy de fato em staging/produção (Railway + Vercel + Supabase) — hoje o
  sistema roda localmente; nenhum ambiente remoto foi provisionado ainda
