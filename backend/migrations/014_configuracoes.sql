-- Etapa 37: tela de Configurações — 3 pendências de backend viabilizadas
-- pelo mockup aprovado: dados de Empresa (CNPJ), edição do próprio nome
-- (sem coluna nova, só endpoint) e foto de perfil do usuário.
--
-- CNPJ como texto (não numeric/bigint): o campo aceita formatação livre
-- na entrada (a validação de dígito verificador roda na camada de
-- aplicação, igual ao resto do projeto — regra de negócio não vai pro
-- schema do banco). Nullable: nem todo tenant piloto tem CNPJ cadastrado
-- ainda, e o campo não é obrigatório pra continuar usando o sistema.
--
-- avatar_url segue o mesmo padrão já usado em produtos.imagem_url: string
-- da URL pública do Supabase Storage, não o binário. Nullable — usuário
-- sem foto é o estado normal até que decida enviar uma.
--
-- Nenhuma RLS nova necessária aqui: users já está sob FORCE ROW LEVEL
-- SECURITY desde a migration 009 (cobre a coluna nova automaticamente,
-- RLS é por linha, não por coluna). "tenants" continua sem RLS por
-- decisão já registrada (migration densa isolada, pendente) — a consulta
-- a esse campo pela aplicação DEVE seguir filtrando por id explicitamente
-- (ver app/modules/tenant/service.py).

alter table tenants
    add column cnpj text;

alter table users
    add column avatar_url text;
