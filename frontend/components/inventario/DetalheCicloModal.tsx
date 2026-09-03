"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { obterDetalheCiclo } from "@/lib/api-inventario";
import { DetalheCiclo, ItemDetalhe } from "@/lib/types";
import { useToast } from "@/components/ui";
import { ChevronDown, X } from "lucide-react";

const MOTIVO_LABEL: Record<string, string> = {
  avaria: "Avaria", vencimento: "Vencimento", furto: "Furto", erro_entrada: "Erro de Entrada",
};

function formatarReais(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarData(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function DetalheCicloModal({ inventarioId, onFechar }: { inventarioId: string; onFechar: () => void }) {
  const { erro: toastErro } = useToast();
  const [dados, setDados] = useState<DetalheCiclo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<"todos" | "divergentes">("todos");

  useEffect(() => {
    obterDetalheCiclo(inventarioId)
      .then(setDados)
      .catch((err) => toastErro(err instanceof ApiError ? err.message : "Não foi possível carregar os detalhes do ciclo."))
      .finally(() => setCarregando(false));
  }, [inventarioId, toastErro]);

  const itens = dados?.itens.filter((i) => filtro === "todos" || (i.divergencia !== null && i.divergencia !== 0)) ?? [];
  const qtdDivergentes = dados?.itens.filter((i) => i.divergencia !== null && i.divergencia !== 0).length ?? 0;

  return (
    <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center" style={{ background: "rgba(10,8,6,0.6)" }} onClick={onFechar}>
      <div
        className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border"
        style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {carregando && (
          <div className="p-8 text-center text-sm" style={{ color: "var(--cor-texto-muted)" }}>Carregando detalhes...</div>
        )}

        {dados && (
          <>
            <div className="px-5 py-4 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--cor-borda)" }}>
              <div>
                <h2 className="font-display font-semibold text-base">Ciclo {dados.inventario.ciclo}</h2>
                <span
                  className="inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded-md"
                  style={
                    dados.inventario.status === "fechado"
                      ? { color: "var(--cor-texto-muted)", background: "rgba(130,145,168,0.14)" }
                      : { color: "#F59E0B", background: "rgba(245,158,11,0.16)" }
                  }
                >
                  {dados.inventario.status === "fechado" ? "Fechado" : "Em Análise"}
                </span>
              </div>
              <button onClick={onFechar} style={{ color: "var(--cor-texto-muted)" }}><X size={18} /></button>
            </div>

            <div className="px-5 py-3 border-b flex flex-col gap-1.5" style={{ borderColor: "var(--cor-borda)" }}>
              {dados.enviado_por_nome && (
                <div className="text-xs flex items-center gap-1.5">
                  <span style={{ color: "var(--cor-texto-muted)" }}>Contado por</span>
                  <span className="font-semibold">{dados.enviado_por_nome}</span>
                  {dados.inventario.enviado_em && <span style={{ color: "var(--cor-texto-muted)" }}>· {formatarData(dados.inventario.enviado_em)}</span>}
                </div>
              )}
              <div className="text-xs flex items-center gap-1.5">
                <span style={{ color: "var(--cor-texto-muted)" }}>Aprovado por</span>
                {dados.aprovado_por_nome ? (
                  <>
                    <span className="font-semibold">{dados.aprovado_por_nome}</span>
                    {dados.inventario.aprovado_em && <span style={{ color: "var(--cor-texto-muted)" }}>· {formatarData(dados.inventario.aprovado_em)}</span>}
                  </>
                ) : (
                  <span style={{ color: "var(--cor-texto-muted)" }}>— aguardando aprovação</span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5 p-3.5">
              <div className="rounded-lg border p-3" style={{ borderColor: "var(--cor-borda)" }}>
                <div className="text-lg font-display font-bold">{dados.itens.length}</div>
                <div className="text-[11px]" style={{ color: "var(--cor-texto-muted)" }}>Itens contados</div>
              </div>
              <div className="rounded-lg border p-3" style={{ borderColor: "var(--cor-borda)" }}>
                <div className="text-lg font-display font-bold" style={{ color: qtdDivergentes > 0 ? "var(--cor-alerta)" : undefined }}>{qtdDivergentes}</div>
                <div className="text-[11px]" style={{ color: "var(--cor-texto-muted)" }}>Divergentes</div>
              </div>
              <div className="rounded-lg border p-3" style={{ borderColor: "var(--cor-borda)" }}>
                <div className="text-lg font-display font-bold" style={{ color: dados.kpis.impacto_financeiro_total < 0 ? "var(--cor-alerta)" : "var(--cor-sucesso)" }}>
                  {formatarReais(dados.kpis.impacto_financeiro_total)}
                </div>
                <div className="text-[11px]" style={{ color: "var(--cor-texto-muted)" }}>Impacto financeiro</div>
              </div>
            </div>

            <div className="px-3.5 pb-2 flex gap-1.5">
              <button
                onClick={() => setFiltro("todos")}
                className="rounded-md px-3 py-1.5 text-xs font-semibold border"
                style={filtro === "todos" ? { borderColor: "var(--cor-acento)", color: "var(--cor-acento)", background: "rgba(16,185,129,0.1)" } : { borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
              >
                Todos
              </button>
              <button
                onClick={() => setFiltro("divergentes")}
                className="rounded-md px-3 py-1.5 text-xs font-semibold border"
                style={filtro === "divergentes" ? { borderColor: "var(--cor-acento)", color: "var(--cor-acento)", background: "rgba(16,185,129,0.1)" } : { borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
              >
                Divergentes ({qtdDivergentes})
              </button>
            </div>

            <div className="flex flex-col">
              {itens.map((item) => <LinhaItemHistorico key={item.produto_id} item={item} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LinhaItemHistorico({ item }: { item: ItemDetalhe }) {
  const [expandido, setExpandido] = useState(false);
  const divergente = item.divergencia !== null && item.divergencia !== 0;

  return (
    <div className="px-5 py-3 border-t" style={{ borderColor: "var(--cor-borda)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{item.produto_nome}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold">{item.qtd_contada ?? "—"}</span>
          <span
            className="text-[10.5px] font-bold px-2 py-0.5 rounded-full"
            style={
              divergente
                ? { color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }
                : { color: "var(--cor-sucesso)", background: "rgba(16,185,129,0.14)" }
            }
          >
            {item.status_item === "aprovado" ? "Ajuste aprovado" : divergente ? "Divergente" : "Batido"}
          </span>
        </div>
      </div>
      {item.motivo && (
        <div className="text-xs mt-1" style={{ color: "var(--cor-texto-muted)" }}>
          Motivo: {MOTIVO_LABEL[item.motivo]}
          {item.decidido_por_nome && ` · decidido por ${item.decidido_por_nome}`}
        </div>
      )}
      {item.tentativas_log.length > 0 && (
        <button onClick={() => setExpandido((e) => !e)} className="text-xs font-semibold mt-1.5 flex items-center gap-1" style={{ color: "var(--cor-acento)" }}>
          <ChevronDown size={12} style={{ transform: expandido ? "rotate(180deg)" : undefined, transition: "transform .15s" }} />
          {item.tentativas_log.length > 1 ? `Ver as ${item.tentativas_log.length} tentativas de contagem` : "Ver a tentativa de contagem"}
        </button>
      )}
      {expandido && (
        <div className="mt-2 p-2.5 rounded-md flex flex-col gap-1.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px dashed var(--cor-borda)" }}>
          {item.tentativas_log.map((t) => (
            <div key={t.numero_tentativa} className="flex items-center justify-between text-xs">
              <span style={{ color: "var(--cor-texto-muted)" }}>Tentativa {t.numero_tentativa}{t.numero_tentativa === item.tentativas_log.length ? " (final)" : ""}</span>
              <span className="font-semibold">{t.qtd_contada}</span>
              <span style={{ color: "var(--cor-texto-muted)" }}>{formatarData(t.criado_em)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
