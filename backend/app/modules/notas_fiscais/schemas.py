from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class NotaFiscalResumoOut(BaseModel):
    # Versão enxuta pra listagem — não carrega os itens (podem ser dezenas por
    # nota); a tela de detalhe busca os itens separadamente via
    # GET /notas-fiscais/{id}/itens, já existente.
    id: UUID
    numero: str
    status: str
    criado_em: datetime
    fornecedor_nome: str | None
    itens_pendentes: int


class NotaFiscalItemOut(BaseModel):
    id: UUID
    descricao_xml: str
    codigo_ean_xml: str | None
    produto_id: UUID | None
    quantidade: float
    valor_unitario: float
    status_match: str

    model_config = {"from_attributes": True}


class NotaFiscalOut(BaseModel):
    id: UUID
    numero: str
    status: str
    itens: list[NotaFiscalItemOut]

    model_config = {"from_attributes": True}


class ConfirmarItemPayload(BaseModel):
    # Usado quando o item ficou "pendente_cadastro": o operador vincula a um
    # produto já existente OU indica que deve ser ignorado (não é estoque).
    produto_id: UUID | None = None
    ignorar: bool = False


# --- Painel da tela de Notas Fiscais (Etapa 18) -----------------------------
#
# Endpoint dedicado (GET /notas-fiscais/painel), separado do GET /notas-fiscais
# "cru" já existente — mesmo padrão usado em /estoque/painel, /produtos/painel
# e /vendas/painel. KPIs sempre refletem o total do tenant, sem aplicar
# busca/status (mesmo princípio já usado nas outras telas com kit de UX).

class KpisNotasFiscaisOut(BaseModel):
    total_notas: int
    itens_pendentes_confirmacao: int
    valor_total_importado: float
    fornecedores_distintos: int


class OpcaoFiltroFornecedor(BaseModel):
    id: UUID
    nome: str


class FiltrosNotasFiscaisOut(BaseModel):
    fornecedores: list[OpcaoFiltroFornecedor]


class PainelNotasFiscaisOut(BaseModel):
    kpis: KpisNotasFiscaisOut
    filtros: FiltrosNotasFiscaisOut
    itens: list[NotaFiscalResumoOut]
    total: int
    pagina: int
    tamanho: int
