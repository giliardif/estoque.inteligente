from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

TIPOS_VALIDOS = {"entrada", "saida", "ajuste", "transferencia"}


class MovimentacaoCreate(BaseModel):
    produto_id: UUID
    deposito_id: UUID | None = None
    # Só usados quando tipo == "transferencia" — ver model_validator abaixo.
    deposito_origem_id: UUID | None = None
    deposito_destino_id: UUID | None = None
    lote_id: UUID | None = None
    tipo: str
    quantidade: float = Field(gt=0)  # sempre positiva; o sinal é resolvido pelo `tipo`/`direcao`, nunca livre
    direcao: str | None = None  # obrigatório apenas quando tipo == "ajuste": "positivo" | "negativo"
    origem: str | None = Field(default=None, max_length=200)
    referencia_externa: str | None = Field(default=None, max_length=120)

    @field_validator("tipo")
    @classmethod
    def tipo_valido(cls, v: str) -> str:
        if v not in TIPOS_VALIDOS:
            raise ValueError(f"Tipo deve ser um de: {', '.join(sorted(TIPOS_VALIDOS))}")
        return v

    @field_validator("direcao")
    @classmethod
    def direcao_valida(cls, v: str | None) -> str | None:
        if v is not None and v not in {"positivo", "negativo"}:
            raise ValueError("direcao deve ser 'positivo' ou 'negativo'")
        return v

    @field_validator("origem", "referencia_externa")
    @classmethod
    def sanitize_texto(cls, v: str | None) -> str | None:
        if v is None:
            return v
        return "".join(ch for ch in v if ch.isprintable()).strip()

    @model_validator(mode="after")
    def transferencia_exige_origem_e_destino(self) -> "MovimentacaoCreate":
        if self.tipo == "transferencia":
            if not self.deposito_origem_id or not self.deposito_destino_id:
                raise ValueError("Transferência exige 'deposito_origem_id' e 'deposito_destino_id'.")
            if self.deposito_origem_id == self.deposito_destino_id:
                raise ValueError("Depósito de origem e destino não podem ser o mesmo.")
        return self


class MovimentacaoOut(BaseModel):
    id: UUID
    tenant_id: UUID
    produto_id: UUID
    deposito_id: UUID | None
    lote_id: UUID | None
    tipo: str
    quantidade: float
    origem: str | None
    referencia_externa: str | None
    grupo_transferencia_id: UUID | None
    criado_em: datetime

    model_config = {"from_attributes": True}


class DepositoSaldoOut(BaseModel):
    deposito_id: UUID | None
    deposito_nome: str
    saldo: float


class SaldoProdutoOut(BaseModel):
    produto_id: UUID
    nome: str
    codigo_barras: str | None
    saldo: float
    estoque_minimo: float
    abaixo_do_minimo: bool
    # Lista vazia = tenant não usa depósitos segmentados (uso comum, ex.
    # bomboniere de balcão único) — a tela de consulta simplesmente não mostra
    # a coluna "Posição" nesse caso. Populada só quando há movimentação
    # vinculada a algum depósito, então o recurso fica opt-in por tenant sem
    # precisar de nenhuma flag de configuração.
    posicoes: list[DepositoSaldoOut] = []


# --- Painel da tela de Estoque (Etapa 11, parte 3) -------------------------
#
# Um só endpoint (GET /estoque/painel) devolve KPIs + opções de filtro +
# itens da grade juntos, pra tela de Estoque abrir com uma única chamada em
# vez de 3-4 requisições separadas — direto ligado à diretriz de reduzir
# cliques/latência percebida.

PRIORIDADES_EM_ORDEM = ["sem_estoque", "vencimento_proximo", "abaixo_minimo", "novo", "normal"]


class OpcaoFiltro(BaseModel):
    id: UUID
    nome: str


class FiltrosDisponiveisOut(BaseModel):
    categorias: list[OpcaoFiltro]
    depositos: list[OpcaoFiltro]
    fornecedores: list[OpcaoFiltro]


class KpisEstoqueOut(BaseModel):
    produtos_cadastrados: int
    total_unidades: float
    valor_total_custo: float
    produtos_abaixo_minimo: int
    produtos_sem_estoque: int


class ItemEstoqueOut(BaseModel):
    produto_id: UUID
    nome: str
    sku: str | None
    codigo_barras: str | None
    categoria_id: UUID | None
    categoria_nome: str | None
    marca: str | None
    imagem_url: str | None
    unidade_medida: str
    saldo: float
    custo_medio: float
    preco_venda: float | None
    valor_total_custo: float
    estoque_minimo: float
    ativo: bool
    criado_em: datetime
    proxima_validade: date | None
    # Um único selo por produto — a ordem de prioridade acima decide qual
    # aparece quando mais de uma condição é verdadeira ao mesmo tempo (ex:
    # produto novo E abaixo do mínimo mostra "abaixo do mínimo", que é mais
    # acionável). Ver spec aprovada da tela de Estoque.
    prioridade: str
    posicoes: list[DepositoSaldoOut] = []


class PainelEstoqueOut(BaseModel):
    kpis: KpisEstoqueOut
    filtros: FiltrosDisponiveisOut
    itens: list[ItemEstoqueOut]
    total: int
    pagina: int
    tamanho: int


# --- Painel da tela de Movimentação (Etapa 22) ------------------------------
#
# GET /estoque/movimentacoes/painel, separado de GET /estoque/movimentacoes
# (listagem crua já usada, inclusive pelo formulário de registrar desta
# mesma tela) e de GET /estoque/painel (painel da tela de Estoque, um
# recorte diferente — saldo por produto, não histórico de lançamentos).
# Mesmo padrão dos demais paineis com kit de UX.

class KpisMovimentacaoOut(BaseModel):
    total_movimentacoes: int
    entradas: int
    saidas: int
    ajustes: int


class OpcaoFiltroProduto(BaseModel):
    id: UUID
    nome: str


class FiltrosMovimentacaoOut(BaseModel):
    produtos: list[OpcaoFiltroProduto]


class MovimentacaoListaItemOut(BaseModel):
    id: UUID
    produto_id: UUID
    produto_nome: str | None
    deposito_id: UUID | None
    deposito_nome: str | None
    tipo: str
    quantidade: float
    origem: str | None
    grupo_transferencia_id: UUID | None
    criado_em: datetime


class PainelMovimentacaoOut(BaseModel):
    itens: list[MovimentacaoListaItemOut]
    kpis: KpisMovimentacaoOut
    filtros: FiltrosMovimentacaoOut
    total: int
    pagina: int
    tamanho: int
