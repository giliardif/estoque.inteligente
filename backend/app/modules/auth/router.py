from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db_auth
from app.core.rate_limit import limiter
from app.core.security import CurrentUser, get_current_user
from app.modules.auth import service
from app.modules.auth.schemas import AccessTokenOut, LoginInput, RegistrarTenantInput

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 dias, mesmo prazo do token no banco


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    # httpOnly: inacessível via JavaScript (mitiga roubo por XSS)
    # secure: só trafega em HTTPS (deve ser True sempre em staging/produção)
    # samesite=strict: não é enviado em requisições cross-site (mitiga CSRF)
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=settings.is_production or settings.ENV == "staging",
        samesite="strict",
        max_age=REFRESH_COOKIE_MAX_AGE,
        path="/api/v1/auth",  # cookie só é enviado para rotas de auth, não pra API toda
    )


@router.post("/register", status_code=201)
async def registrar(payload: RegistrarTenantInput, db: AsyncSession = Depends(get_db_auth)):
    user = await service.registrar_tenant(db, payload)
    return {"tenant_id": user.tenant_id, "user_id": user.id}


@router.post("/login", response_model=AccessTokenOut)
@limiter.limit(settings.RATE_LIMIT_AUTH)  # mais restritivo que o default da API — soma-se ao lockout de conta
async def login(request: Request, response: Response, payload: LoginInput, db: AsyncSession = Depends(get_db_auth)):
    access_token, refresh_token = await service.login(db, payload)
    _set_refresh_cookie(response, refresh_token)
    return AccessTokenOut(access_token=access_token)


@router.post("/refresh", response_model=AccessTokenOut)
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db_auth)):
    refresh_token_bruto = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_token_bruto:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão expirada, faça login novamente.")

    access_token, novo_refresh = await service.renovar_token(db, refresh_token_bruto)
    _set_refresh_cookie(response, novo_refresh)
    return AccessTokenOut(access_token=access_token)


@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_auth),
):
    await service.revogar_todos_tokens(db, user.id)
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/api/v1/auth")
