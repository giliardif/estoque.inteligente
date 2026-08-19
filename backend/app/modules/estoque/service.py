"""
Regra de negócio crítica: o saldo de um produto NUNCA pode ficar negativo.
Toda saída/ajuste-negativo é validada contra o saldo atual (calculado a
partir da soma de movimentações) DENTRO da mesma transação, para evitar
condição de corrida — dois operadores lançando saída ao mesmo tempo não
podem, juntos, zerar o estoque abaixo de 0.

A serialização real é feita por `_travar_saldo_produto` (advisory lock por
produto, ver docstring da função). O `.with_for_update()` dentro de
calcular_saldo_atual/calcular_saldo_por_deposito continua presente como
defesa em profundidade contra update/delete concorrente nas linhas já
existentes, mas sozinho NÃO é suficiente — não protege contra phantom
read de linhas novas inseridas por outra transação (bug real encontrado
e corrigido, ver DEVLOG).
"""
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import case, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    Categoria, Deposito, Fornecedor, Lote, Movimentacao, PedidoCompra,
    PedidoCompraItem, Produto,
)
from app.modules.estoque.schemas import MovimentacaoCreate

# Mesmo limiar usado em alertas.service.DEFAULTS["validade"]["dias_antes"].
# Duplicado aqui (em vez de importado) porque alertas.service já importa
# estoque.service — importar na direção contrária criaria um ciclo. Se um
# dia esse número mudar, precisa mudar nos dois lugares; comentário cruzado
# colocado em ambos.
DIAS_VENCIMENTO_PROXIMO = 5

# Produto "novo" pro badge de prioridade do painel de Estoque: cadastrado
# nos últimos N dias corridos. Não existe essa noção em nenhum outro lugar
# do sistema ainda — decisão tomada aqui, documentada no DEVLOG.
DIAS_PRODUTO_NOVO = 7


async def _travar_saldo_produto(db: AsyncSession, *, tenant_id: UUID, produto_id: UUID) -> None:
    """
    Serializa, por produto, o trecho "calcular saldo -> validar -> inserir
    movimentação" contra qualquer outra transação concorrente fazendo a
    mesma coisa para o MESMO produto.

    BUG REAL encontrado e corrigido: o `.with_for_update()` em
    calcular_saldo_atual/calcular_saldo_por_deposito trava as linhas de
    Movimentacao JÁ EXISTENTES contra update/delete concorrente — mas não
    protege contra leitura fantasma (phantom read): uma segunda transação
    que estava bloqueada esperando o lock, ao ser liberada, só reavalia as
    linhas que já tinha casado no scan inicial; uma linha NOVA inserida
    pela primeira transação (ex.: a saída que acabou de ser gravada) não
    entra nesse conjunto. Resultado: duas saídas concorrentes no mesmo
    produto podiam, juntas, derrubar o saldo abaixo de zero — cada uma via
    o saldo "antigo" (sem a saída da outra) e aprovava a validação.
    Confirmado com um teste isolado (asyncpg puro, sem SQLAlchemy) antes de
    aplicar esta correção.

    `pg_advisory_xact_lock` resolve isso corretamente: é um lock lógico,
    não preso a nenhuma linha específica, então cobre tanto updates quanto
    inserts concorrentes que disputam o mesmo produto. Escopo por
    tenant_id + produto_id (hashtext dos dois, forma de dois inteiros do
    pg_advisory_xact_lock) evita que produtos de tenants diferentes
    disputem o mesmo lock por coincidência de hash. Liberado automaticamente
    no commit/rollback da transação — não precisa (nem deve) ser liberado
    manualmente aqui.
    """
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:tenant_id), hashtext(:produto_id))"),
        {"tenant_id": str(tenant_id), "produto_id": str(produto_id)},
    )


async def calcular_saldo_atual(db: AsyncSession, *, tenant_id: UUID, produto_id: UUID) -> float:
    # Calculado em Python (não em SQL com CASE WHEN) para manter a lógica de
    # sinal auditável e testável num só lugar — ver `registrar()` abaixo.
    result = await db.execute(
        select(Movimentacao.tipo, Movimentacao.quantidade)
        .where(Movimentacao.tenant_id == tenant_id, Movimentacao.produto_id == produto_id)
        .with_for_update()  # lock de linha — impede condição de corrida entre duas saídas simultâneas
    )
    saldo = 0.0
    for tipo, quantidade in result.all():
        if tipo == "entrada":
            saldo += float(quantidade)
        elif tipo in ("saida", "transferencia"):
            saldo -= float(quantidade)
        elif tipo == "ajuste":
            # ajuste já vem com o sinal resolvido antes de ser persistido (ver `registrar`)
            saldo += float(quantidade)
    return saldo


async def calcular_saldo_por_deposito(db: AsyncSession, *, tenant_id: UUID, produto_id: UUID, deposito_id: UUID) -> float:
    """
    Saldo do produto DENTRO de um depósito específico — não confundir com
    calcular_saldo_atual (que é o total somando todos os depósitos). Usado
    pra validar transferência: não se pode tirar de um depósito mais do que
    ele tem, mesmo que o produto tenha saldo de sobra em outro depósito.
    """
    result = await db.execute(
        select(Movimentacao.tipo, Movimentacao.quantidade)
        .where(
            Movimentacao.tenant_id == tenant_id,
            Movimentacao.produto_id == produto_id,
            Movimentacao.deposito_id == deposito_id,
        )
        .with_for_update()
    )
    saldo = 0.0
    for tipo, quantidade in result.all():
        if tipo == "entrada":
            saldo += float(quantidade)
        elif tipo in ("saida", "transferencia"):
            saldo -= float(quantidade)
        elif tipo == "ajuste":
            saldo += float(quantidade)
    return saldo


async def registrar(
    db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, dados: MovimentacaoCreate
) -> list[Movimentacao]:
    produto = await db.get(Produto, dados.produto_id)
    if not produto or produto.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Produto não encontrado.")

    if dados.tipo == "transferencia":
        return await _registrar_transferencia(db, tenant_id=tenant_id, usuario_id=usuario_id, dados=dados)

    quantidade_persistida = dados.quantidade
    if dados.tipo == "ajuste":
        if dados.direcao is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Ajuste requer o campo 'direcao' (positivo ou negativo).",
            )
        quantidade_persistida = dados.quantidade if dados.direcao == "positivo" else -dados.quantidade

    # Para saída/ajuste-negativo: valida saldo suficiente ANTES de gravar
    if dados.tipo == "saida" or (dados.tipo == "ajuste" and quantidade_persistida < 0):
        await _travar_saldo_produto(db, tenant_id=tenant_id, produto_id=dados.produto_id)
        saldo_atual = await calcular_saldo_atual(db, tenant_id=tenant_id, produto_id=dados.produto_id)
        delta = dados.quantidade if dados.tipo != "ajuste" else abs(quantidade_persistida)
        if saldo_atual - delta < 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Saldo insuficiente. Disponível: {saldo_atual}, solicitado: {delta}.",
            )

    movimentacao = Movimentacao(
        tenant_id=tenant_id,
        produto_id=dados.produto_id,
        deposito_id=dados.deposito_id,
        lote_id=dados.lote_id,
        tipo=dados.tipo,
        quantidade=abs(quantidade_persistida) if dados.tipo != "ajuste" else quantidade_persistida,
        origem=dados.origem,
        referencia_externa=dados.referencia_externa,
        usuario_id=usuario_id,
    )
    db.add(movimentacao)
    await db.commit()
    await db.refresh(movimentacao)
    return [movimentacao]


async def _registrar_transferencia(
    db: AsyncSession, *, tenant_id: UUID, usuario_id: UUID, dados: MovimentacaoCreate
) -> list[Movimentacao]:
    """
    Uma transferência NUNCA deve alterar o saldo TOTAL do produto — ela só
    move mercadoria de um depósito pra outro dentro da mesma loja. Por isso
    é gravada como duas linhas (saída na origem + entrada no destino),
    ligadas por `grupo_transferencia_id`: reaproveita a soma/subtração que
    `entrada`/`saida` já fazem em todo o resto do sistema (saldo_geral,
    painel, alertas...) em vez de duplicar essa lógica com um caso especial
    pra "transferencia" espalhado por várias funções. Efeito líquido no
    total: +quantidade -quantidade = 0, que é o comportamento correto.
    """
    origem_id = dados.deposito_origem_id
    destino_id = dados.deposito_destino_id
    if not origem_id or not destino_id:
        # Defesa em profundidade: o model_validator do schema já garante isso,
        # mas não confiamos em `assert` aqui (removido em bytecode otimizado
        # com `python -O` — não é uma guarda confiável para produção).
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Transferência exige 'deposito_origem_id' e 'deposito_destino_id'.",
        )

    origem = await db.get(Deposito, origem_id)
    destino = await db.get(Deposito, destino_id)
    if not origem or origem.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Depósito de origem não encontrado.")
    if not destino or destino.tenant_id != tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Depósito de destino não encontrado.")

    # Validado contra o saldo DAQUELE depósito especificamente — não o total
    # do produto, que pode estar "de sobra" só porque outro depósito tem estoque.
    # Trava por produto_id (não por depósito): duas transferências concorrentes do
    # mesmo produto, ainda que de depósitos diferentes, disputam o mesmo saldo total
    # do produto ao longo do tempo — mais simples e seguro serializar por produto inteiro.
    await _travar_saldo_produto(db, tenant_id=tenant_id, produto_id=dados.produto_id)
    saldo_na_origem = await calcular_saldo_por_deposito(db, tenant_id=tenant_id, produto_id=dados.produto_id, deposito_id=origem_id)
    if saldo_na_origem - dados.quantidade < 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Saldo insuficiente em '{origem.nome}'. Disponível: {saldo_na_origem}, solicitado: {dados.quantidade}.",
        )

    grupo_id = uuid4()
    saida = Movimentacao(
        tenant_id=tenant_id, produto_id=dados.produto_id, deposito_id=origem_id, lote_id=dados.lote_id,
        tipo="saida", quantidade=dados.quantidade,
        origem=dados.origem or f"Transferência para {destino.nome}",
        referencia_externa=dados.referencia_externa, usuario_id=usuario_id, grupo_transferencia_id=grupo_id,
    )
    entrada = Movimentacao(
        tenant_id=tenant_id, produto_id=dados.produto_id, deposito_id=destino_id, lote_id=dados.lote_id,
        tipo="entrada", quantidade=dados.quantidade,
        origem=dados.origem or f"Transferência de {origem.nome}",
        referencia_externa=dados.referencia_externa, usuario_id=usuario_id, grupo_transferencia_id=grupo_id,
    )
    db.add_all([saida, entrada])
    await db.commit()
    await db.refresh(saida)
    await db.refresh(entrada)
    return [saida, entrada]


async def historico(db: AsyncSession, *, tenant_id: UUID, produto_id: UUID | None, pagina: int, tamanho: int):
    stmt = select(Movimentacao).where(Movimentacao.tenant_id == tenant_id)
    if produto_id:
        stmt = stmt.where(Movimentacao.produto_id == produto_id)
    stmt = stmt.order_by(Movimentacao.criado_em.desc()).offset((pagina - 1) * tamanho).limit(tamanho)
    result = await db.execute(stmt)
    return result.scalars().all()


async def saldo_geral(db: AsyncSession, *, tenant_id: UUID) -> list[dict]:
    """Saldo de todos os produtos ativos do tenant numa única query agregada —
    evita N chamadas a calcular_saldo_atual() (uma por produto) para montar
    uma visão geral. Sem FOR UPDATE de propósito: isto é leitura de relatório,
    não uma escrita concorrente que precise de lock de linha (ver
    calcular_saldo_atual, que trava por ser usado antes de gravar movimentação).

    O status "abaixo do mínimo" é sempre calculado sobre o saldo TOTAL do
    produto (soma de todos os depósitos), nunca por depósito isolado — um
    produto dividido entre dois depósitos não deve disparar alerta se a soma
    das partes já atende o mínimo configurado.
    """
    # "transferencia" continua listado aqui só como rede de segurança —
    # desde a correção do bug de saldo, transferências são gravadas como um
    # par saida+entrada (ver _registrar_transferencia), nunca com esse tipo
    # persistido. Mantido defensivamente, nunca deve bater na prática.
    saldo_expr = func.sum(
        case(
            (Movimentacao.tipo == "entrada", Movimentacao.quantidade),
            (Movimentacao.tipo.in_(("saida", "transferencia")), -Movimentacao.quantidade),
            (Movimentacao.tipo == "ajuste", Movimentacao.quantidade),
            else_=0,
        )
    )

    subq_total = (
        select(Movimentacao.produto_id, saldo_expr.label("saldo"))
        .where(Movimentacao.tenant_id == tenant_id)
        .group_by(Movimentacao.produto_id)
        .subquery()
    )

    stmt = (
        select(Produto.id, Produto.nome, Produto.codigo_barras, Produto.estoque_minimo, subq_total.c.saldo)
        .outerjoin(subq_total, subq_total.c.produto_id == Produto.id)
        .where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True))  # defesa em profundidade além do RLS
        .order_by(Produto.nome)
    )
    linhas = (await db.execute(stmt)).all()

    # Detalhamento por depósito — só relevante pra quem de fato movimenta em
    # mais de um depósito; produtos sem nenhuma movimentação com deposito_id
    # preenchido simplesmente não aparecem aqui, e o frontend esconde a coluna
    # "Posição" quando essa lista vier vazia.
    stmt_deposito = (
        select(Movimentacao.produto_id, Movimentacao.deposito_id, Deposito.nome, saldo_expr.label("saldo"))
        .outerjoin(Deposito, Deposito.id == Movimentacao.deposito_id)
        .where(Movimentacao.tenant_id == tenant_id, Movimentacao.deposito_id.is_not(None))
        .group_by(Movimentacao.produto_id, Movimentacao.deposito_id, Deposito.nome)
    )
    linhas_deposito = (await db.execute(stmt_deposito)).all()

    posicoes_por_produto: dict[UUID, list[dict]] = {}
    for produto_id, deposito_id, deposito_nome, saldo in linhas_deposito:
        posicoes_por_produto.setdefault(produto_id, []).append(
            {"deposito_id": deposito_id, "deposito_nome": deposito_nome or "Sem nome", "saldo": float(saldo or 0)}
        )

    resultado = []
    for produto_id, nome, codigo_barras, estoque_minimo, saldo in linhas:
        saldo_final = float(saldo) if saldo is not None else 0.0  # produto sem nenhuma movimentação ainda
        resultado.append(
            {
                "produto_id": produto_id,
                "nome": nome,
                "codigo_barras": codigo_barras,
                "saldo": saldo_final,
                "estoque_minimo": float(estoque_minimo),
                "abaixo_do_minimo": saldo_final < float(estoque_minimo),
                "posicoes": posicoes_por_produto.get(produto_id, []),
            }
        )
    return resultado


def _calcular_prioridade(
    *, saldo: float, estoque_minimo: float, proxima_validade: date | None, produto_novo: bool
) -> str:
    """
    Um selo só por produto — a primeira condição verdadeira nesta ordem
    vence. Ordem deliberada: falta de estoque é sempre mais urgente que
    vencimento próximo, que é mais urgente que abaixo do mínimo (ainda tem
    estoque), que é mais urgente que só "produto novo" (informativo, não
    é um problema). Ver spec aprovada da tela de Estoque.
    """
    if saldo <= 0:
        return "sem_estoque"
    if proxima_validade is not None and proxima_validade <= date.today() + timedelta(days=DIAS_VENCIMENTO_PROXIMO):
        return "vencimento_proximo"
    if saldo < estoque_minimo:
        return "abaixo_minimo"
    if produto_novo:
        return "novo"
    return "normal"


async def _opcoes_filtro(db: AsyncSession, *, tenant_id: UUID) -> dict:
    categorias = (
        await db.execute(select(Categoria.id, Categoria.nome).where(Categoria.tenant_id == tenant_id).order_by(Categoria.nome))
    ).all()
    depositos = (
        await db.execute(select(Deposito.id, Deposito.nome).where(Deposito.tenant_id == tenant_id).order_by(Deposito.nome))
    ).all()
    fornecedores = (
        await db.execute(select(Fornecedor.id, Fornecedor.nome).where(Fornecedor.tenant_id == tenant_id).order_by(Fornecedor.nome))
    ).all()
    return {
        "categorias": [{"id": i, "nome": n} for i, n in categorias],
        "depositos": [{"id": i, "nome": n} for i, n in depositos],
        "fornecedores": [{"id": i, "nome": n} for i, n in fornecedores],
    }


async def painel(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    busca: str | None = None,
    categoria_id: UUID | None = None,
    deposito_id: UUID | None = None,
    fornecedor_id: UUID | None = None,
    status_ativo: bool | None = None,
    somente_abaixo_minimo: bool = False,
    somente_vencimento_proximo: bool = False,
    somente_sem_estoque: bool = False,
    ordenar_por: str = "nome",
    direcao: str = "asc",
    pagina: int = 1,
    tamanho: int = 50,
) -> dict:
    """
    Monta tudo que a tela de Estoque precisa numa única chamada: KPIs (sobre
    o catálogo inteiro, não afetados por busca/filtro — são um resumo fixo),
    opções de filtro disponíveis, e os itens da grade (esses sim filtrados,
    ordenados e paginados).　

    Ordenação e paginação acontecem em Python, não em SQL: o catálogo de um
    tenant piloto (bomboniere) é pequeno o bastante pra isso não pesar, e
    simplifica muito ordenar por colunas calculadas (valor_total_custo,
    saldo) sem duplicar a lógica de agregação em SQL. Se o catálogo de algum
    tenant crescer para milhares de produtos, vale revisitar e mover pra
    SQL — registrado aqui como decisão consciente, não descuido.
    """
    # "transferencia" continua listado aqui só como rede de segurança —
    # desde a correção do bug de saldo, transferências são gravadas como um
    # par saida+entrada (ver _registrar_transferencia), nunca com esse tipo
    # persistido. Mantido defensivamente, nunca deve bater na prática.
    saldo_expr = func.sum(
        case(
            (Movimentacao.tipo == "entrada", Movimentacao.quantidade),
            (Movimentacao.tipo.in_(("saida", "transferencia")), -Movimentacao.quantidade),
            (Movimentacao.tipo == "ajuste", Movimentacao.quantidade),
            else_=0,
        )
    )
    subq_saldo = (
        select(Movimentacao.produto_id, saldo_expr.label("saldo"))
        .where(Movimentacao.tenant_id == tenant_id)
        .group_by(Movimentacao.produto_id)
        .subquery()
    )

    # --- KPIs sobre o catálogo ativo inteiro (sem filtro/busca) ------------
    stmt_kpi = (
        select(Produto.id, Produto.custo_medio, Produto.estoque_minimo, subq_saldo.c.saldo)
        .outerjoin(subq_saldo, subq_saldo.c.produto_id == Produto.id)
        .where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True))
    )
    linhas_kpi = (await db.execute(stmt_kpi)).all()
    total_unidades = 0.0
    valor_total_custo = 0.0
    abaixo_minimo = 0
    sem_estoque = 0
    for _id, custo_medio, estoque_minimo, saldo in linhas_kpi:
        saldo_f = float(saldo) if saldo is not None else 0.0
        total_unidades += saldo_f
        valor_total_custo += saldo_f * float(custo_medio)
        if saldo_f <= 0:
            sem_estoque += 1
        elif saldo_f < float(estoque_minimo):
            abaixo_minimo += 1
    kpis = {
        "produtos_cadastrados": len(linhas_kpi),
        "total_unidades": total_unidades,
        "valor_total_custo": round(valor_total_custo, 2),
        "produtos_abaixo_minimo": abaixo_minimo,
        "produtos_sem_estoque": sem_estoque,
    }

    # --- Posições por depósito (reaproveita a mesma agregação de saldo_geral) --
    stmt_deposito = (
        select(Movimentacao.produto_id, Movimentacao.deposito_id, Deposito.nome, saldo_expr.label("saldo"))
        .outerjoin(Deposito, Deposito.id == Movimentacao.deposito_id)
        .where(Movimentacao.tenant_id == tenant_id, Movimentacao.deposito_id.is_not(None))
        .group_by(Movimentacao.produto_id, Movimentacao.deposito_id, Deposito.nome)
    )
    linhas_deposito = (await db.execute(stmt_deposito)).all()
    posicoes_por_produto: dict[UUID, list[dict]] = {}
    for produto_id, dep_id, dep_nome, saldo in linhas_deposito:
        posicoes_por_produto.setdefault(produto_id, []).append(
            {"deposito_id": dep_id, "deposito_nome": dep_nome or "Sem nome", "saldo": float(saldo or 0)}
        )

    # --- Próxima validade por produto (menor validade entre lotes com saldo) --
    stmt_validade = (
        select(Lote.produto_id, func.min(Lote.validade))
        .where(Lote.tenant_id == tenant_id, Lote.validade.is_not(None), Lote.quantidade > 0)
        .group_by(Lote.produto_id)
    )
    proxima_validade_por_produto = {pid: validade for pid, validade in (await db.execute(stmt_validade)).all()}

    # --- Produtos que já foram comprados de um fornecedor específico -------
    produtos_do_fornecedor: set[UUID] | None = None
    if fornecedor_id:
        stmt_forn = (
            select(PedidoCompraItem.produto_id)
            .join(PedidoCompra, PedidoCompra.id == PedidoCompraItem.pedido_id)
            .where(PedidoCompra.tenant_id == tenant_id, PedidoCompra.fornecedor_id == fornecedor_id)
            .distinct()
        )
        produtos_do_fornecedor = {pid for (pid,) in (await db.execute(stmt_forn)).all()}

    # --- Catálogo base (com busca/filtros aplicados a nível de SQL) --------
    stmt = (
        select(
            Produto.id, Produto.nome, Produto.sku, Produto.codigo_barras, Produto.categoria_id,
            Categoria.nome.label("categoria_nome"), Produto.marca, Produto.imagem_url,
            Produto.unidade_medida, Produto.custo_medio, Produto.preco_venda,
            Produto.estoque_minimo, Produto.ativo, Produto.criado_em, subq_saldo.c.saldo,
        )
        .outerjoin(Categoria, Categoria.id == Produto.categoria_id)
        .outerjoin(subq_saldo, subq_saldo.c.produto_id == Produto.id)
        .where(Produto.tenant_id == tenant_id)
    )
    if busca:
        termo = f"%{busca}%"
        stmt = stmt.where(or_(Produto.nome.ilike(termo), Produto.sku.ilike(termo), Produto.codigo_barras.ilike(termo)))
    if categoria_id:
        stmt = stmt.where(Produto.categoria_id == categoria_id)
    if status_ativo is not None:
        stmt = stmt.where(Produto.ativo.is_(status_ativo))

    linhas = (await db.execute(stmt)).all()

    agora = datetime.now(timezone.utc)
    itens = []
    for produto_id, nome, sku, codigo_barras, categoria_id_linha, categoria_nome, marca, imagem_url, unidade, custo_medio, preco_venda, estoque_minimo, ativo, criado_em, saldo in linhas:
        if deposito_id and not any(p["deposito_id"] == deposito_id for p in posicoes_por_produto.get(produto_id, [])):
            continue
        if produtos_do_fornecedor is not None and produto_id not in produtos_do_fornecedor:
            continue

        saldo_f = float(saldo) if saldo is not None else 0.0
        criado_em_aware = criado_em if criado_em.tzinfo else criado_em.replace(tzinfo=timezone.utc)
        produto_novo = (agora - criado_em_aware) <= timedelta(days=DIAS_PRODUTO_NOVO)
        proxima_validade = proxima_validade_por_produto.get(produto_id)
        prioridade = _calcular_prioridade(
            saldo=saldo_f, estoque_minimo=float(estoque_minimo),
            proxima_validade=proxima_validade, produto_novo=produto_novo,
        )

        if somente_abaixo_minimo and saldo_f >= float(estoque_minimo):
            continue
        if somente_sem_estoque and saldo_f > 0:
            continue
        if somente_vencimento_proximo and prioridade != "vencimento_proximo":
            continue

        preco_venda_f = float(preco_venda) if preco_venda is not None else None
        itens.append({
            "produto_id": produto_id, "nome": nome, "sku": sku, "codigo_barras": codigo_barras,
            "categoria_id": categoria_id_linha, "categoria_nome": categoria_nome,
            "marca": marca, "imagem_url": imagem_url, "unidade_medida": unidade,
            "saldo": saldo_f, "custo_medio": float(custo_medio), "preco_venda": preco_venda_f,
            "valor_total_custo": round(saldo_f * float(custo_medio), 2),
            "estoque_minimo": float(estoque_minimo), "ativo": ativo, "criado_em": criado_em,
            "proxima_validade": proxima_validade, "prioridade": prioridade,
            "posicoes": posicoes_por_produto.get(produto_id, []),
        })

    # --- Ordenação (em Python — ver docstring) ------------------------------
    chaves_ordenaveis = {
        "nome": lambda i: i["nome"].lower(),
        "sku": lambda i: (i["sku"] or "").lower(),
        "saldo": lambda i: i["saldo"],
        "custo_medio": lambda i: i["custo_medio"],
        "preco_venda": lambda i: i["preco_venda"] if i["preco_venda"] is not None else -1,
        "valor_total_custo": lambda i: i["valor_total_custo"],
        "estoque_minimo": lambda i: i["estoque_minimo"],
        "criado_em": lambda i: i["criado_em"],
    }
    chave = chaves_ordenaveis.get(ordenar_por, chaves_ordenaveis["nome"])
    itens.sort(key=chave, reverse=(direcao == "desc"))

    total = len(itens)
    inicio = (pagina - 1) * tamanho
    itens_pagina = itens[inicio: inicio + tamanho]

    filtros = await _opcoes_filtro(db, tenant_id=tenant_id)

    return {
        "kpis": kpis, "filtros": filtros, "itens": itens_pagina,
        "total": total, "pagina": pagina, "tamanho": tamanho,
    }


ORDENAVEIS_PAINEL_MOVIMENTACAO = {
    "tipo": Movimentacao.tipo,
    "quantidade": Movimentacao.quantidade,
    "criado_em": Movimentacao.criado_em,
}


async def painel_movimentacoes(
    db: AsyncSession,
    *,
    tenant_id: UUID,
    tipo_filtro: str | None = None,
    produto_id: UUID | None = None,
    busca: str | None = None,
    ordenar_por: str = "criado_em",
    direcao: str = "desc",
    pagina: int = 1,
    tamanho: int = 25,
) -> dict:
    """
    Alimenta a tela de Movimentação com o kit de UX. Mantido separado de
    GET /estoque/movimentacoes (listagem crua, ainda usada pelo próprio
    formulário desta tela) e de /estoque/painel (recorte diferente — saldo
    por produto da tela de Estoque, não histórico de lançamentos) — mesmo
    padrão dos demais paineis.
    """
    stmt = (
        select(Movimentacao, Produto.nome, Deposito.nome)
        .join(Produto, Produto.id == Movimentacao.produto_id)
        .outerjoin(Deposito, Deposito.id == Movimentacao.deposito_id)
        .where(Movimentacao.tenant_id == tenant_id)
    )
    if tipo_filtro:
        stmt = stmt.where(Movimentacao.tipo == tipo_filtro)
    if produto_id:
        stmt = stmt.where(Movimentacao.produto_id == produto_id)
    if busca:
        termo = f"%{busca}%"
        stmt = stmt.where(or_(Produto.nome.ilike(termo), Movimentacao.origem.ilike(termo)))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    coluna = ORDENAVEIS_PAINEL_MOVIMENTACAO.get(ordenar_por, Movimentacao.criado_em)
    stmt = stmt.order_by(coluna.desc() if direcao == "desc" else coluna.asc())
    stmt = stmt.offset((pagina - 1) * tamanho).limit(tamanho)

    linhas = (await db.execute(stmt)).all()
    itens = [
        {
            "id": mov.id,
            "produto_id": mov.produto_id,
            "produto_nome": produto_nome,
            "deposito_id": mov.deposito_id,
            "deposito_nome": deposito_nome,
            "tipo": mov.tipo,
            "quantidade": mov.quantidade,
            "origem": mov.origem,
            "grupo_transferencia_id": mov.grupo_transferencia_id,
            "criado_em": mov.criado_em,
        }
        for mov, produto_nome, deposito_nome in linhas
    ]

    # KPIs sempre sobre o total do tenant, sem aplicar busca/filtro — mesmo
    # princípio já usado nos demais paineis com kit de UX.
    contagens = dict(
        (
            await db.execute(
                select(Movimentacao.tipo, func.count())
                .where(Movimentacao.tenant_id == tenant_id)
                .group_by(Movimentacao.tipo)
            )
        ).all()
    )
    total_movimentacoes = sum(contagens.values())

    produtos = (
        await db.execute(
            select(Produto.id, Produto.nome)
            .where(Produto.tenant_id == tenant_id, Produto.ativo.is_(True))
            .order_by(Produto.nome)
        )
    ).all()

    return {
        "kpis": {
            "total_movimentacoes": total_movimentacoes,
            "entradas": contagens.get("entrada", 0),
            "saidas": contagens.get("saida", 0),
            "ajustes": contagens.get("ajuste", 0),
        },
        "filtros": {"produtos": [{"id": i, "nome": n} for i, n in produtos]},
        "itens": itens,
        "total": total,
        "pagina": pagina,
        "tamanho": tamanho,
    }
