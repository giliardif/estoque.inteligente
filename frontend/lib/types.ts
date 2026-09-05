export type Produto = {
  id: string;
  tenant_id: string;
  nome: string;
  sku: string | null;
  categoria_id: string | null;
  codigo_barras: string | null;
  unidade_medida: string;
  custo_medio: number;
  preco_venda: number | null;
  marca: string | null;
  ncm: string | null;
  imagem_url: string | null;
  controla_lote: boolean;
  estoque_minimo: number;
  estoque_maximo: number | null;
  campos_customizados: Record<string, unknown>;
  ativo: boolean;
  criado_em: string;
};

export type ProdutoCreateInput = {
  nome: string;
  sku?: string | null;
  categoria_id?: string | null;
  codigo_barras?: string | null;
  unidade_medida?: string;
  custo_medio?: number;
  preco_venda?: number | null;
  marca?: string | null;
  ncm?: string | null;
  controla_lote?: boolean;
  estoque_minimo?: number;
  estoque_maximo?: number | null;
  campos_customizados?: Record<string, unknown>;
};

// --- Painel da tela de Estoque ---------------------------------------------

export type PrioridadeEstoque = "sem_estoque" | "vencimento_proximo" | "abaixo_minimo" | "novo" | "normal";

export type DepositoSaldo = { deposito_id: string | null; deposito_nome: string; saldo: number };

export type OpcaoFiltro = { id: string; nome: string };

export type FiltrosDisponiveis = {
  categorias: OpcaoFiltro[];
  depositos: OpcaoFiltro[];
  fornecedores: OpcaoFiltro[];
};

export type KpisEstoque = {
  produtos_cadastrados: number;
  total_unidades: number;
  valor_total_custo: number;
  produtos_abaixo_minimo: number;
  produtos_sem_estoque: number;
};

export type ItemEstoque = {
  produto_id: string;
  nome: string;
  sku: string | null;
  codigo_barras: string | null;
  categoria_id: string | null;
  categoria_nome: string | null;
  marca: string | null;
  imagem_url: string | null;
  unidade_medida: string;
  saldo: number;
  custo_medio: number;
  preco_venda: number | null;
  valor_total_custo: number;
  estoque_minimo: number;
  ativo: boolean;
  criado_em: string;
  proxima_validade: string | null;
  prioridade: PrioridadeEstoque;
  posicoes: DepositoSaldo[];
};

export type PainelEstoque = {
  kpis: KpisEstoque;
  filtros: FiltrosDisponiveis;
  itens: ItemEstoque[];
  total: number;
  pagina: number;
  tamanho: number;
};

// --- Painel da tela de Produtos ---------------------------------------------

export type ItemProdutoLista = {
  id: string;
  nome: string;
  sku: string | null;
  categoria_id: string | null;
  categoria_nome: string | null;
  codigo_barras: string | null;
  unidade_medida: string;
  custo_medio: number;
  preco_venda: number | null;
  margem_percentual: number | null;
  marca: string | null;
  ncm: string | null;
  imagem_url: string | null;
  controla_lote: boolean;
  estoque_minimo: number;
  estoque_maximo: number | null;
  ativo: boolean;
  criado_em: string;
};

export type PainelProdutos = {
  itens: ItemProdutoLista[];
  filtros: { categorias: OpcaoFiltro[] };
  total: number;
  pagina: number;
  tamanho: number;
};

// --- Import em massa de produtos via planilha (Etapa 26) --------------------

export type ProdutoImportLinhaDados = {
  linha: number;
  nome: string | null;
  sku: string | null;
  categoria: string | null;
  codigo_barras: string | null;
  unidade_medida: string | null;
  custo_medio: number | null;
  preco_venda: number | null;
  marca: string | null;
  ncm: string | null;
  estoque_minimo: number | null;
  estoque_maximo: number | null;
};

export type ProdutoImportItem = {
  linha: number;
  status: "ok" | "erro";
  erro: string | null;
  dados: ProdutoImportLinhaDados | null;
  categoria_sera_criada: boolean;
  produto_id: string | null;
};

export type ProdutoImportPreview = {
  itens: ProdutoImportItem[];
  total_linhas: number;
  total_validas: number;
  total_com_erro: number;
  categorias_novas: string[];
};

export type ProdutoImportResultado = {
  criados: number;
  rejeitados: number;
  categorias_criadas: string[];
  itens: ProdutoImportItem[];
};

// --- Painel da tela de Vendas -----------------------------------------------

export type StatusVenda = "finalizada" | "cancelada";

export type KpisVendas = {
  vendas_hoje: number;
  faturamento_hoje: number;
  ticket_medio_hoje: number;
  vendas_canceladas_total: number;
};

export type ItemVendaLista = {
  id: string;
  status: StatusVenda;
  valor_total: number;
  qtd_itens: number;
  criado_em: string;
  finalizado_em: string | null;
};

export type PainelVendas = {
  itens: ItemVendaLista[];
  kpis: KpisVendas;
  total: number;
  pagina: number;
  tamanho: number;
};

// --- Painel da tela de Notas Fiscais ----------------------------------------

export type StatusNotaFiscal = "pendente" | "processada" | "cancelada";

export type KpisNotasFiscais = {
  total_notas: number;
  itens_pendentes_confirmacao: number;
  valor_total_importado: number;
  fornecedores_distintos: number;
};

export type ItemNotaFiscalLista = {
  id: string;
  numero: string;
  status: string;
  criado_em: string;
  fornecedor_nome: string | null;
  itens_pendentes: number;
};

export type PainelNotasFiscais = {
  itens: ItemNotaFiscalLista[];
  kpis: KpisNotasFiscais;
  filtros: { fornecedores: OpcaoFiltro[] };
  total: number;
  pagina: number;
  tamanho: number;
};

// --- Painel da tela de Compras ----------------------------------------------

export type KpisCompras = {
  total_pedidos: number;
  pedidos_em_aberto: number;
  valor_total_pedidos: number;
  fornecedores_distintos: number;
};

export type PedidoListaItem = {
  id: string;
  status: string;
  fornecedor_nome: string | null;
  valor_total: number;
  qtd_itens: number;
  quantidade_pendente: number;
  criado_em: string;
};

export type PainelCompras = {
  itens: PedidoListaItem[];
  kpis: KpisCompras;
  filtros: { fornecedores: OpcaoFiltro[] };
  total: number;
  pagina: number;
  tamanho: number;
};

// --- Painel da tela de Inventário -------------------------------------------

export type KpisInventario = {
  total_inventarios: number;
  inventarios_abertos: number;
  itens_divergentes: number;
  depositos_distintos: number;
};

export type InventarioListaItem = {
  id: string;
  status: string;
  ciclo: string;
  deposito_id: string | null;
  deposito_nome: string | null;
  qtd_itens_contados: number;
  qtd_divergentes: number;
  criado_em: string;
};

export type PainelInventario = {
  itens: InventarioListaItem[];
  kpis: KpisInventario;
  filtros: { depositos: OpcaoFiltro[] };
  total: number;
  pagina: number;
  tamanho: number;
};

// --- Etapa 39: fluxo de encerramento e aprovação ---------------------------

export type InventarioCiclo = {
  id: string;
  status: "aberto" | "em_analise" | "fechado" | "cancelado";
  ciclo: string;
  deposito_id: string | null;
  criado_em: string;
  enviado_por: string | null;
  enviado_em: string | null;
  aprovado_por: string | null;
  aprovado_em: string | null;
};

export type MotivoDivergencia = "avaria" | "vencimento" | "furto" | "erro_entrada";

export type StatusItemInventario =
  | "pendente"
  | "aguardando_confirmacao"
  | "contado"
  | "divergente"
  | "aprovado"
  | "recontagem_solicitada";

export const LIMITE_TENTATIVAS = 3;

// Contagem cega de verdade (Etapa 39.1): nunca inclui qtd_sistema NEM
// divergencia — só o status_item e quantas tentativas já foram usadas.
export type ItemOperador = {
  produto_id: string;
  produto_nome: string;
  codigo_barras: string | null;
  categoria_nome: string | null;
  qtd_contada: number | null;
  status_item: StatusItemInventario;
  tentativas: number;
  motivo: MotivoDivergencia | null;
  anexo_url: string | null;
};

export type PainelOperador = {
  inventario: InventarioCiclo;
  progresso: { total: number; contados: number; percentual: number };
  resumo: { sem_divergencia: number; com_divergencia: number; pendentes: number };
  itens: ItemOperador[];
};

export type ResultadoContagem = {
  produto_id: string;
  status_item: StatusItemInventario;
  tentativas: number;
  limite_atingido: boolean;
};

export type ItemConciliacao = {
  produto_id: string;
  produto_nome: string;
  codigo_barras: string | null;
  qtd_anterior: number;
  qtd_contada: number | null;
  divergencia: number | null;
  impacto_financeiro: number | null;
  status_item: StatusItemInventario;
  tentativas: number;
  motivo: MotivoDivergencia | null;
  anexo_url: string | null;
  decidido_por_nome: string | null;
  decidido_em: string | null;
};

export type Conciliacao = {
  inventario: InventarioCiclo;
  enviado_por_nome: string | null;
  kpis: { itens_divergentes: number; itens_aguardando_decisao: number; impacto_financeiro_total: number };
  itens: ItemConciliacao[];
};

// --- Detalhes do ciclo (histórico, qualquer status) -------------------------

export type TentativaLog = {
  numero_tentativa: number;
  qtd_contada: number;
  usuario_nome: string | null;
  criado_em: string;
};

export type ItemDetalhe = ItemConciliacao & { tentativas_log: TentativaLog[] };

export type DetalheCiclo = {
  inventario: InventarioCiclo;
  enviado_por_nome: string | null;
  aprovado_por_nome: string | null;
  kpis: { itens_divergentes: number; itens_aguardando_decisao: number; impacto_financeiro_total: number };
  itens: ItemDetalhe[];
};

// --- Painel da tela de Alertas ----------------------------------------------

export type KpisAlertas = {
  total_ativos: number;
  validade: number;
  estoque_baixo: number;
  produto_parado: number;
};

export type AlertaListaItem = {
  id: string;
  tipo: string;
  produto_id: string;
  produto_nome: string | null;
  mensagem: string;
  lido: boolean;
  criado_em: string;
};

export type PainelAlertas = {
  itens: AlertaListaItem[];
  kpis: KpisAlertas;
  total: number;
  pagina: number;
  tamanho: number;
};

// --- Painel da tela de Movimentação -----------------------------------------

export type KpisMovimentacao = {
  total_movimentacoes: number;
  entradas: number;
  saidas: number;
  ajustes: number;
};

export type MovimentacaoListaItem = {
  id: string;
  produto_id: string;
  produto_nome: string | null;
  deposito_id: string | null;
  deposito_nome: string | null;
  tipo: "entrada" | "saida" | "ajuste" | "transferencia";
  quantidade: number;
  origem: string | null;
  grupo_transferencia_id: string | null;
  criado_em: string;
};

export type PainelMovimentacao = {
  itens: MovimentacaoListaItem[];
  kpis: KpisMovimentacao;
  filtros: { produtos: OpcaoFiltro[] };
  total: number;
  pagina: number;
  tamanho: number;
};

// --- Painel Home (Etapa 23) --------------------------------------------------
// Diferente dos demais paineis, este não é a tela de gestão de um módulo —
// cruza dados de vários módulos ao mesmo tempo. Não tem paginação/filtro,
// é sempre um retrato agregado do tenant inteiro (só o período do gráfico
// de movimentações é configurável, via `dias`).

export type KpiComVariacao = { valor: number; variacao_percentual: number | null };

export type KpisPainel = {
  valor_total_estoque: number;
  produtos_cadastrados: KpiComVariacao;
  entradas_mes: KpiComVariacao;
  saidas_mes: KpiComVariacao;
  faturamento_mes: KpiComVariacao;
};

export type PontoMovimentacao = { data: string; entradas: number; saidas: number };

export type ProdutoGiro = { produto_id: string; nome: string; giro_dias: number | null; saldo_atual: number };

// --- PDV (Etapa 35 — redesign) ---------------------------------------------

export type Categoria = { id: string; nome: string; categoria_pai_id: string | null };

export type ProdutoMaisVendido = {
  produto_id: string;
  nome: string;
  sku: string | null;
  codigo_barras: string | null;
  preco_venda: number | null;
  custo_medio: number;
  unidade_medida: string;
  imagem_url: string | null;
  quantidade_vendida: number;
};

export type CategoriaResumo = { categoria_id: string | null; nome: string; produtos: number; percentual: number };

export type ProdutoCritico = {
  produto_id: string;
  nome: string;
  categoria_nome: string | null;
  saldo_atual: number;
  estoque_minimo: number;
  nivel: "critico" | "baixo";
};

export type MovimentacaoRecente = {
  id: string;
  tipo: "entrada" | "saida" | "ajuste" | "transferencia";
  produto_nome: string;
  quantidade: number;
  origem: string | null;
  criado_em: string;
};

export type AlertasResumo = {
  total_ativos: number;
  estoque_baixo: number;
  validade: number;
  produto_parado: number;
  pedidos_em_aberto: number;
};

export type PainelGeral = {
  kpis: KpisPainel;
  movimentacoes_periodo: PontoMovimentacao[];
  giro_estoque_top5: ProdutoGiro[];
  estoque_por_categoria: CategoriaResumo[];
  estoque_critico: ProdutoCritico[];
  ultimas_movimentacoes: MovimentacaoRecente[];
  alertas: AlertasResumo;
};

export type Perfil = "admin" | "operador" | "leitura";

export type Usuario = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  ativo: boolean;
  avatar_url: string | null;
  criado_em: string;
};

export type Tenant = {
  id: string;
  nome: string;
  segmento_slug: string;
  cnpj: string | null;
};

export type UsuarioCreateResult = {
  usuario: Usuario;
  senha_provisoria: string;
};

export type EtiquetaElementos = {
  nome: boolean;
  sku: boolean;
  preco: boolean;
  marca: boolean;
};

export type EtiquetaConfig = {
  elementos: EtiquetaElementos;
  tipoCodigo: "barras" | "qr";
  tamanho: "30x20" | "40x30" | "50x40";
  colunas: number;
  margemMm: number;
  espacamentoMm: number;
  modoImpressao: "navegador" | "qztray";
  impressora: string;
};

export type EtiquetaModelo = {
  id: string;
  nome: string;
  config_json: EtiquetaConfig;
  criado_em: string;
  atualizado_em: string;
};

// ===== Estações de Impressão (Etapa 36) =====

export type EstacaoImpressao = {
  id: string;
  nome: string;
  impressora_nome: string;
  online: boolean;
  ultima_atividade_em: string | null;
  criado_em: string;
};

export type EstacaoImpressaoRegistrada = EstacaoImpressao & {
  token: string;
};

export type StatusJobImpressao = "pendente" | "impresso" | "erro";

export type JobImpressao = {
  id: string;
  estacao_id: string;
  estacao_nome: string;
  produto_id: string | null;
  titulo: string;
  quantidade: number;
  status: StatusJobImpressao;
  enviado_por_nome: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type JobImpressaoPendente = {
  id: string;
  titulo: string;
  quantidade: number;
  payload_json: { html?: string };
  criado_em: string;
};

export type ReposicaoInteligencia = {
  produto_id: string;
  produto_nome: string;
  estoque_atual: number;
  demanda_media_dia: number;
  tendencia: "alta" | "baixa" | "estavel";
  quantidade_sugerida: number;
  precisa_repor: boolean;
  narrativa: string | null;
};

export type IndicadorGiroInteligencia = {
  produto_id: string;
  produto_nome: string;
  giro_periodo: number;
  cobertura_dias: number | null;
  risco_ruptura: "alto" | "medio" | "baixo";
};

export type AnomaliaInteligencia = {
  produto_id: string;
  produto_nome: string;
  classificacao: "pico" | "queda";
  semana_atual: number;
  media_historica: number;
  z_score: number | null;
  narrativa: string | null;
};

export type DeadStockInteligencia = {
  produto_id: string;
  produto_nome: string;
  dias_parado: number;
  saldo_parado: number;
  valor_em_risco: number;
  narrativa: string | null;
};

export type PainelInteligencia = {
  ultima_analise_em: string | null;
  resumo_semanal: string | null;
  reposicoes: ReposicaoInteligencia[];
  indicadores_giro: IndicadorGiroInteligencia[];
  anomalias: AnomaliaInteligencia[];
  dead_stock: DeadStockInteligencia[];
};
