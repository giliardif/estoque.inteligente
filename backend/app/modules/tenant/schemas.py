import re
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


def validar_cnpj(cnpj: str) -> bool:
    """Valida CNPJ pelo algoritmo padrão de dígito verificador (não é só
    contagem de caracteres — CNPJ com 14 dígitos numéricos mas DV errado
    é rejeitado)."""
    digitos = re.sub(r"\D", "", cnpj)
    if len(digitos) != 14:
        return False
    if digitos == digitos[0] * 14:  # 14 dígitos iguais passa na contagem mas nunca é válido
        return False

    def _dv(parcial: str, pesos: list[int]) -> str:
        soma = sum(int(d) * p for d, p in zip(parcial, pesos))
        resto = soma % 11
        return "0" if resto < 2 else str(11 - resto)

    pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    dv1 = _dv(digitos[:12], pesos1)
    pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    dv2 = _dv(digitos[:12] + dv1, pesos2)
    return digitos[-2:] == dv1 + dv2


class TenantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    nome: str
    segmento_slug: str
    cnpj: str | None = None


class TenantUpdate(BaseModel):
    # Campos opcionais: PATCH parcial. Ao menos um deve ser enviado (validado no service).
    # segmento_slug não é editável aqui de propósito — é fixado no onboarding
    # e usado por outras partes do sistema (categorias padrão do segmento);
    # mudar depois é decisão de produto maior, fora de escopo desta etapa.
    nome: str | None = None
    cnpj: str | None = None

    @field_validator("nome")
    @classmethod
    def nome_nao_vazio(cls, v: str | None) -> str | None:
        if v is not None and len(v.strip()) < 2:
            raise ValueError("Nome do negócio deve ter ao menos 2 caracteres.")
        return v.strip() if v is not None else v

    @field_validator("cnpj")
    @classmethod
    def cnpj_valido(cls, v: str | None) -> str | None:
        if v is None or v.strip() == "":
            return None
        if not validar_cnpj(v):
            raise ValueError("CNPJ inválido.")
        return re.sub(r"\D", "", v)  # normaliza: guarda só dígitos
