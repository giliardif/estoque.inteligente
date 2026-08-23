# Guia — Configurando uma Estação de Impressão

Este guia é pra quem vai deixar um computador (Caixa 1, Depósito, etc.)
funcionando como Estação de Impressão do NexStock: recebendo pedidos de
impressão do celular ou de qualquer outro dispositivo e imprimindo
automaticamente na impressora ligada a esse PC.

Leva uns 10 minutos, e só precisa ser feito **uma vez por computador**.

---

## O que você precisa antes de começar

- O computador que vai ficar ligado à impressora térmica (ou qualquer
  impressora já instalada no Windows/Mac)
- A impressora já instalada e funcionando normalmente nesse computador
  (se hoje você já consegue imprimir um documento qualquer nele, já está
  pronto nesse quesito)
- Um usuário **admin** do NexStock pra fazer o registro

---

## Passo 1 — Instalar o QZ Tray

O QZ Tray é o programa que permite ao NexStock enxergar e usar a
impressora desse computador. Sem ele, a Estação não consegue imprimir.

1. Baixe em **https://qz.io/download/**
2. Instale normalmente (Avançar → Avançar → Concluir)
3. Depois de instalado, o QZ Tray fica rodando na bandeja do sistema
   (o ícone perto do relógio, no Windows; ou na barra superior, no Mac)
4. Deixe ele aberto — não precisa fazer nada além disso por enquanto

> Na primeira vez que o NexStock tentar imprimir por esse computador,
> vai aparecer um popup do QZ Tray pedindo confirmação de segurança.
> Isso é esperado (o sistema ainda não tem certificado assinado) — só
> aceitar. Costuma aparecer de novo a cada nova sessão do navegador.

---

## Passo 2 — Registrar a estação no NexStock

1. Abra o NexStock **neste mesmo computador**, logado como admin
2. Vá em **Configurações → Estações de Impressão**
3. Clique em **"Registrar nova estação"**
4. Se o QZ Tray estiver rodando (Passo 1), o NexStock já vai listar as
   impressoras que esse Windows/Mac enxerga
5. Escolha a impressora certa, dê um nome pra essa estação (ex: "Caixa
   1", "Depósito") e clique em **Salvar**

Pronto — a partir daqui, **esta aba do navegador** virou a Estação de
Impressão. Ela vai ficar verificando pedidos novos sozinha, sem precisar
fazer mais nada.

---

## Passo 3 — Deixar essa aba sempre aberta

A Estação só funciona enquanto essa aba estiver aberta nesse navegador.
Fechar a aba (de propósito ou sem querer) pausa a estação até alguém
abrir de novo — os pedidos não se perdem, só ficam esperando.

Recomendações:

- **Não feche essa aba** durante o expediente
- Se possível, deixe ela numa **janela própria**, separada das outras
  abas do dia a dia, pra reduzir o risco de fechar sem querer
- Evite deixar o computador **hibernar ou suspender** — isso também
  pausa a estação. Configure o Windows/Mac pra não dormir sozinho
  enquanto ligado

---

## Passo 4 (opcional, mas recomendado) — Abrir automaticamente ao ligar o PC

Isso resolve o caso de alguém reiniciar o computador e esquecer de abrir
a tela de novo.

### Windows

1. Abra o navegador (Chrome, por exemplo) e configure a URL da Estação
   (`https://seu-dominio.com/estacoes`) como **página inicial**
2. Aperte `Win + R`, digite `shell:startup` e aperte Enter — abre a
   pasta de Inicialização
3. Crie um atalho do navegador nessa pasta, com a URL da Estação como
   argumento (clique direito no atalho → Propriedades → no campo
   "Destino", adicione a URL no final, entre aspas)
4. Reinicie o computador pra testar — o navegador deve abrir sozinho já
   na tela da Estação

### Mac

1. Vá em **Preferências do Sistema → Usuários e Grupos → Itens de
   Login**
2. Clique em **+** e adicione o navegador que você usa
3. Configure a página inicial do navegador pra abrir direto na URL da
   Estação (`https://seu-dominio.com/estacoes`)

> Dica extra: alguns navegadores têm um "modo kiosk" (tela cheia, sem
> barra de endereço) — bom pra deixar num PC dedicado só a isso, mas
> totalmente opcional.

---

## Como saber se está tudo funcionando

Na tela **Configurações → Estações de Impressão**, a estação aparece
com uma bolinha verde **Online**. Se aparecer **Offline**, confira:

| Sintoma | Provável causa |
|---|---|
| Estação aparece Offline | A aba foi fechada, ou o computador está hibernando |
| "QZ Tray não encontrado" ao registrar/editar | O QZ Tray não está aberto nesse computador |
| Job fica "Pendente" sem imprimir | QZ Tray caiu — reabra o programa e a estação volta sozinha |
| Popup de segurança aparece toda hora | Normal sem certificado assinado — só confirmar |

Se um job ficar preso sem imprimir mesmo com tudo certo, use o botão
**Reimprimir** na fila — a reimpressão nunca acontece sozinha, então é
sempre uma ação sua.

---

## Revogando o acesso de uma estação

Se trocar de computador, ou desconfiar que alguém tem acesso indevido,
vá em **Configurações → Estações de Impressão** e clique em **Revogar
acesso** no card da estação. Isso invalida o acesso dela na hora — pra
voltar a funcionar, é preciso registrar de novo (Passo 2).
