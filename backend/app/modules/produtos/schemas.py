from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class ProdutoBase(BaseModel):
    nome: str = Field(min_length=2, max_length=200)
    sku: str | None = Field(default=None, max_length=60)
    categoria_id: UUID | None = None
    codigo_barras: str | None = Field(default=None, max_length=64)
    unidade_medida: str = Field(default="un", max_length=10)
    custo_medio: float = Field(default=0, ge=0)
    preco_venda: float | None = Field(default=None, ge=0)
    marca: str | None = Field(default=None, max_length=120)
    ncm: str | None = Field(default=None, max_length=20)
    imagem_url: str | None = Field(default=None, max_length=2048)
    controla_lote: bool = Field(default=False)
    estoque_minimo: float = Field(default=0, ge=0)
    estoque_maximo: float | None = Field(default=None, ge=0)
    # Campos livres do segmento (ex: validade, sabor) — validados contra o
    # segment_config do tenant na camada de service, não aqui.
    campos_customizados: dict = Field(default_factory=dict)

    @field_validator("nome")
    @classmethod
    def sanitize_nome(cls, v: str) -> str:
        # Remove caracteres de controle; a sanitização contra XSS/SQLi "de verdade"
        # vem de: (1) ORM parametrizado — nunca SQL string concatenada, e
        # (2) escaping automático no frontend ao renderizar.
        cleaned = "".join(ch for ch in v if ch.isprintable())
        if not cleaned.strip():
            raise ValueError("Nome não pode ser vazio ou conter apenas caracteres inválidos.")
        return cleaned.strip()

    @field_validator("sku")
    @classmethod
    def normalizar_sku(cls, v: str | None) -> str | None:
        # SKU é um código interno curto — normaliza para maiúsculas/sem
        # espaços nas pontas pra evitar duplicatas "silenciosas" tipo
        # "abc-01" vs "ABC-01 ". String vazia é tratada como "não informado".
        if v is None:
            return v
        cleaned = v.strip().upper()
        return cleaned or None

    @field_validator("estoque_maximo")
    @classmethod
    def maximo_maior_que_minimo(cls, v, info):
        minimo = info.data.get("estoque_minimo")
        if v is not None and minimo is not None and v < minimo:
            raise ValueError("estoque_maximo não pode ser menor que estoque_minimo.")
        return v


class ProdutoCreate(ProdutoBase):
    pass


class ProdutoUpdate(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=200)
    sku: str | None = Field(default=None, max_length=60)
    categoria_id: UUID | None = None
    codigo_barras: str | None = None
    custo_medio: float | None = Field(default=None, ge=0)
    preco_venda: float | None = Field(default=None, ge=0)
    marca: str | None = Field(default=None, max_length=120)
    ncm: str | None = Field(default=None, max_length=20)
    imagem_url: str | None = Field(default=None, max_length=2048)
    controla_lote: bool | None = None
    estoque_minimo: float | None = Field(default=None, ge=0)
    estoque_maximo: float | None = Field(default=None, ge=0)
    campos_customizados: dict | None = None
    ativo: bool | None = None

    @field_validator("sku")
    @classmethod
    def normalizar_sku(cls, v: str | None) -> str | None:
        if v is None:
            return v
        cleaned = v.strip().upper()
        return cleaned or None


class ProdutoOut(ProdutoBase):
    id: UUID
    tenant_id: UUID
    ativo: bool
    criado_em: datetime

    model_config = {"from_attributes": True}


# --- Painel da tela de Produtos (Etapa 12) ---------------------------------
#
# Endpoint dedicado (GET /produtos/painel), separado do GET /produtos "cru"
# que várias outras telas (Vendas, Compras, Inventário, Movimentação,
# Relatórios) já usam pra popular dropdowns de seleção de produto — mudar o
# contrato de GET /produtos quebraria as 5 de uma vez. Mesmo padrão já usado
# em /estoque/painel.

class OpcaoFiltroProduto(BaseModel):
    id: UUID
    nome: str


class FiltrosProdutoOut(BaseModel):
    categorias: list[OpcaoFiltroProduto]


class ProdutoListaItemOut(BaseModel):
    id: UUID
    nome: str
    sku: str | None
    categoria_id: UUID | None
    categoria_nome: str | None
    codigo_barras: str | None
    unidade_medida: str
    custo_medio: float
    preco_venda: float | None
    margem_percentual: float | None
    marca: str | None
    ncm: str | None
    imagem_url: str | None
    controla_lote: bool
    estoque_minimo: float
    estoque_maximo: float | None
    ativo: bool
    criado_em: datetime


class PainelProdutosOut(BaseModel):
    itens: list[ProdutoListaItemOut]
    filtros: FiltrosProdutoOut
    total: int
    pagina: int
    tamanho: int
