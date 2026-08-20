"""
Regra: toda query filtra por tenant_id explicitamente, mesmo já havendo RLS
no banco. RLS é a última linha de defesa — o filtro explícito aqui evita
depender só dela e deixa a intenção clara no código (defesa em profundidade).
"""
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Categoria, Produto  # SQLAlchemy model (núcleo genérico)
from app.modules.produtos.importacao import _parse_decimal, parsear_planilha
from app.modules.produtos.schemas import (
    ProdutoCreate, ProdutoImportItemOut, ProdutoImportLinhaEntrada,
    ProdutoImportPreviewOut, ProdutoImportResultadoOut, ProdutoUpdate,
)


async def listar(db: AsyncSession, *, tenant_id: UUID, busca: str | None, pagina: int, tamanho: int):
    stmt = select(Produto).where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True))
    if busca:
        # ilike parametrizado — nunca concatenar string em SQL.
        # Busca unificada: nome, sku ou código de barras num só campo,
        # já que na prática o usuário digita qualquer um dos três sem
        # saber (ou se importar) qual é qual.
        termo = f"%{busca}%"
        stmt = stmt.where(
            or_(
                Produto.nome.ilike(termo),
                Produto.sku.ilike(termo),
                Produto.codigo_barras.ilike(termo),
            )
        )
    stmt = stmt.offset((pagina - 1) * tamanho).limit(tamanho)
    result = await db.execute(stmt)
    return result.scalars().all()


async def obter(db: AsyncSession, *, tenant_id: UUID, produto_id: UUID):
    stmt = select(Produto).where(Produto.id == produto_id, Produto.tenant_id == tenant_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def criar(db: AsyncSession, *, tenant_id: UUID, dados: ProdutoCreate):
    produto = Produto(tenant_id=tenant_id, **dados.model_dump())
    db.add(produto)
    await db.commit()
    await db.refresh(produto)
    return produto


async def atualizar(db: AsyncSession, *, tenant_id: UUID, produto_id: UUID, dados: ProdutoUpdate):
    produto = await obter(db, tenant_id=tenant_id, produto_id=produto_id)
    if not produto:
        return None
    for campo, valor in dados.model_dump(exclude_unset=True).items():
        setattr(produto, campo, valor)
    await db.commit()
    await db.refresh(produto)
    return produto


async def definir_imagem(db: AsyncSession, *, tenant_id: UUID, produto_id: UUID, imagem_url: str):
    produto = await obter(db, tenant_id=tenant_id, produto_id=produto_id)
    if not produto:
        return None
    produto.imagem_url = imagem_url
    await db.commit()
    await db.refresh(produto)
    return produto


async def desativar(db: AsyncSession, *, tenant_id: UUID, produto_id: UUID) -> bool:
    stmt = (
        update(Produto)
        .where(Produto.id == produto_id, Produto.tenant_id == tenant_id)
        .values(ativo=False)
    )
    result = await db.execute(stmt)
    await db.commit()
    return result.rowcount > 0


ORDENAVEIS_PAINEL = {
    "nome": Produto.nome,
    "sku": Produto.sku,
    "custo_medio": Produto.custo_medio,
    "preco_venda": Produto.preco_venda,
    "estoque_minimo": Produto.estoque_minimo,
    "criado_em": Produto.criado_em,
}


def calcular_margem_percentual(custo_medio: float, preco_venda: float | None) -> float | None:
    """
    Margem sobre o preço de venda: (venda - custo) / venda * 100.
    Nunca persistida — sempre derivada em runtime de custo_medio e
    preco_venda, pra nunca divergir do que os dois campos realmente valem.
    None quando não há preço de venda definido ou ele é zero (divisão
    indefinida).
    """
    if not preco_venda:
        return None
    return round((preco_venda - custo_medio) / preco_venda * 100, 2)


async def painel(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    busca: str | None = None,
    categoria_id: UUID | None = None,
    status_ativo: bool | None = True,
    ordenar_por: str = "nome",
    direcao: str = "asc",
    pagina: int = 1,
    tamanho: int = 25,
) -> dict:
    """
    Alimenta a tela de Produtos com o kit de UX (busca, filtro de categoria,
    ordenação de coluna, paginação real). Mantido separado de `listar()`
    (usado por GET /produtos "cru", que 5 outras telas já consomem como
    dropdown de seleção) — mudar o contrato de lá quebraria todas elas.
    """
    stmt = (
        select(
            Produto.id, Produto.nome, Produto.sku, Produto.categoria_id, Categoria.nome.label("categoria_nome"),
            Produto.codigo_barras, Produto.unidade_medida, Produto.custo_medio, Produto.preco_venda,
            Produto.marca, Produto.ncm, Produto.imagem_url, Produto.controla_lote,
            Produto.estoque_minimo, Produto.estoque_maximo, Produto.ativo, Produto.criado_em,
        )
        .outerjoin(Categoria, Categoria.id == Produto.categoria_id)
        .where(Produto.tenant_id == tenant_id)
    )
    if status_ativo is not None:
        stmt = stmt.where(Produto.ativo.is_(status_ativo))
    if categoria_id:
        stmt = stmt.where(Produto.categoria_id == categoria_id)
    if busca:
        termo = f"%{busca}%"
        stmt = stmt.where(or_(Produto.nome.ilike(termo), Produto.sku.ilike(termo), Produto.codigo_barras.ilike(termo)))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    coluna = ORDENAVEIS_PAINEL.get(ordenar_por, Produto.nome)
    stmt = stmt.order_by(coluna.desc() if direcao == "desc" else coluna.asc())
    stmt = stmt.offset((pagina - 1) * tamanho).limit(tamanho)

    linhas = (await db.execute(stmt)).all()
    itens = [
        {
            "id": row.id, "nome": row.nome, "sku": row.sku, "categoria_id": row.categoria_id,
            "categoria_nome": row.categoria_nome, "codigo_barras": row.codigo_barras,
            "unidade_medida": row.unidade_medida, "custo_medio": float(row.custo_medio),
            "preco_venda": float(row.preco_venda) if row.preco_venda is not None else None,
            "margem_percentual": calcular_margem_percentual(
                float(row.custo_medio), float(row.preco_venda) if row.preco_venda is not None else None
            ),
            "marca": row.marca, "ncm": row.ncm, "imagem_url": row.imagem_url, "controla_lote": row.controla_lote,
            "estoque_minimo": float(row.estoque_minimo),
            "estoque_maximo": float(row.estoque_maximo) if row.estoque_maximo is not None else None,
            "ativo": row.ativo, "criado_em": row.criado_em,
        }
        for row in linhas
    ]

    categorias = (
        await db.execute(select(Categoria.id, Categoria.nome).where(Categoria.tenant_id == tenant_id).order_by(Categoria.nome))
    ).all()

    return {
        "itens": itens,
        "filtros": {"categorias": [{"id": i, "nome": n} for i, n in categorias]},
        "total": total, "pagina": pagina, "tamanho": tamanho,
    }


# --- Import em massa via planilha (Etapa 26) --------------------------------

def _validar_campos_linha(bruta: dict) -> tuple[dict | None, str | None]:
    """
    Valida e normaliza uma linha crua (dict com valores possivelmente não
    tipados, vindos direto do parser de planilha ou reenviados pelo
    frontend no passo de confirmação). Retorna (dados_normalizados, None)
    em caso de sucesso, ou (None, mensagem_de_erro).
    """
    nome_bruto = bruta.get("nome")
    nome = "".join(ch for ch in str(nome_bruto or "") if ch.isprintable()).strip()
    if not nome:
        return None, "Nome é obrigatório."
    if len(nome) > 200:
        return None, "Nome excede 200 caracteres."

    sku = bruta.get("sku")
    sku = str(sku).strip().upper() if sku not in (None, "") else None
    if sku and len(sku) > 60:
        return None, "SKU excede 60 caracteres."

    categoria = bruta.get("categoria")
    categoria = str(categoria).strip() if categoria not in (None, "") else None
    if categoria and len(categoria) > 120:
        return None, "Nome da categoria excede 120 caracteres."

    codigo_barras = bruta.get("codigo_barras")
    codigo_barras = str(codigo_barras).strip() if codigo_barras not in (None, "") else None
    if codigo_barras and len(codigo_barras) > 64:
        return None, "Código de barras excede 64 caracteres."

    unidade_medida = bruta.get("unidade_medida")
    unidade_medida = str(unidade_medida).strip() if unidade_medida not in (None, "") else "un"
    if len(unidade_medida) > 10:
        return None, "Unidade de medida excede 10 caracteres."

    marca = bruta.get("marca")
    marca = str(marca).strip() if marca not in (None, "") else None
    if marca and len(marca) > 120:
        return None, "Marca excede 120 caracteres."

    ncm = bruta.get("ncm")
    ncm = str(ncm).strip() if ncm not in (None, "") else None
    if ncm and len(ncm) > 20:
        return None, "NCM excede 20 caracteres."

    try:
        custo_medio = _parse_decimal(bruta.get("custo_medio")) or 0.0
        preco_venda = _parse_decimal(bruta.get("preco_venda"))
        estoque_minimo = _parse_decimal(bruta.get("estoque_minimo")) or 0.0
        estoque_maximo = _parse_decimal(bruta.get("estoque_maximo"))
    except ValueError as exc:
        return None, str(exc)

    if custo_medio < 0 or estoque_minimo < 0:
        return None, "Valores numéricos não podem ser negativos."
    if preco_venda is not None and preco_venda < 0:
        return None, "Preço de venda não pode ser negativo."
    if estoque_maximo is not None and estoque_maximo < 0:
        return None, "Estoque máximo não pode ser negativo."
    if estoque_maximo is not None and estoque_maximo < estoque_minimo:
        return None, "Estoque máximo não pode ser menor que o estoque mínimo."

    return {
        "nome": nome, "sku": sku, "categoria": categoria, "codigo_barras": codigo_barras,
        "unidade_medida": unidade_medida, "custo_medio": custo_medio, "preco_venda": preco_venda,
        "marca": marca, "ncm": ncm, "estoque_minimo": estoque_minimo, "estoque_maximo": estoque_maximo,
    }, None


async def _categorias_por_nome(db: AsyncSession, *, tenant_id: UUID) -> dict[str, Categoria]:
    result = await db.execute(select(Categoria).where(Categoria.tenant_id == tenant_id))
    return {c.nome.strip().lower(): c for c in result.scalars().all()}


async def _skus_existentes(db: AsyncSession, *, tenant_id: UUID) -> set[str]:
    result = await db.execute(
        select(Produto.sku).where(Produto.tenant_id == tenant_id, Produto.sku.is_not(None))
    )
    return {sku for (sku,) in result.all()}


async def _processar_linhas(
    db: AsyncSession, *, tenant_id: UUID, linhas_brutas: list[dict]
) -> tuple[list[ProdutoImportItemOut], set[str]]:
    """
    Valida cada linha de forma independente (uma linha inválida não afeta
    as outras) e detecta: SKU já existente no tenant, SKU duplicado dentro
    da própria planilha, e categorias que precisarão ser criadas.
    Consulta categorias/SKUs existentes UMA vez para o lote inteiro, não
    por linha, pra evitar N+1.
    """
    categorias_existentes = await _categorias_por_nome(db, tenant_id=tenant_id)
    skus_existentes = await _skus_existentes(db, tenant_id=tenant_id)

    itens: list[ProdutoImportItemOut] = []
    skus_vistos_no_arquivo: set[str] = set()
    categorias_novas: set[str] = set()

    for bruta in linhas_brutas:
        numero_linha = bruta.get("linha")
        dados, erro = _validar_campos_linha(bruta)
        if erro:
            itens.append(ProdutoImportItemOut(linha=numero_linha, status="erro", erro=erro))
            continue

        entrada = ProdutoImportLinhaEntrada(linha=numero_linha, **dados)

        if dados["sku"]:
            if dados["sku"] in skus_existentes:
                itens.append(ProdutoImportItemOut(
                    linha=numero_linha, status="erro",
                    erro=f"SKU '{dados['sku']}' já existe cadastrado.", dados=entrada,
                ))
                continue
            if dados["sku"] in skus_vistos_no_arquivo:
                itens.append(ProdutoImportItemOut(
                    linha=numero_linha, status="erro",
                    erro=f"SKU '{dados['sku']}' duplicado dentro da própria planilha.", dados=entrada,
                ))
                continue
            skus_vistos_no_arquivo.add(dados["sku"])

        categoria_sera_criada = False
        if dados["categoria"] and dados["categoria"].lower() not in categorias_existentes:
            categoria_sera_criada = True
            categorias_novas.add(dados["categoria"])

        itens.append(ProdutoImportItemOut(
            linha=numero_linha, status="ok", dados=entrada, categoria_sera_criada=categoria_sera_criada,
        ))

    return itens, categorias_novas


async def preview_importacao(
    db: AsyncSession, *, tenant_id: UUID, nome_arquivo: str, conteudo: bytes, max_linhas: int
) -> ProdutoImportPreviewOut:
    linhas_brutas = parsear_planilha(nome_arquivo=nome_arquivo, conteudo=conteudo)
    if not linhas_brutas:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A planilha não contém nenhuma linha de dados.",
        )
    if len(linhas_brutas) > max_linhas:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"A planilha excede o limite de {max_linhas} linhas por importação.",
        )

    itens, categorias_novas = await _processar_linhas(db, tenant_id=tenant_id, linhas_brutas=linhas_brutas)
    total_validas = sum(1 for i in itens if i.status == "ok")
    return ProdutoImportPreviewOut(
        itens=itens, total_linhas=len(itens), total_validas=total_validas,
        total_com_erro=len(itens) - total_validas, categorias_novas=sorted(categorias_novas),
    )


async def confirmar_importacao(
    db: AsyncSession, *, tenant_id: UUID, linhas: list[ProdutoImportLinhaEntrada]
) -> ProdutoImportResultadoOut:
    """
    Revalida cada linha do zero contra o estado ATUAL do banco (SKU e
    categoria podem ter mudado desde o preview — ex: outro usuário
    cadastrou o mesmo SKU nesse meio-tempo) e só então grava. Categorias
    novas são criadas uma única vez cada, mesmo que várias linhas usem o
    mesmo nome.
    """
    linhas_brutas = [
        {
            "linha": l.linha, "nome": l.nome, "sku": l.sku, "categoria": l.categoria,
            "codigo_barras": l.codigo_barras, "unidade_medida": l.unidade_medida,
            "custo_medio": l.custo_medio, "preco_venda": l.preco_venda, "marca": l.marca,
            "ncm": l.ncm, "estoque_minimo": l.estoque_minimo, "estoque_maximo": l.estoque_maximo,
        }
        for l in linhas
    ]
    itens, categorias_novas_nomes = await _processar_linhas(db, tenant_id=tenant_id, linhas_brutas=linhas_brutas)

    categorias_existentes = await _categorias_por_nome(db, tenant_id=tenant_id)
    for nome_categoria in categorias_novas_nomes:
        chave = nome_categoria.lower()
        if chave not in categorias_existentes:
            nova = Categoria(tenant_id=tenant_id, nome=nome_categoria)
            db.add(nova)
            await db.flush()
            categorias_existentes[chave] = nova

    criados = 0
    itens_finais: list[ProdutoImportItemOut] = []
    for item in itens:
        if item.status != "ok":
            itens_finais.append(item)
            continue

        dados = item.dados
        categoria_id = categorias_existentes[dados.categoria.lower()].id if dados.categoria else None

        produto = Produto(
            tenant_id=tenant_id, nome=dados.nome, sku=dados.sku, categoria_id=categoria_id,
            codigo_barras=dados.codigo_barras, unidade_medida=dados.unidade_medida or "un",
            custo_medio=dados.custo_medio or 0, preco_venda=dados.preco_venda,
            marca=dados.marca, ncm=dados.ncm,
            estoque_minimo=dados.estoque_minimo or 0, estoque_maximo=dados.estoque_maximo,
        )
        db.add(produto)
        await db.flush()
        criados += 1
        itens_finais.append(ProdutoImportItemOut(
            linha=item.linha, status="ok", dados=dados,
            categoria_sera_criada=item.categoria_sera_criada, produto_id=produto.id,
        ))

    await db.commit()

    return ProdutoImportResultadoOut(
        criados=criados, rejeitados=len(itens_finais) - criados,
        categorias_criadas=sorted(categorias_novas_nomes), itens=itens_finais,
    )
