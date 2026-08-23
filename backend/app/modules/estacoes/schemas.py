from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# Janela de heartbeat: acima disso sem atividade, a estação é considerada
# offline. Polling combinado ficou definido em 5-8s — 20s cobre até 2-3
# ciclos perdidos (ex: aba jogada pra segundo plano pelo navegador) sem
# marcar como offline por uma flutuação normal.
JANELA_ONLINE_SEGUNDOS = 20


class EstacaoImpressaoBase(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    impressora_nome: str = Field(min_length=1, max_length=200)

    @field_validator("nome", "impressora_nome")
    @classmethod
    def sanitize(cls, v: str) -> str:
        cleaned = "".join(ch for ch in v if ch.isprintable()).strip()
        if not cleaned:
            raise ValueError("Campo não pode ser vazio ou conter apenas caracteres inválidos.")
        return cleaned


class EstacaoImpressaoCreate(EstacaoImpressaoBase):
    pass


class EstacaoImpressaoUpdate(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=120)
    impressora_nome: str | None = Field(default=None, min_length=1, max_length=200)


class EstacaoImpressaoOut(BaseModel):
    id: UUID
    nome: str
    impressora_nome: str
    online: bool
    ultima_atividade_em: datetime | None
    criado_em: datetime

    model_config = {"from_attributes": True}


class EstacaoImpressaoRegistradaOut(EstacaoImpressaoOut):
    """Retornado só na criação — único momento em que o token bruto existe
    fora do banco. Depois disso, irrecuperável (nem o backend o guarda)."""

    token: str


class FilaImpressaoCreate(BaseModel):
    estacao_id: UUID
    produto_id: UUID | None = None
    titulo: str = Field(min_length=1, max_length=200)
    quantidade: int = Field(default=1, ge=1, le=500)
    payload_json: dict = Field(default_factory=dict)

    @field_validator("payload_json")
    @classmethod
    def limitar_tamanho_payload(cls, v: dict) -> dict:
        import json

        if len(json.dumps(v)) > 200_000:  # HTML de etiqueta em lote pode ser maior que config_json
            raise ValueError("Payload de impressão excede o tamanho permitido.")
        return v


class FilaImpressaoOut(BaseModel):
    id: UUID
    estacao_id: UUID
    estacao_nome: str
    produto_id: UUID | None
    titulo: str
    quantidade: int
    status: str
    enviado_por_nome: str | None
    criado_em: datetime
    atualizado_em: datetime

    model_config = {"from_attributes": True}


class FilaImpressaoPendenteOut(BaseModel):
    """Formato enxuto entregue à própria estação — sem metadados de quem
    enviou (a estação não precisa disso pra imprimir)."""

    id: UUID
    titulo: str
    quantidade: int
    payload_json: dict
    criado_em: datetime

    model_config = {"from_attributes": True}
