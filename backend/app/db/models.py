"""
Models SQLAlchemy — espelham 1:1 o schema em migrations/001_init_core_schema.sql.
Nenhum campo específico de segmento aqui: o que varia por segmento vive em
Produto.campos_customizados (JSONB), nunca como coluna nova nestes models.
"""
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid_col():
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class Tenant(Base):
    __tablename__ = "tenants"
    id: Mapped[uuid.UUID] = _uuid_col()
    nome: Mapped[str] = mapped_column(String(200))
    segmento_slug: Mapped[str] = mapped_column(String(50))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    nome: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True)
    senha_hash: Mapped[str] = mapped_column(Text)
    perfil: Mapped[str] = mapped_column(String(20))  # admin | operador | leitura
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    deve_trocar_senha: Mapped[bool] = mapped_column(Boolean, default=False)
    tentativas_falhas: Mapped[int] = mapped_column(default=0)
    bloqueado_ate: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(Text)
    expira_em: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revogado: Mapped[bool] = mapped_column(Boolean, default=False)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Categoria(Base):
    __tablename__ = "categorias"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    nome: Mapped[str] = mapped_column(String(120))
    categoria_pai_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("categorias.id"))


class Deposito(Base):
    __tablename__ = "depositos"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    nome: Mapped[str] = mapped_column(String(120))
    endereco: Mapped[str | None] = mapped_column(Text)


class Produto(Base):
    __tablename__ = "produtos"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    categoria_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("categorias.id"))
    nome: Mapped[str] = mapped_column(String(200))
    sku: Mapped[str | None] = mapped_column(String(60))
    codigo_barras: Mapped[str | None] = mapped_column(String(64))
    unidade_medida: Mapped[str] = mapped_column(String(10), default="un")
    custo_medio: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    preco_venda: Mapped[float | None] = mapped_column(Numeric(12, 2))
    marca: Mapped[str | None] = mapped_column(String(120))
    ncm: Mapped[str | None] = mapped_column(String(20))
    imagem_url: Mapped[str | None] = mapped_column(Text)
    controla_lote: Mapped[bool] = mapped_column(Boolean, default=False)
    estoque_minimo: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    estoque_maximo: Mapped[float | None] = mapped_column(Numeric(12, 2))
    campos_customizados: Mapped[dict] = mapped_column(JSONB, default=dict)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    lotes: Mapped[list["Lote"]] = relationship(back_populates="produto")


class Lote(Base):
    __tablename__ = "lotes"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    produto_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("produtos.id", ondelete="CASCADE"))
    codigo_lote: Mapped[str] = mapped_column(String(60))
    validade: Mapped[date | None] = mapped_column(Date)
    quantidade: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    deposito_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("depositos.id"))

    produto: Mapped["Produto"] = relationship(back_populates="lotes")


class Movimentacao(Base):
    __tablename__ = "movimentacoes"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    produto_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("produtos.id"))
    deposito_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("depositos.id"))
    lote_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("lotes.id"))
    tipo: Mapped[str] = mapped_column(String(20))  # entrada | saida | ajuste | transferencia
    quantidade: Mapped[float] = mapped_column(Numeric(12, 2))
    origem: Mapped[str | None] = mapped_column(Text)
    referencia_externa: Mapped[str | None] = mapped_column(String(120))
    grupo_transferencia_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    usuario_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Fornecedor(Base):
    __tablename__ = "fornecedores"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    nome: Mapped[str] = mapped_column(String(200))
    documento: Mapped[str | None] = mapped_column(String(20))
    contato: Mapped[str | None] = mapped_column(String(200))


class NotaFiscal(Base):
    __tablename__ = "notas_fiscais"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    numero: Mapped[str] = mapped_column(String(50))
    fornecedor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("fornecedores.id"))
    xml_raw: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pendente")
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Inventario(Base):
    __tablename__ = "inventarios"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    deposito_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("depositos.id"))
    status: Mapped[str] = mapped_column(String(20), default="aberto")  # aberto | fechado
    ciclo: Mapped[str] = mapped_column(String(20))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class InventarioItem(Base):
    __tablename__ = "inventario_itens"
    id: Mapped[uuid.UUID] = _uuid_col()
    inventario_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("inventarios.id", ondelete="CASCADE"))
    produto_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("produtos.id"))
    qtd_sistema: Mapped[float] = mapped_column(Numeric(12, 2))
    qtd_contada: Mapped[float | None] = mapped_column(Numeric(12, 2))
    divergencia: Mapped[float | None] = mapped_column(Numeric(12, 2))


class NotaFiscalItem(Base):
    __tablename__ = "notas_fiscais_itens"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    nota_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("notas_fiscais.id", ondelete="CASCADE"))
    descricao_xml: Mapped[str] = mapped_column(Text)
    codigo_ean_xml: Mapped[str | None] = mapped_column(String(64))
    produto_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("produtos.id"))
    quantidade: Mapped[float] = mapped_column(Numeric(12, 2))
    valor_unitario: Mapped[float] = mapped_column(Numeric(12, 2))
    status_match: Mapped[str] = mapped_column(String(20), default="pendente_cadastro")


class Venda(Base):
    __tablename__ = "vendas"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(20), default="aberta")  # aberta | finalizada | cancelada
    valor_total: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    usuario_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    finalizado_em: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    itens: Mapped[list["VendaItem"]] = relationship(back_populates="venda")


class VendaItem(Base):
    __tablename__ = "venda_itens"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    venda_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vendas.id", ondelete="CASCADE"))
    produto_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("produtos.id"))
    quantidade: Mapped[float] = mapped_column(Numeric(12, 2))
    preco_unitario: Mapped[float] = mapped_column(Numeric(12, 2))

    venda: Mapped["Venda"] = relationship(back_populates="itens")


class RegraAlerta(Base):
    __tablename__ = "regras_alerta"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    tipo: Mapped[str] = mapped_column(String(30))  # validade | estoque_baixo | produto_parado
    parametros: Mapped[dict] = mapped_column(JSONB, default=dict)
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)


class AlertaGerado(Base):
    __tablename__ = "alertas_gerados"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    regra_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("regras_alerta.id"))
    tipo: Mapped[str] = mapped_column(String(30))
    produto_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("produtos.id"))
    mensagem: Mapped[str] = mapped_column(Text)
    lido: Mapped[bool] = mapped_column(Boolean, default=False)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class PedidoCompra(Base):
    __tablename__ = "pedidos_compra"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    fornecedor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("fornecedores.id"))
    status: Mapped[str] = mapped_column(String(20), default="rascunho")
    usuario_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    itens: Mapped[list["PedidoCompraItem"]] = relationship(back_populates="pedido")


class PedidoCompraItem(Base):
    __tablename__ = "pedidos_compra_itens"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    pedido_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("pedidos_compra.id", ondelete="CASCADE"))
    produto_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("produtos.id"))
    quantidade: Mapped[float] = mapped_column(Numeric(12, 2))
    custo_unitario: Mapped[float] = mapped_column(Numeric(12, 2))
    quantidade_recebida: Mapped[float] = mapped_column(Numeric(12, 2), default=0)

    pedido: Mapped["PedidoCompra"] = relationship(back_populates="itens")


class EtiquetaModelo(Base):
    __tablename__ = "etiqueta_modelos"
    id: Mapped[uuid.UUID] = _uuid_col()
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"))
    nome: Mapped[str] = mapped_column(String(120))
    config_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    criado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
