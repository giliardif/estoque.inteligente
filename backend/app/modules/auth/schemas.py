from pydantic import BaseModel, EmailStr, Field, field_validator

from app.core.security import validar_forca_senha


class RegistrarTenantInput(BaseModel):
    nome_empresa: str = Field(min_length=2, max_length=200)
    segmento_slug: str = Field(min_length=2, max_length=50)
    admin_nome: str = Field(min_length=2, max_length=200)
    admin_email: EmailStr
    admin_senha: str

    @field_validator("admin_senha")
    @classmethod
    def senha_forte(cls, v: str) -> str:
        validar_forca_senha(v)  # levanta ValueError com mensagem específica se fraca
        return v


class LoginInput(BaseModel):
    email: EmailStr
    senha: str = Field(min_length=1, max_length=200)  # sem limite de força aqui — só formato


class AccessTokenOut(BaseModel):
    # refresh_token NÃO vai mais no corpo — é setado como cookie httpOnly
    # pelo router (ver modules/auth/router.py). Só o access_token, de vida
    # curta, é exposto ao JavaScript do frontend.
    access_token: str
    token_type: str = "bearer"


class TrocarSenhaInput(BaseModel):
    senha_atual: str
    senha_nova: str

    @field_validator("senha_nova")
    @classmethod
    def senha_forte(cls, v: str) -> str:
        validar_forca_senha(v)
        return v
