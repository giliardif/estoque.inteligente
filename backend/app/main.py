from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings
from app.core.rate_limit import limiter
from app.modules.alertas.router import router as alertas_router
from app.modules.auth.router import router as auth_router
from app.modules.cadastros.router import router as cadastros_router
from app.modules.compras.router import router as compras_router
from app.modules.estacoes.router import router as estacoes_router
from app.modules.estoque.router import router as estoque_router
from app.modules.etiquetas.router import router as etiquetas_router
from app.modules.inteligencia.router import router as inteligencia_router
from app.modules.inventario.router import router as inventario_router
from app.modules.notas_fiscais.router import router as notas_fiscais_router
from app.modules.painel.router import router as painel_router
from app.modules.produtos.router import router as produtos_router
from app.modules.tenant.router import router as tenant_router
from app.modules.usuarios.router import router as usuarios_router
from app.modules.vendas.router import router as vendas_router

settings = get_settings()

app = FastAPI(
    title="Sistema de Gestão de Estoque — API",
    docs_url="/docs" if settings.docs_enabled else None,   # /docs desligado em produção
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — lista fechada por ambiente, nunca "*" (definida em ALLOWED_ORIGINS do .env)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Estacao-Token"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Headers de segurança recomendados pela OWASP Secure Headers Project."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
        return response


app.add_middleware(SecurityHeadersMiddleware)

app.include_router(auth_router, prefix="/api/v1")
app.include_router(produtos_router, prefix="/api/v1")
app.include_router(usuarios_router, prefix="/api/v1")
app.include_router(cadastros_router, prefix="/api/v1")
app.include_router(estoque_router, prefix="/api/v1")
app.include_router(inventario_router, prefix="/api/v1")
app.include_router(notas_fiscais_router, prefix="/api/v1")
app.include_router(vendas_router, prefix="/api/v1")
app.include_router(alertas_router, prefix="/api/v1")
app.include_router(compras_router, prefix="/api/v1")
app.include_router(painel_router, prefix="/api/v1")
app.include_router(etiquetas_router, prefix="/api/v1")
app.include_router(estacoes_router, prefix="/api/v1")
app.include_router(tenant_router, prefix="/api/v1")
app.include_router(inteligencia_router, prefix="/api/v1")
# módulo de relatórios (endpoints agregados/analíticos) é a próxima etapa


@app.get("/health")
async def health():
    # Endpoint de healthcheck sem dados sensíveis — usado por Railway/monitoramento
    return {"status": "ok", "env": settings.ENV}
