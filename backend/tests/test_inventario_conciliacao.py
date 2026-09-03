"""
Testa o fluxo de encerramento e aprovação do inventário (Etapa 39) e a
recontagem com limite de 3 tentativas + log de auditoria (Etapa 39.1):
  operador conta (contagem cega — nunca vê qtd_sistema nem divergência) ->
  se divergir, confirma/recontar até 3x -> envia para análise -> supervisor
  concilia e decide item a item -> aprova o ajuste final (só aí grava
  movimentação real).
"""
import io

import pytest
from httpx import AsyncClient


async def _abrir(client: AsyncClient, ciclo: str = "2026-08") -> str:
    inv = await client.post("/api/v1/inventario", json={"ciclo": ciclo})
    assert inv.status_code == 201, inv.text
    return inv.json()["id"]


async def _contar(client: AsyncClient, inv_id: str, produto_id: str, qtd: float) -> dict:
    resp = await client.patch(f"/api/v1/inventario/{inv_id}/itens/{produto_id}/contagem", json={"qtd_contada": qtd})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _abrir_contar_e_bater(client: AsyncClient, produto_id: str, ciclo: str = "2026-08") -> str:
    inv_id = await _abrir(client, ciclo)
    resultado = await _contar(client, inv_id, produto_id, 10)
    assert resultado["status_item"] == "contado"
    return inv_id


async def _abrir_divergir_e_manter(client: AsyncClient, produto_id: str, qtd: float = 7, ciclo: str = "2026-08") -> str:
    inv_id = await _abrir(client, ciclo)
    resultado = await _contar(client, inv_id, produto_id, qtd)
    assert resultado["status_item"] == "aguardando_confirmacao"
    manter = await client.post(f"/api/v1/inventario/{inv_id}/itens/{produto_id}/manter-divergencia")
    assert manter.status_code == 200, manter.text
    assert manter.json()["status_item"] == "divergente"
    return inv_id


@pytest.mark.asyncio
async def test_abrir_inventario_pre_popula_item_pendente_para_produto_ativo(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv_id = await _abrir(client_tenant_a)
    painel = await client_tenant_a.get(f"/api/v1/inventario/{inv_id}/operador")
    assert painel.status_code == 200, painel.text
    corpo = painel.json()
    assert corpo["progresso"]["total"] == 1
    assert corpo["progresso"]["contados"] == 0
    assert corpo["resumo"]["pendentes"] == 1
    item = corpo["itens"][0]
    assert item["produto_id"] == produto_com_saldo_10
    assert item["status_item"] == "pendente"
    assert item["tentativas"] == 0
    assert "qtd_sistema" not in item


@pytest.mark.asyncio
async def test_contagem_batendo_finaliza_direto_como_contado(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    inv_id = await _abrir(client_tenant_a)
    resultado = await _contar(client_tenant_a, inv_id, produto_com_saldo_10, 10)
    assert resultado == {
        "produto_id": produto_com_saldo_10, "status_item": "contado", "tentativas": 1, "limite_atingido": False,
    }


@pytest.mark.asyncio
async def test_painel_operador_nunca_expoe_divergencia_nem_saldo_do_sistema(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv_id = await _abrir(client_tenant_a)
    await _contar(client_tenant_a, inv_id, produto_com_saldo_10, 7)

    painel = await client_tenant_a.get(f"/api/v1/inventario/{inv_id}/operador")
    corpo_bruto = painel.text
    assert '"qtd_sistema"' not in corpo_bruto
    assert '"divergencia":' not in corpo_bruto  # resumo tem sem_/com_divergencia — substring válida, não é isso que testamos
    item = painel.json()["itens"][0]
    assert item["status_item"] == "aguardando_confirmacao"
    assert item["tentativas"] == 1


@pytest.mark.asyncio
async def test_terceira_tentativa_divergente_finaliza_automaticamente(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv_id = await _abrir(client_tenant_a)

    t1 = await _contar(client_tenant_a, inv_id, produto_com_saldo_10, 7)
    assert t1 == {"produto_id": produto_com_saldo_10, "status_item": "aguardando_confirmacao", "tentativas": 1, "limite_atingido": False}

    t2 = await _contar(client_tenant_a, inv_id, produto_com_saldo_10, 8)
    assert t2["status_item"] == "aguardando_confirmacao"
    assert t2["tentativas"] == 2
    assert t2["limite_atingido"] is False

    t3 = await _contar(client_tenant_a, inv_id, produto_com_saldo_10, 9)
    assert t3["status_item"] == "divergente"
    assert t3["tentativas"] == 3
    assert t3["limite_atingido"] is True

    resp = await client_tenant_a.patch(
        f"/api/v1/inventario/{inv_id}/itens/{produto_com_saldo_10}/contagem", json={"qtd_contada": 10}
    )
    assert resp.status_code == 409, resp.text


@pytest.mark.asyncio
async def test_manter_divergencia_finaliza_sem_consumir_nova_tentativa(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv_id = await _abrir(client_tenant_a)
    resultado = await _contar(client_tenant_a, inv_id, produto_com_saldo_10, 7)
    assert resultado["tentativas"] == 1

    manter = await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/itens/{produto_com_saldo_10}/manter-divergencia")
    assert manter.status_code == 200, manter.text
    assert manter.json() == {
        "produto_id": produto_com_saldo_10, "status_item": "divergente", "tentativas": 1, "limite_atingido": True,
    }


@pytest.mark.asyncio
async def test_manter_divergencia_rejeitado_se_nao_estiver_aguardando_confirmacao(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv_id = await _abrir(client_tenant_a)
    resp = await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/itens/{produto_com_saldo_10}/manter-divergencia")
    assert resp.status_code == 409, resp.text


@pytest.mark.asyncio
async def test_justificativa_so_permitida_apos_item_finalizado_como_divergente(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv_id = await _abrir(client_tenant_a)
    await _contar(client_tenant_a, inv_id, produto_com_saldo_10, 7)

    antes = await client_tenant_a.patch(
        f"/api/v1/inventario/{inv_id}/itens/{produto_com_saldo_10}/justificativa", json={"motivo": "avaria"}
    )
    assert antes.status_code == 409, antes.text

    await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/itens/{produto_com_saldo_10}/manter-divergencia")

    depois = await client_tenant_a.patch(
        f"/api/v1/inventario/{inv_id}/itens/{produto_com_saldo_10}/justificativa", json={"motivo": "avaria"}
    )
    assert depois.status_code == 200, depois.text
    assert depois.json() == {"produto_id": produto_com_saldo_10, "motivo": "avaria", "anexo_url": None}


@pytest.mark.asyncio
async def test_enviar_analise_muda_status_e_nao_ajusta_estoque(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    inv_id = await _abrir_divergir_e_manter(client_tenant_a, produto_com_saldo_10, qtd=7)

    enviar = await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/enviar-analise")
    assert enviar.status_code == 200, enviar.text
    assert enviar.json()["inventario"]["status"] == "em_analise"

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
async def test_operador_nao_acessa_detalhe_do_ciclo(client_operador: AsyncClient):
    inv = await client_operador.post("/api/v1/inventario", json={"ciclo": "2026-08"})
    inv_id = inv.json()["id"]
    detalhe = await client_operador.get(f"/api/v1/inventario/{inv_id}/detalhe")
    assert detalhe.status_code == 403


@pytest.mark.asyncio
async def test_aprovar_final_bloqueado_com_item_divergente_sem_decisao(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv_id = await _abrir_divergir_e_manter(client_tenant_a, produto_com_saldo_10, qtd=7)
    await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/enviar-analise")

    aprovar = await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/aprovar-final")
    assert aprovar.status_code == 409


@pytest.mark.asyncio
async def test_fluxo_completo_aprovar_ajuste_grava_movimentacao_e_impacto_financeiro(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    await client_tenant_a.patch(f"/api/v1/produtos/{produto_com_saldo_10}", json={"custo_medio": 5.0})

    inv_id = await _abrir_divergir_e_manter(client_tenant_a, produto_com_saldo_10, qtd=7)
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
    assert produto_no_estoque["saldo"] == 7


@pytest.mark.asyncio
async def test_recontagem_solicitada_reseta_tentativas_e_libera_nova_rodada(
    client_tenant_a: AsyncClient, produto_com_saldo_10: str
):
    inv_id = await _abrir_divergir_e_manter(client_tenant_a, produto_com_saldo_10, qtd=7)
    await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/enviar-analise")

    recontagem = await client_tenant_a.patch(
        f"/api/v1/inventario/{inv_id}/itens/{produto_com_saldo_10}/decisao", json={"acao": "recontagem"}
    )
    assert recontagem.status_code == 200, recontagem.text
    assert recontagem.json()["status_item"] == "recontagem_solicitada"

    painel = await client_tenant_a.get(f"/api/v1/inventario/{inv_id}/operador")
    item = painel.json()["itens"][0]
    assert item["tentativas"] == 0

    nova_contagem = await _contar(client_tenant_a, inv_id, produto_com_saldo_10, 10)
    assert nova_contagem == {"produto_id": produto_com_saldo_10, "status_item": "contado", "tentativas": 1, "limite_atingido": False}

    aprovar = await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/aprovar-final")
    assert aprovar.status_code == 200, aprovar.text


@pytest.mark.asyncio
async def test_obter_aberto_tambem_retoma_ciclo_em_analise(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    inv_id = await _abrir_contar_e_bater(client_tenant_a, produto_com_saldo_10)
    await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/enviar-analise")

    resp = await client_tenant_a.get("/api/v1/inventario/aberto")
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == inv_id
    assert resp.json()["status"] == "em_analise"


@pytest.mark.asyncio
async def test_detalhe_ciclo_expoe_log_completo_de_tentativas(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    inv_id = await _abrir(client_tenant_a)
    await _contar(client_tenant_a, inv_id, produto_com_saldo_10, 8)
    await _contar(client_tenant_a, inv_id, produto_com_saldo_10, 10)
    await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/enviar-analise")
    await client_tenant_a.post(f"/api/v1/inventario/{inv_id}/aprovar-final")

    detalhe = await client_tenant_a.get(f"/api/v1/inventario/{inv_id}/detalhe")
    assert detalhe.status_code == 200, detalhe.text
    corpo = detalhe.json()
    assert corpo["inventario"]["status"] == "fechado"
    assert corpo["aprovado_por_nome"] is not None
    item = next(i for i in corpo["itens"] if i["produto_id"] == produto_com_saldo_10)
    assert len(item["tentativas_log"]) == 2
    assert item["tentativas_log"][0]["numero_tentativa"] == 1
    assert item["tentativas_log"][0]["qtd_contada"] == 8
    assert item["tentativas_log"][1]["numero_tentativa"] == 2
    assert item["tentativas_log"][1]["qtd_contada"] == 10


@pytest.mark.asyncio
async def test_upload_anexo_extensao_invalida_e_rejeitado(client_tenant_a: AsyncClient, produto_com_saldo_10: str):
    inv_id = await _abrir(client_tenant_a)
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
    inv_id = await _abrir(client_tenant_a)
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
    inv_id = await _abrir(client_tenant_a)
    resp = await client_tenant_a.patch(
        f"/api/v1/inventario/{inv_id}/itens/{produto_tenant_b_id}/contagem", json={"qtd_contada": 5}
    )
    assert resp.status_code == 404
