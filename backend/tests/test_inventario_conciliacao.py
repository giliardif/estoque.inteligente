"""
Testa o fluxo de encerramento e aprovação do inventário (Etapa 39):
  operador conta (contagem cega, nunca ajusta estoque) -> envia para análise
  -> supervisor concilia e decide item a item -> aprova o ajuste final
  (só aí grava movimentação real).
"""
import io

import pytest
from httpx import AsyncClient


async def _abrir_e_contar(client_tenant_a: AsyncClient, produto_id: str, qtd_contada: float, ciclo="2026-08"):
    inv = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": ciclo})
    assert inv.status_code == 201, inv.text
    inv_id = inv.json()["id"]
    contagem = await client_tenant_a.patch(
        f"/api/v1/inventario/{inv_id}/itens/{produto_id}", json={"qtd_contada": qtd_contada}
    )
    assert contagem.status_code == 200, contagem.text
    return inv_id


@pytest.mark.asyncio
async def test_abrir_inventario_pre_popula_item_pendente_para_produto_ativo(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-08"})
    inv_id = inv.json()["id"]

    painel = await client_tenant_a.get(f"/api/v1/inventario/{inv_id}/operador")
    assert painel.status_code == 200, painel.text
    corpo = painel.json()
    assert corpo["progresso"]["total"] == 1
    assert corpo["progresso"]["contados"] == 0
    assert corpo["resumo"]["pendentes"] == 1
    item = corpo["itens"][0]
    assert item["produto_id"] == produto_com_saldo_10
    assert item["status_item"] == "pendente"
    # Contagem cega: o item nunca expõe o saldo do sistema
    assert "qtd_sistema" not in item


@pytest.mark.asyncio
async def test_painel_operador_nunca_expoe_saldo_do_sistema(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    inv_id = await _abrir_e_contar(client_tenant_a, produto_com_saldo_10, qtd_contada=7)  # diverge de 10

    painel = await client_tenant_a.get(f"/api/v1/inventario/{inv_id}/operador")
    corpo_bruto = painel.text
    assert "qtd_sistema" not in corpo_bruto
    item = painel.json()["itens"][0]
    assert item["status_item"] == "divergente"
    assert item["divergencia"] == -3  # sinal/magnitude visível, mas nunca o saldo bruto


@pytest.mark.asyncio
async def test_enviar_analise_muda_status_e_nao_ajusta_estoque(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    inv_id = await _abrir_e_contar(client_tenant_a, produto_com_saldo_10, qtd_contada=7)

    enviar = await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/enviar-analise")
    assert enviar.status_code == 200, enviar.text
    assert enviar.json()["inventario"]["status"] == "em_analise"

    # Estoque real ainda não foi tocado — saldo continua 10, não 7
    saldo = await client_tenant_a.get("/api/v1/estoque/painel")
    produto_no_estoque = next(p for p in saldo.json()["itens"] if p["produto_id"] == produto_com_saldo_10)
    assert produto_no_estoque["saldo"] == 10


@pytest.mark.asyncio
async def test_operador_nao_acessa_conciliacao(client_operador: AsyncClient):
    inv = await client_operador.post("/api/v1/inventario", json={"ciclo": "2026-08"})
    inv_id = inv.json()["id"]
    conciliacao = await client_operador.get(f"/api/v1/inventario/{inv_id}/conciliacao")
    assert conciliacao.status_code == 403


@pytest.mark.asyncio
async def test_aprovar_final_bloqueado_com_item_divergente_sem_decisao(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv_id = await _abrir_e_contar(client_tenant_a, produto_com_saldo_10, qtd_contada=7)
    await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/enviar-analise")

    aprovar = await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/aprovar-final")
    assert aprovar.status_code == 409


@pytest.mark.asyncio
async def test_fluxo_completo_aprovar_ajuste_grava_movimentacao_e_impacto_financeiro(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    # custo_medio default do produto é 0 nesta fixture — atualiza pra testar o impacto financeiro
    await client_tenant_a.patch(f"/api/v1/produtos/{produto_com_saldo_10}", json={"custo_medio": 5.0})

    inv_id = await _abrir_e_contar(client_tenant_a, produto_com_saldo_10, qtd_contada=7)  # diverge -3
    await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/enviar-analise")

    conciliacao = await client_tenant_a.get(f"/api/v1/inventario/{inv_id}/conciliacao")
    assert conciliacao.status_code == 200, conciliacao.text
    item = conciliacao.json()["itens"][0]
    assert item["qtd_anterior"] == 10
    assert item["divergencia"] == -3

    decisao = await client_tenant_a.patch(
        f"/api/v1/inventario/{inv_id}/itens/{produto_com_saldo_10}/decisao", json={"acao": "aprovar"}
    )
    assert decisao.status_code == 200, decisao.text

    aprovar = await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/aprovar-final")
    assert aprovar.status_code == 200, aprovar.text
    assert aprovar.json()["itens_ajustados"] == 1
    assert aprovar.json()["inventario"]["status"] == "fechado"

    saldo = await client_tenant_a.get("/api/v1/estoque/painel")
    produto_no_estoque = next(p for p in saldo.json()["itens"] if p["produto_id"] == produto_com_saldo_10)
    assert produto_no_estoque["saldo"] == 7  # ajuste real gravado


@pytest.mark.asyncio
async def test_recontagem_solicitada_permite_operador_recontar_com_ciclo_em_analise(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv_id = await _abrir_e_contar(client_tenant_a, produto_com_saldo_10, qtd_contada=7)
    await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/enviar-analise")

    recontagem = await client_tenant_a.patch(
        f"/api/v1/inventario/{inv_id}/itens/{produto_com_saldo_10}/decisao", json={"acao": "recontagem"}
    )
    assert recontagem.status_code == 200, recontagem.text
    assert recontagem.json()["status_item"] == "recontagem_solicitada"

    # Ciclo continua em_analise, mas o item liberou para nova contagem
    nova_contagem = await client_tenant_a.patch(
        f"/api/v1/inventario/{inv_id}/itens/{produto_com_saldo_10}", json={"qtd_contada": 10}
    )
    assert nova_contagem.status_code == 200, nova_contagem.text
    assert nova_contagem.json()["status_item"] == "contado"  # bateu com o sistema, sem mais divergência

    aprovar = await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/aprovar-final")
    assert aprovar.status_code == 200, aprovar.text


@pytest.mark.asyncio
async def test_obter_aberto_tambem_retoma_ciclo_em_analise(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    inv_id = await _abrir_e_contar(client_tenant_a, produto_com_saldo_10, qtd_contada=10)
    await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/enviar-analise")

    resp = await client_tenant_a.get("/api/v1/inventario/aberto")
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == inv_id
    assert resp.json()["status"] == "em_analise"


@pytest.mark.asyncio
async def test_upload_anexo_extensao_invalida_e_rejeitado(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    inv = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-08"})
    inv_id = inv.json()["id"]
    arquivo = io.BytesIO(b"conteudo qualquer")
    resp = await client_tenant_a.post(
        f"/api/v1/inventario/{inv_id}/itens/{produto_com_saldo_10}/anexo",
        files={"arquivo": ("foto.gif", arquivo, "image/gif")},
    )
    assert resp.status_code == 415, resp.text


@pytest.mark.asyncio
async def test_upload_anexo_valido_retorna_503_sem_storage_configurado(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    """Neste ambiente de teste SUPABASE_URL não está setado — confirma que o
    arquivo válido passa das validações e falha especificamente por falta de
    configuração de infraestrutura, mesmo padrão de test_usuarios_me.py."""
    inv = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-08"})
    inv_id = inv.json()["id"]
    arquivo = io.BytesIO(b"conteudo pequeno de imagem")
    resp = await client_tenant_a.post(
        f"/api/v1/inventario/{inv_id}/itens/{produto_com_saldo_10}/anexo",
        files={"arquivo": ("foto.jpg", arquivo, "image/jpeg")},
    )
    assert resp.status_code == 503, resp.text


@pytest.mark.asyncio
async def test_contagem_de_item_de_outro_tenant_retorna_404(
    client_tenant_a: AsyncClient, client_tenant_b: AsyncClient, produto_tenant_b_id: str
):
    inv = await client_tenant_a.post("/api/v1/inventario", json={"ciclo": "2026-08"})
    inv_id = inv.json()["id"]
    resp = await client_tenant_a.patch(
        f"/api/v1/inventario/{inv_id}/itens/{produto_tenant_b_id}", json={"qtd_contada": 5}
    )
    assert resp.status_code == 404
