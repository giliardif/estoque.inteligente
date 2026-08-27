from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

PERFIS_VALIDOS = {"admin", "operador", "leitura"}


class UsuarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    nome: str
    email: str
    perfil: str
    ativo: bool
    avatar_url: str | None = None
    criado_em: datetime


class UsuarioCreate(BaseModel):
    nome: str = Field(min_length=2, max_length=200)
    email: EmailStr
    perfil: str

    @field_validator("perfil")
    @classmethod
    def perfil_valido(cls, v: str) -> str:
        if v not in PERFIS_VALIDOS:
            raise ValueError("Perfil deve ser admin, operador ou leitura.")
        return v


class UsuarioCreateResult(BaseModel):
    usuario: UsuarioOut
    senha_provisoria: str  # exibida apenas nesta resposta — nunca fica recuperável depois


class UsuarioMeUpdate(BaseModel):
    """Separado de UsuarioUpdate de propósito: são superfícies de permissão
    diferentes (autoatendimento vs. admin gerenciando outro usuário) — um
    campo `nome` aqui nunca deve ganhar `perfil`/`ativo` por engano só
    porque parece "mais completo"."""

    nome: str = Field(min_length=2, max_length=200)


class UsuarioUpdate(BaseModel):
    # Campos opcionais: PATCH parcial. Ao menos um deve ser enviado (validado no service).
    perfil: str | None = None
    ativo: bool | None = None

    @field_validator("perfil")
    @classmethod
    def perfil_valido(cls, v: str | None) -> str | None:
        if v is not None and v not in PERFIS_VALIDOS:
            raise ValueError("Perfil deve ser admin, operador ou leitura.")
        return v
