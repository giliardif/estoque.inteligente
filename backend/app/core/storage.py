"""
Cliente mínimo pro Supabase Storage, via REST direto (httpx), em vez de
adicionar a dependência supabase-py só pra isso. Usado hoje só pra imagem
de produto — se o projeto crescer o uso de Storage, vale revisitar.

SERVICE_ROLE_KEY nunca deve ser usada fora do backend (bypassa RLS do
Storage). O isolamento por tenant aqui é feito pelo PATH do objeto
(`{tenant_id}/{produto_id}/{arquivo}`), não por RLS do bucket.
"""
import uuid

import httpx
from fastapi import HTTPException, UploadFile, status

from app.core.config import get_settings

EXTENSOES_PERMITIDAS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


async def enviar_imagem_produto(*, tenant_id: uuid.UUID, produto_id: uuid.UUID, arquivo: UploadFile) -> str:
    settings = get_settings()

    # Validações de entrada primeiro (não dependem de infraestrutura externa
    # configurada) — arquivo inválido deve falhar do mesmo jeito com ou sem
    # Supabase configurado, em vez de mascarar tudo atrás de um 503.
    content_type = arquivo.content_type or ""
    extensao = EXTENSOES_PERMITIDAS.get(content_type)
    if not extensao:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Formato de imagem não suportado. Use JPEG, PNG ou WebP.",
        )

    conteudo = await arquivo.read()
    limite_bytes = settings.MAX_IMAGEM_PRODUTO_SIZE_MB * 1024 * 1024
    if len(conteudo) > limite_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Imagem excede o limite de {settings.MAX_IMAGEM_PRODUTO_SIZE_MB}MB.",
        )

    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Upload de imagem não está configurado neste ambiente.",
        )

    caminho = f"{tenant_id}/{produto_id}/{uuid.uuid4()}.{extensao}"
    url_upload = (
        f"{settings.SUPABASE_URL}/storage/v1/object/{settings.SUPABASE_STORAGE_BUCKET}/{caminho}"
    )

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            url_upload,
            content=conteudo,
            headers={
                "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                "Content-Type": content_type,
                "x-upsert": "false",
            },
        )

    if resp.status_code not in (200, 201):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Falha ao enviar imagem para o armazenamento.",
        )

    return f"{settings.SUPABASE_URL}/storage/v1/object/public/{settings.SUPABASE_STORAGE_BUCKET}/{caminho}"
