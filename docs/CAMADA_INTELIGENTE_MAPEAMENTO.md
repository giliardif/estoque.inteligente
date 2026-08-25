# Mapeamento da Camada Inteligente

> Documento de planejamento. Nada aqui foi implementado — é o desenho de
> como as próximas peças do backlog (`historico_valor_estoque`,
> forecasting, anomaly/dead stock detection, resumos narrados por LLM) se
> encaixam entre si, e onde Notas Fiscais entra como fonte de dado.
> Serve de ponto de partida para quando a etapa dedicada à camada
> inteligente for aberta — não substitui a decisão de escopo que será
> tomada naquele momento.

## Princípio arquitetural (já confirmado, repetido aqui por contexto)

A camada estatística roda como job — nunca como chamada de LLM em tempo
real. A LLM entra só na ponta final, narrando um resultado que já foi
calculado e persistido. Isso mantém custo previsível, permite testar a
lógica de negócio com pytest normal (sem mockar modelo de linguagem), e
evita que a "inteligência" do produto dependa da disponibilidade de uma
API externa.

```
dados brutos (movimentações, vendas, notas fiscais)
        │
        ▼
   job estatístico (cron)         ← determinístico, testável, sem custo de API
        │
        ▼
   tabela de resultados persistidos
        │
        ▼
   LLM narra o resultado (sob demanda, na tela)   ← única parte não-determinística
```

## As três frentes do backlog e como elas se relacionam

### 1. Variação % do Valor do Estoque (a mais simples de entregar primeiro)

- Precisa de `historico_valor_estoque`: snapshot diário de
  `(tenant_id, data, valor_total_estoque)`, populado por job agendado.
- Só fica útil depois de ~1 mês de acúmulo (comparação mês a mês).
- Dependência técnica em aberto: confirmar se o Railway tem cron nativo
  ou se isso vira um worker separado com `APScheduler`/loop próprio.
- **Notas Fiscais entra aqui como fonte de entrada de valor**: cada nota
  processada altera o valor do estoque no dia em que os itens são
  confirmados. Se `notas_fiscais` ganhar uma coluna `valor_total`
  (hoje não existe — só há o agregado `valor_total_importado` nos KPIs),
  o job de snapshot consegue decompor a variação diária em "quanto veio
  de compra" vs. "quanto veio de venda/ajuste", o que é bem mais rico
  que um número solto de variação %.

### 2. Anomaly / dead stock detection

- Detecta produto parado (sem saída há N dias) e movimentação atípica
  (saída muito acima do padrão histórico do produto).
- Sinal de entrada natural: `movimentacoes` (já existe) + preço pago por
  unidade ao longo do tempo.
- **Aqui é onde o snapshot "antes → depois" por item de nota fiscal
  (o que mais chamou atenção na referência visual) deixa de ser só um
  enfeite de UI e vira dado de verdade**: uma entrada de estoque muito
  maior que o padrão do fornecedor pra aquele produto é exatamente o
  tipo de sinal que esse detector usaria. Ou seja, o snapshot por item
  não deveria ser desenhado só pensando na tela de Notas Fiscais — o
  formato da tabela (`notas_fiscais_itens` ganhando `saldo_anterior` /
  `saldo_posterior`, ou uma tabela de snapshot separada) precisa já
  nascer pensando em ser consumido por esse job, não só exibido.

### 3. Demand forecasting

- Estatístico (médias móveis / sazonalidade simples pra começar — não é
  o lugar de já entrar com modelo pesado), consumindo histórico de
  `venda_itens` como sinal principal.
- Preço de custo (`valor_unitario` das notas fiscais ao longo do tempo)
  é sinal secundário útil pra sugerir reposição considerando variação de
  preço do fornecedor, não só volume de venda.
- Essa é a frente mais distante — só faz sentido depois de 1 e 2
  estarem rodando de verdade em produção com dado real acumulado.

## O que fica pendente de decisão do Giliardi (não decidido aqui)

- Ordem de ataque: a recomendação já registrada é começar pela frente 1
  (mais barata, menos partes móveis), mas a decisão final é dele.
- Se o snapshot por item de nota fiscal vira coluna em
  `notas_fiscais_itens` ou tabela própria (`notas_fiscais_itens_snapshot`)
  — decisão de schema que só deve ser tomada junto com o desenho da
  frente 2, não isolada.
- Cron no Railway — precisa de checagem técnica antes de comprometer
  qualquer desenho de job agendado.
- `custo_medio` ponderado (item separado do backlog, hoje manual) tem
  overlap direto com a frente 3 — vale decidir junto se/quando essa
  etapa for aberta.

## Não incluído neste mapeamento

DANFE, cancelamento/estorno de nota e emissão de NF-e/NFC-e não têm
relação com a camada inteligente — continuam como itens de backlog
independentes, sem prioridade alterada por este documento.
