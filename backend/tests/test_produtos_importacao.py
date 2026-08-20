"""
Etapa 26: import em massa de produtos via planilha (XLSX/CSV).

Fluxo em duas etapas: preview (não grava nada) -> confirmar (revalida e
grava). Decisões de negócio confirmadas com Giliardi:
- SKU já existente (no banco ou duplicado dentro do próprio arquivo) é
  rejeitado (linha vira erro, não atualiza o produto existente).
- Categoria nova é criada automaticamente.
- Confirmação sempre revalida do zero contra o estado atual do banco.
"""
import io

import pytest
from httpx import AsyncClient
from openpyxl import Workbook


def _csv_bytes(linhas: list[str], cabecalho: str = "nome,sku,categoria,custo_medio,preco_venda") -> bytes:
    conteudo = cabecalho + "\n" + "\n".join(linhas)
    return conteudo.encode("utf-8")


def _xlsx_bytes(cabecalho: list[str], linhas: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(cabecalho)
    for linha in linhas:
        ws.append(linha)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.mark.asyncio
async def test_preview_csv_valido_marca_linhas_como_ok(client_tenant_a: AsyncClient):
    csv = _csv_bytes([
        "Bombom Trufado,BOM-001,Doces,2.5,5.0",
        "Caixa de Presente,CX-010,Embalagens,1.0,",
    ])
    resp = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    assert resp.status_code == 200, resp.text
    corpo = resp.json()
    assert corpo["total_linhas"] == 2
    assert corpo["total_validas"] == 2
    assert corpo["total_com_erro"] == 0
    assert set(corpo["categorias_novas"]) == {"Doces", "Embalagens"}
    assert corpo["itens"][0]["dados"]["nome"] == "Bombom Trufado"
    assert corpo["itens"][0]["categoria_sera_criada"] is True


@pytest.mark.asyncio
async def test_preview_xlsx_valido(client_tenant_a: AsyncClient):
    xlsx = _xlsx_bytes(
        ["nome", "sku", "categoria", "custo_medio", "preco_venda"],
        [["Trufa de Morango", "TRF-01", "Doces", 3.0, 7.5]],
    )
    resp = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert resp.status_code == 200, resp.text
    corpo = resp.json()
    assert corpo["total_validas"] == 1
    assert corpo["itens"][0]["dados"]["preco_venda"] == 7.5


@pytest.mark.asyncio
async def test_preview_formato_decimal_br_com_virgula(client_tenant_a: AsyncClient):
    csv = _csv_bytes(["Produto BR,SKU-BR,Categoria X,\"1.234,56\",\"2.000,00\""])
    resp = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    assert resp.status_code == 200, resp.text
    item = resp.json()["itens"][0]
    assert item["status"] == "ok"
    assert item["dados"]["custo_medio"] == 1234.56
    assert item["dados"]["preco_venda"] == 2000.0


@pytest.mark.asyncio
async def test_preview_nome_vazio_gera_erro_na_linha(client_tenant_a: AsyncClient):
    csv = _csv_bytes([",SKU-X,Categoria,1.0,2.0"])
    resp = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    corpo = resp.json()
    assert corpo["total_com_erro"] == 1
    assert corpo["itens"][0]["status"] == "erro"
    assert "obrigatório" in corpo["itens"][0]["erro"].lower()


@pytest.mark.asyncio
async def test_preview_sku_duplicado_dentro_do_proprio_arquivo(client_tenant_a: AsyncClient):
    csv = _csv_bytes([
        "Produto Um,DUP-01,Cat,1.0,2.0",
        "Produto Dois,DUP-01,Cat,1.5,2.5",
    ])
    resp = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    corpo = resp.json()
    assert corpo["itens"][0]["status"] == "ok"
    assert corpo["itens"][1]["status"] == "erro"
    assert "duplicado" in corpo["itens"][1]["erro"].lower()


@pytest.mark.asyncio
async def test_preview_sku_ja_existente_no_banco_e_rejeitado(client_tenant_a: AsyncClient):
    # Cria um produto com SKU real primeiro
    criado = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Já Existe", "sku": "EXISTE-01"})
    assert criado.status_code == 201

    csv = _csv_bytes(["Produto Novo,EXISTE-01,Cat,1.0,2.0"])
    resp = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    item = resp.json()["itens"][0]
    assert item["status"] == "erro"
    assert "já existe" in item["erro"].lower()


@pytest.mark.asyncio
async def test_preview_estoque_maximo_menor_que_minimo_gera_erro(client_tenant_a: AsyncClient):
    csv = _csv_bytes(
        ["Produto Estoque,EST-01,Cat,1.0,2.0,10,5"],
        cabecalho="nome,sku,categoria,custo_medio,preco_venda,estoque_minimo,estoque_maximo",
    )
    resp = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    item = resp.json()["itens"][0]
    assert item["status"] == "erro"
    assert "estoque máximo" in item["erro"].lower()


@pytest.mark.asyncio
async def test_preview_formato_nao_suportado_retorna_415(client_tenant_a: AsyncClient):
    resp = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert resp.status_code == 415


@pytest.mark.asyncio
async def test_preview_planilha_vazia_retorna_422(client_tenant_a: AsyncClient):
    csv = "nome,sku,categoria,custo_medio,preco_venda\n".encode("utf-8")
    resp = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_confirmar_cria_produtos_e_categorias_novas(client_tenant_a: AsyncClient):
    csv = _csv_bytes([
        "Bombom Trufado,IMP-001,Doces Finos,2.5,5.0",
        "Caixa Presente,IMP-002,Doces Finos,1.0,3.0",
    ])
    preview = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    linhas_ok = [item["dados"] for item in preview.json()["itens"] if item["status"] == "ok"]

    confirmar = await client_tenant_a.post("/api/v1/produtos/importar/confirmar", json={"linhas": linhas_ok})
    assert confirmar.status_code == 200, confirmar.text
    resultado = confirmar.json()
    assert resultado["criados"] == 2
    assert resultado["rejeitados"] == 0
    assert resultado["categorias_criadas"] == ["Doces Finos"]

    painel = await client_tenant_a.get("/api/v1/produtos/painel")
    nomes = {item["nome"] for item in painel.json()["itens"]}
    assert {"Bombom Trufado", "Caixa Presente"} <= nomes
    # Categoria criada uma única vez, reaproveitada pela segunda linha
    categoria_ids = {item["categoria_id"] for item in painel.json()["itens"] if item["nome"] in nomes}
    assert len(categoria_ids) <= 2  # não afirmamos exatamente 1 pois pode haver outras categorias no painel


@pytest.mark.asyncio
async def test_confirmar_revalida_sku_criado_entre_preview_e_confirmacao(client_tenant_a: AsyncClient):
    csv = _csv_bytes(["Produto Corrida,CORR-01,Cat,1.0,2.0"])
    preview = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    linha_ok = [item["dados"] for item in preview.json()["itens"] if item["status"] == "ok"]
    assert len(linha_ok) == 1

    # Simula outro usuário criando o mesmo SKU nesse meio-tempo
    concorrente = await client_tenant_a.post("/api/v1/produtos", json={"nome": "Chegou Primeiro", "sku": "CORR-01"})
    assert concorrente.status_code == 201

    confirmar = await client_tenant_a.post("/api/v1/produtos/importar/confirmar", json={"linhas": linha_ok})
    resultado = confirmar.json()
    assert resultado["criados"] == 0
    assert resultado["rejeitados"] == 1
    assert "já existe" in resultado["itens"][0]["erro"].lower()


@pytest.mark.asyncio
async def test_perfil_leitura_nao_pode_fazer_preview_de_importacao(client_leitura: AsyncClient):
    csv = _csv_bytes(["Produto,SKU-L,Cat,1.0,2.0"])
    resp = await client_leitura.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_perfil_leitura_nao_pode_confirmar_importacao(client_leitura: AsyncClient):
    resp = await client_leitura.post(
        "/api/v1/produtos/importar/confirmar",
        json={"linhas": [{"linha": 2, "nome": "X", "sku": "L-01"}]},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_perfil_operador_pode_importar(client_operador: AsyncClient):
    csv = _csv_bytes(["Produto Operador,OP-01,Cat,1.0,2.0"])
    resp = await client_operador.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    assert resp.status_code == 200
    assert resp.json()["total_validas"] == 1


@pytest.mark.asyncio
async def test_sku_de_outro_tenant_nao_bloqueia_import(client_tenant_a: AsyncClient, client_tenant_b: AsyncClient):
    """Isolamento: SKU já usado no tenant B não deve impedir o tenant A de importar o mesmo SKU."""
    criado_b = await client_tenant_b.post("/api/v1/produtos", json={"nome": "Produto do Tenant B", "sku": "COMPARTILHADO"})
    assert criado_b.status_code == 201

    csv = _csv_bytes(["Produto do Tenant A,COMPARTILHADO,Cat,1.0,2.0"])
    resp = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    item = resp.json()["itens"][0]
    assert item["status"] == "ok"


@pytest.mark.asyncio
async def test_import_excede_limite_de_linhas_retorna_413(client_tenant_a: AsyncClient, monkeypatch):
    from app.core.config import get_settings
    get_settings.cache_clear()
    monkeypatch.setenv("MAX_IMPORT_PRODUTOS_LINHAS", "2")
    get_settings.cache_clear()

    csv = _csv_bytes([f"Produto {i},SKU-{i},Cat,1.0,2.0" for i in range(5)])
    resp = await client_tenant_a.post(
        "/api/v1/produtos/importar/preview",
        files={"arquivo": ("produtos.csv", csv, "text/csv")},
    )
    assert resp.status_code == 413
    get_settings.cache_clear()
