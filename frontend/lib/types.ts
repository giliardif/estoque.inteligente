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
