export type Produto = {
  id: string;
  tenant_id: string;
  nome: string;
  sku: string | null;
  categoria_id: string | null;
  codigo_barras: string | null;
  unidade_medida: string;
  custo_medio: number;
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
  unidade_medida: string;
  saldo: number;
  custo_medio: number;
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
