from uuid import UUID

from pydantic import BaseModel, Field, field_validator


def _normalizar(v: str | None) -> str | None:
    if v is None:
        return v
    limpo = "".join(ch for ch in v if ch.isprintable()).strip()
    return limpo or None


# --- Categoria ---------------------------------------------------------

class CategoriaCreate(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    categoria_pai_id: UUID | None = None

    @field_validator("nome")
    @classmethod
    def sanitizar_nome(cls, v: str) -> str:
        limpo = _normalizar(v)
        if not limpo:
            raise ValueError("Nome não pode ficar vazio.")
        return limpo


class CategoriaUpdate(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=120)
    categoria_pai_id: UUID | None = None

    @field_validator("nome")
    @classmethod
    def sanitizar_nome(cls, v: str | None) -> str | None:
        return _normalizar(v)


class CategoriaOut(BaseModel):
    id: UUID
    nome: str
    categoria_pai_id: UUID | None

    model_config = {"from_attributes": True}


# --- Depósito ------------------------------------------------------------

class DepositoCreate(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    endereco: str | None = Field(default=None, max_length=2000)

    @field_validator("nome")
    @classmethod
    def sanitizar_nome(cls, v: str) -> str:
        limpo = _normalizar(v)
        if not limpo:
            raise ValueError("Nome não pode ficar vazio.")
        return limpo

    @field_validator("endereco")
    @classmethod
    def sanitizar_endereco(cls, v: str | None) -> str | None:
        return _normalizar(v)


class DepositoUpdate(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=120)
    endereco: str | None = None

    @field_validator("nome")
    @classmethod
    def sanitizar_nome(cls, v: str | None) -> str | None:
        return _normalizar(v)

    @field_validator("endereco")
    @classmethod
    def sanitizar_endereco(cls, v: str | None) -> str | None:
        return _normalizar(v)


class DepositoOut(BaseModel):
    id: UUID
    nome: str
    endereco: str | None

    model_config = {"from_attributes": True}


# --- Fornecedor ------------------------------------------------------------

class FornecedorCreate(BaseModel):
    nome: str = Field(min_length=2, max_length=200)
    documento: str | None = Field(default=None, max_length=20)
    contato: str | None = Field(default=None, max_length=200)

    @field_validator("nome")
    @classmethod
    def sanitizar_nome(cls, v: str) -> str:
        limpo = _normalizar(v)
        if not limpo:
            raise ValueError("Nome não pode ficar vazio.")
        return limpo

    @field_validator("documento", "contato")
    @classmethod
    def sanitizar_texto(cls, v: str | None) -> str | None:
        return _normalizar(v)


class FornecedorUpdate(BaseModel):
    nome: str | None = Field(default=None, min_length=2, max_length=200)
    documento: str | None = None
    contato: str | None = None

    @field_validator("nome", "documento", "contato")
    @classmethod
    def sanitizar_texto(cls, v: str | None) -> str | None:
        return _normalizar(v)


class FornecedorOut(BaseModel):
    id: UUID
    nome: str
    documento: str | None
    contato: str | None

    model_config = {"from_attributes": True}
