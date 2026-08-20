-- Etapa 27: Convite e gestão de usuário (dentro do tenant).
--
-- Fluxo escolhido (conversa com Giliardi): admin cadastra o novo usuário
-- diretamente (nome, e-mail, perfil) e o backend gera uma senha provisória
-- de alta entropia, exibida UMA ÚNICA VEZ na resposta da API — não fica
-- recuperável depois, o admin repassa por fora do sistema (WhatsApp etc.).
-- Não depende de envio de e-mail (infraestrutura de e-mail ainda não existe
-- no sistema — fica pro backlog "Email/WhatsApp notifications"; quando isso
-- for implementado, dá pra evoluir para convite por link/token sem quebrar
-- este modelo, já que deve_trocar_senha continua fazendo sentido nos dois).
--
-- deve_trocar_senha força a troca no primeiro login: o usuário criado por
-- convite só acessa o resto do sistema depois de definir uma senha própria.
-- Usuários já existentes (ex: admin fundador via /auth/register) não são
-- afetados — default false, e a migration não altera linhas existentes.

alter table users
    add column deve_trocar_senha boolean not null default false;
