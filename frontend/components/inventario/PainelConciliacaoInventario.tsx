"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { aprovarAjusteFinal, decidirItem, obterConciliacao } from "@/lib/api-inventario";
import { Conciliacao, ItemConciliacao } from "@/lib/types";
import { useToast, ConfirmDialog } from "@/components/ui";

const MOTIVO_LABEL: Record<string, string> = {
  avaria: "Avaria", vencimento: "Vencimento", furto: "Furto", erro_entrada: "Erro de Entrada",
};

function formatarReais(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function PainelConciliacaoInventario({
  inventarioId,
  onAprovado,
}: {
  inventarioId: string;
  onAprovado: () => void;
}) {
  const { erro: toastErro, sucesso: toastSucesso } = useToast();
  const [dados, setDados] = useState<Conciliacao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [decidindoId, setDecidindoId] = useState<string | null>(null);
  const [confirmandoAprovacao, setConfirmandoAprovacao] = useState(false);
  const [aprovando, setAprovando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setDados(await obterConciliacao(inventarioId));
    } catch {
      toastErro("Não foi possível carregar a conciliação.");
    } finally {
      setCarregando(false);
    }
  }, [inventarioId, toastErro]);

  useEffect(() => { carregar(); }, [carregar]);

  async function decidir(item: ItemConciliacao, acao: "aprovar" | "recontagem") {
    setDecidindoId(item.produto_id);
    try {
      const resultado = await decidirItem(inventarioId, item.produto_id, acao);
      setDados((atual) => atual ? {
        ...atual,
        itens: atual.itens.map((i) => i.produto_id === item.produto_id ? { ...i, status_item: resultado.status_item } : i),
        kpis: { ...atual.kpis, itens_aguardando_decisao: atual.kpis.itens_aguardando_decisao - 1 },
      } : atual);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível registrar a decisão.";
      toastErro(msg);
    } finally {
      setDecidindoId(null);
    }
  }

  async function confirmarAprovacaoFinal() {
    setAprovando(true);
    try {
      const resultado = await aprovarAjusteFinal(inventarioId);
      toastSucesso(`Ajuste de estoque aplicado — ${resultado.itens_ajustados} item(ns) atualizados.`);
      setConfirmandoAprovacao(false);
      onAprovado();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível aprovar o ajuste final.";
      toastErro(msg);
    } finally {
      setAprovando(false);
    }
  }

  if (carregando && !dados) {
    return <div className="rounded-xl border p-8 text-center text-sm" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}>Carregando conciliação...</div>;
  }
  if (!dados) return null;

  const pendentes = dados.kpis.itens_aguardando_decisao;

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
      <div className="px-5 py-3.5 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: "var(--cor-borda)" }}>
        <div>
          <h3 className="font-display font-semibold text-sm">Painel de Conciliação — Ciclo {dados.inventario.ciclo}</h3>
          {dados.enviado_por_nome && (
            <p className="text-xs mt-0.5" style={{ color: "var(--cor-texto-muted)" }}>
              Contado por {dados.enviado_por_nome}
              {dados.inventario.enviado_em && ` · finalizado em ${new Date(dados.inventario.enviado_em).toLocaleString("pt-BR")}`}
            </p>
          )}
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ color: "#F59E0B", background: "rgba(245,158,11,0.16)" }}>Aguardando Aprovação</span>
      </div>

      <div className="grid grid-cols-3 gap-2.5 p-3.5">
        <div className="rounded-lg border p-3" style={{ borderColor: "var(--cor-borda)" }}>
          <div className="text-xl font-display font-bold">{dados.kpis.itens_divergentes}</div>
          <div className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>Itens divergentes</div>
        </div>
        <div className="rounded-lg border p-3" style={{ borderColor: "var(--cor-borda)" }}>
          <div className="text-xl font-display font-bold" style={{ color: pendentes > 0 ? "#F59E0B" : "var(--cor-sucesso)" }}>{pendentes}</div>
          <div className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>Aguardando decisão</div>
        </div>
        <div className="rounded-lg border p-3" style={{ borderColor: "var(--cor-borda)" }}>
          <div className="text-xl font-display font-bold" style={{ color: dados.kpis.impacto_financeiro_total < 0 ? "var(--cor-alerta)" : "var(--cor-sucesso)" }}>
            {formatarReais(dados.kpis.impacto_financeiro_total)}
          </div>
          <div className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>Impacto financeiro total</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left px-5 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Produto</th>
              <th className="text-right px-3 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Qtd. Anterior</th>
              <th className="text-right px-3 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Qtd. Contada</th>
              <th className="text-right px-3 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Diferença</th>
              <th className="text-right px-3 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Impacto (R$)</th>
              <th className="text-left px-5 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {dados.itens.map((item) => (
              <tr key={item.produto_id} style={{ borderTop: "1px solid var(--cor-borda)" }}>
                <td className="px-5 py-2.5">
                  <div className="font-medium">{item.produto_nome}</div>
                  {item.motivo && <div className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>Motivo: {MOTIVO_LABEL[item.motivo]}</div>}
                </td>
                <td className="px-3 py-2.5 text-right">{item.qtd_anterior}</td>
                <td className="px-3 py-2.5 text-right">{item.qtd_contada ?? "—"}</td>
                <td className="px-3 py-2.5 text-right font-semibold" style={{ color: !item.divergencia ? "var(--cor-texto-muted)" : item.divergencia > 0 ? "var(--cor-sucesso)" : "var(--cor-alerta)" }}>
                  {item.divergencia === null ? "—" : item.divergencia > 0 ? `+${item.divergencia}` : item.divergencia}
                </td>
                <td className="px-3 py-2.5 text-right font-medium" style={{ color: !item.impacto_financeiro ? "var(--cor-texto-muted)" : item.impacto_financeiro > 0 ? "var(--cor-sucesso)" : "var(--cor-alerta)" }}>
                  {item.impacto_financeiro === null ? "—" : formatarReais(item.impacto_financeiro)}
                </td>
                <td className="px-5 py-2.5">
                  {item.status_item === "divergente" || item.status_item === "recontagem_solicitada" ? (
                    item.status_item === "recontagem_solicitada" ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "#F59E0B", background: "rgba(245,158,11,0.16)" }}>Recontagem solicitada</span>
                    ) : (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => decidir(item, "aprovar")}
                          disabled={decidindoId === item.produto_id}
                          className="rounded-md px-2.5 py-1.5 text-xs font-bold disabled:opacity-60"
                          style={{ color: "var(--cor-acento)", background: "rgba(16,185,129,0.14)" }}
                        >
                          Aprovar Ajuste
                        </button>
                        <button
                          onClick={() => decidir(item, "recontagem")}
                          disabled={decidindoId === item.produto_id}
                          className="rounded-md px-2.5 py-1.5 text-xs font-bold border disabled:opacity-60"
                          style={{ color: "var(--cor-texto-muted)", borderColor: "var(--cor-borda)" }}
                        >
                          Recontagem
                        </button>
                      </div>
                    )
                  ) : item.status_item === "aprovado" ? (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-sucesso)", background: "rgba(16,185,129,0.14)" }}>Ajuste aprovado</span>
                  ) : item.status_item === "pendente" ? (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }}>Não contado</span>
                  ) : (
                    <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>Sem divergência</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3.5 border-t flex flex-col gap-3 md:flex-row md:items-center md:justify-between" style={{ borderColor: "var(--cor-borda)" }}>
        <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>
          {pendentes > 0 ? `${pendentes} item(ns) ainda precisam de decisão` : "Todos os itens já foram decididos"}
        </span>
        <button
          onClick={() => setConfirmandoAprovacao(true)}
          disabled={pendentes > 0}
          className="rounded-md px-4 py-2.5 font-bold text-sm disabled:opacity-40"
          style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
        >
          Aprovar e Ajustar Estoque Real
        </button>
      </div>

      <ConfirmDialog
        aberto={confirmandoAprovacao}
        titulo="Aprovar e ajustar estoque real?"
        descricao="Essa ação grava as movimentações de ajuste no estoque e não pode ser desfeita. A trilha de auditoria vai registrar operador, supervisor e horário."
        labelConfirmar="Confirmar ajuste"
        confirmando={aprovando}
        onConfirmar={confirmarAprovacaoFinal}
        onCancelar={() => setConfirmandoAprovacao(false)}
      />
    </div>
  );
}
