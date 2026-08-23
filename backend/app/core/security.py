"""
Segurança: hashing de senha (argon2), emissão/validação de JWT,
e dependência de autenticação com escopo de tenant.
"""
import hashlib
import hmac
import secrets

from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from app.core.config import get_settings

settings = get_settings()

# Argon2 em vez de bcrypt puro: resistente a GPU cracking, recomendação OWASP atual
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=True)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def validar_forca_senha(senha: str) -> None:
    """Chamada explicitamente no cadastro/troca de senha (não é um validador
    Pydantic solto, para a mensagem de erro poder ser específica ao contexto)."""
    if len(senha) < 10:
        raise ValueError("Senha deve ter pelo menos 10 caracteres.")
    if senha.lower() == senha or senha.upper() == senha:
        raise ValueError("Senha deve combinar letras maiúsculas e minúsculas.")
    if not any(ch.isdigit() for ch in senha):
        raise ValueError("Senha deve conter pelo menos um número.")


def gerar_refresh_token_bruto() -> str:
    # Token opaco de alta entropia — não é JWT. Só o hash dele vai para o banco.
    return secrets.token_urlsafe(48)


_SENHA_MAIUSC = "ABCDEFGHJKLMNPQRSTUVWXYZ"  # sem I/O — evita confusão visual ao repassar por fora
_SENHA_MINUSC = "abcdefghijkmnpqrstuvwxyz"
_SENHA_DIGITOS = "23456789"


def gerar_senha_provisoria() -> str:
    """Gera senha aleatória que satisfaz validar_forca_senha garantidamente
    (mistura de maiúsculas/minúsculas + número), usada no convite de usuário.
    Caracteres ambíguos (I, O, l, 0, 1) excluídos por ser repassada manualmente."""
    alfabeto = _SENHA_MAIUSC + _SENHA_MINUSC + _SENHA_DIGITOS
    while True:
        candidata = "".join(secrets.choice(alfabeto) for _ in range(12))
        tem_maiusc = any(c in _SENHA_MAIUSC for c in candidata)
        tem_minusc = any(c in _SENHA_MINUSC for c in candidata)
        tem_digito = any(c in _SENHA_DIGITOS for c in candidata)
        if tem_maiusc and tem_minusc and tem_digito:
            return candidata


def hash_refresh_token(token_bruto: str) -> str:
    return pwd_context.hash(token_bruto)


def verificar_refresh_token(token_bruto: str, token_hash: str) -> bool:
    return pwd_context.verify(token_bruto, token_hash)


def gerar_token_estacao_bruto() -> str:
    """Token opaco de alta entropia entregue UMA VEZ ao admin no registro
    da estação — o backend nunca guarda o valor bruto, só o hash de lookup."""
    return secrets.token_urlsafe(48)


def hash_lookup_token_estacao(token_bruto: str) -> str:
    """HMAC-SHA256 determinístico (chaveado com SECRET_KEY), não argon2.

    Diferente de refresh_tokens de usuário (verificados raramente, só no
    login/renovação), o token de estação é checado a cada ciclo de
    polling (5-8s) de CADA estação ativa — rodar argon2.verify em loop
    contra todas as linhas do banco a cada poll não escala com o número
    de tenants/estações. HMAC permite lookup indexado O(1) por igualdade
    exata (`WHERE token_lookup_hash = :hash`), com segurança prática
    equivalente: impossível forjar sem conhecer a SECRET_KEY do servidor.
    """
    return hmac.new(
        settings.SECRET_KEY.encode(), token_bruto.encode(), hashlib.sha256
    ).hexdigest()


class CurrentEstacao(BaseModel):
    """Identidade de uma Estação de Impressão autenticada — nunca carrega
    perfil/permissão de usuário humano, só o escopo mínimo (tenant + a
    própria estação) que os endpoints de fila precisam."""

    id: UUID
    tenant_id: UUID
    nome: str


class TokenPayload(BaseModel):
    sub: str          # user_id
    tenant_id: str     # escopo de tenant obrigatório em todo token
    perfil: str         # admin | operador | leitura
    nome: str = ""
    deve_trocar_senha: bool = False
    exp: datetime


def create_access_token(
    user_id: UUID, tenant_id: UUID, perfil: str, nome: str = "", deve_trocar_senha: bool = False
) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "tenant_id": str(tenant_id),
        "perfil": perfil,
        "nome": nome,
        "deve_trocar_senha": deve_trocar_senha,
        "exp": expire,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> TokenPayload:
    try:
        raw = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return TokenPayload(**raw)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciais inválidas ou expiradas",
            headers={"WWW-Authenticate": "Bearer"},
        )


class CurrentUser(BaseModel):
    id: UUID
    tenant_id: UUID
    perfil: str
    nome: str = ""


def get_current_user(token: str = Depends(oauth2_scheme)) -> CurrentUser:
    payload = decode_token(token)
    return CurrentUser(
        id=UUID(payload.sub), tenant_id=UUID(payload.tenant_id), perfil=payload.perfil, nome=payload.nome
    )


def require_perfil(*perfis_permitidos: str):
    """Dependência para restringir endpoints por perfil (admin/operador/leitura)."""
    def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.perfil not in perfis_permitidos:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Seu perfil não tem permissão para esta ação.",
            )
        return user
    return checker
