"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle, Archive, Sparkles, ShoppingBag } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/ui";
import type { PainelInteligencia } from "@/lib/types";

function formatarDataHora(iso: string | null): string {
  if (!iso) return "ainda não analisado";
  const data = new Date(iso);
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  const hora = data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return mesmoDia ? `hoje às ${hora}` : `${data.toLocaleDateString("pt-BR")} às ${hora}`;
}

function SeloTendencia({ tendencia }: { tendencia: "alta" | "baixa" | "estavel" }) {
  const mapa = {
    alta: { texto: "tendência de alta", cor: "var(--cor-sucesso)", bg: "rgba(16,185,129,0.14)", Icone: TrendingUp },
    baixa: { texto: "tendência de baixa", cor: "var(--cor-alerta)", bg: "rgba(239,68,68,0.14)", Icone: TrendingDown },
    estavel: { texto: "estável", cor: "var(--cor-texto-muted)", bg: "rgba(130,145,168,0.14)", Icone: Minus },
  } as const;
  const { texto, cor, bg, Icone } = mapa[tendencia];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold whitespace-nowrap"
      style={{ color: cor, background: bg }}
    >
      <Icone size={11} /> {texto}
    </span>
  );
}

function SeloRisco({ risco }: { risco: "alto" | "medio" | "baixo" }) {
  const mapa = {
    alto: { texto: "alto — repor já", cor: "var(--cor-status-esgotado)", bg: "var(--cor-status-esgotado-bg)" },
    medio: { texto: "atenção", cor: "var(--cor-status-minimo)", bg: "var(--cor-status-minimo-bg)" },
    baixo: { texto: "baixo", cor: "var(--cor-texto-muted)", bg: "rgba(130,145,168,0.14)" },
  } as const;
  const { texto, cor, bg } = mapa[risco];
  return (
    <span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ color: cor, background: bg }}>
      {texto}
    </span>
  );
}

function Cartao({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-2.5"
      style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
    >
      {children}
    </div>
  );
}

function Metrica({ label, valor, destaque, risco }: { label: string; valor: string; destaque?: boolean; risco?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>{label}</span>
      <span
        className="text-[15px] font-bold font-display"
        style={{ color: risco ? "var(--cor-alerta)" : destaque ? "var(--cor-acento-soft)" : "var(--cor-texto)" }}
      >
        {valor}
      </span>
    </div>
  );
}

function Narrativa({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <div className="text-[12px] leading-relaxed" style={{ color: "#C7D0DE" }}>
      <span className="block text-[8.5px] font-bold tracking-wide mb-1" style={{ color: "var(--cor-texto-muted)" }}>
        ANÁLISE
      </span>
      {texto}
    </div>
  );
}

export default function InteligenciaPage() {
  const [painel, setPainel] = useState<PainelInteligencia | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [analisando, setAnalisando] = useState(false);
  const [criandoPedidoId, setCriandoPedidoId] = useState<string | null>(null);
  const { sucesso, erro } = useToast();

  const carregarPainel = useCallback(async () => {
    try {
      const dados = await apiFetch<PainelInteligencia>("/inteligencia/painel");
      setPainel(dados);
    } catch {
      erro("Não foi possível carregar a Inteligência.");
    } finally {
      setCarregando(false);
    }
  }, [erro]);

  useEffect(() => {
    carregarPainel();
  }, [carregarPainel]);

  async function atualizarAnalise() {
    setAnalisando(true);
    try {
      const dados = await apiFetch<PainelInteligencia>("/inteligencia/analisar", { method: "POST" });
      setPainel(dados);
      sucesso("Análise atualizada.");
    } catch {
      erro("Não foi possível rodar a análise agora.");
    } finally {
      setAnalisando(false);
    }
  }

  async function criarPedido(produtoId: string) {
    setCriandoPedidoId(produtoId);
    try {
      await apiFetch("/inteligencia/reposicao/criar-pedido", {
        method: "POST",
        body: JSON.stringify({ produto_id: produtoId }),
      });
      sucesso("Pedido de compra criado.");
    } catch {
      erro("Não foi possível criar o pedido de compra.");
    } finally {
      setCriandoPedidoId(null);
    }
  }

  if (carregando) {
    return <div className="p-8 text-sm" style={{ color: "var(--cor-texto-muted)" }}>Carregando…</div>;
  }

  const semNadaAinda =
    painel &&
    painel.reposicoes.length === 0 &&
    painel.indicadores_giro.length === 0 &&
    painel.anomalias.length === 0 &&
    painel.dead_stock.length === 0;

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-[22px] font-display font-semibold">Inteligência</h1>
          <p className="text-[13px]" style={{ color: "var(--cor-texto-muted)" }}>
            Previsão de demanda, anomalias e itens parados — calculado a partir do seu histórico de movimentações.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span
            className="text-[11px] rounded-full border px-2.5 py-1.5 flex items-center gap-1.5"
            style={{ color: "var(--cor-texto-muted)", borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cor-acento)" }} />
            Última análise: {formatarDataHora(painel?.ultima_analise_em ?? null)}
          </span>
          <button
            onClick={atualizarAnalise}
            disabled={analisando}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--cor-marca-azul)" }}
          >
            <RefreshCw size={14} className={analisando ? "animate-spin" : ""} />
            {analisando ? "Analisando…" : "Atualizar análise"}
          </button>
        </div>
      </div>

      {semNadaAinda && (
        <div className="rounded-xl border border-dashed p-6 text-center text-[12.5px]" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}>
          Nenhuma análise rodada ainda. Clique em &quot;Atualizar análise&quot; pra calcular os primeiros insights.
        </div>
      )}

      {painel?.resumo_semanal && (
        <div
          className="rounded-2xl border p-5 mb-6 flex gap-4"
          style={{
            background: "linear-gradient(135deg, rgba(37,99,235,0.14), rgba(16,185,129,0.10))",
            borderColor: "var(--cor-borda)",
          }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "linear-gradient(135deg, var(--cor-marca-azul), var(--cor-acento))" }}
          >
            <Sparkles size={18} color="white" />
          </div>
          <div>
            <div className="text-[13px] font-display font-semibold flex items-center gap-2 mb-1.5">
              Resumo da semana
              <span
                className="text-[9px] font-bold tracking-wide rounded-full px-2 py-0.5 border"
                style={{ color: "var(--cor-acento-soft)", borderColor: "rgba(52,211,153,0.3)", background: "rgba(255,255,255,0.08)" }}
              >
                NARRADO POR IA
              </span>
            </div>
            <p className="text-[13.5px] leading-relaxed" style={{ color: "#E5E9F0" }}>{painel.resumo_semanal}</p>
          </div>
        </div>
      )}

      {!!painel?.reposicoes.length && (
        <section className="mb-7">
          <h2 className="text-[15px] font-display font-semibold mb-3">Sugestões de reposição</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {painel.reposicoes.filter((r) => r.precisa_repor).map((r) => (
              <Cartao key={r.produto_id}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-[13.5px]">{r.produto_nome}</span>
                  <SeloTendencia tendencia={r.tendencia} />
                </div>
                <div className="flex gap-4 py-2.5 border-y" style={{ borderColor: "var(--cor-borda)" }}>
                  <Metrica label="Estoque atual" valor={`${r.estoque_atual} un`} />
                  <Metrica label="Demanda/dia" valor={`${r.demanda_media_dia} un`} />
                  <Metrica label="Repor" valor={`${r.quantidade_sugerida} un`} destaque />
                </div>
                <Narrativa texto={r.narrativa} />
                <button
                  onClick={() => criarPedido(r.produto_id)}
                  disabled={criandoPedidoId === r.produto_id}
                  className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-[11.5px] font-bold disabled:opacity-60"
                  style={{ background: "var(--cor-acento)", color: "#06251c" }}
                >
                  <ShoppingBag size={13} />
                  {criandoPedidoId === r.produto_id ? "Criando…" : "Criar pedido de compra"}
                </button>
              </Cartao>
            ))}
          </div>
        </section>
      )}

      {!!painel?.indicadores_giro.length && (
        <section className="mb-7">
          <h2 className="text-[15px] font-display font-semibold mb-3">Giro e cobertura</h2>
          <div className="rounded-xl border overflow-hidden" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
            <table className="w-full text-[12.5px] border-collapse">
              <thead>
                <tr className="text-left" style={{ background: "rgba(255,255,255,0.02)" }}>
                  {["Produto", "Giro (período)", "Cobertura", "Risco de ruptura"].map((titulo) => (
                    <th key={titulo} className="px-4 py-2.5 text-[10.5px] uppercase tracking-wide font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
                      {titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {painel.indicadores_giro.map((g) => (
                  <tr key={g.produto_id} className="border-t" style={{ borderColor: "var(--cor-borda)" }}>
                    <td className="px-4 py-2.5 font-semibold">{g.produto_nome}</td>
                    <td className="px-4 py-2.5">{g.giro_periodo}x</td>
                    <td className="px-4 py-2.5">{g.cobertura_dias !== null ? `~${g.cobertura_dias} dias` : "—"}</td>
                    <td className="px-4 py-2.5"><SeloRisco risco={g.risco_ruptura} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!!painel?.anomalias.length && (
        <section className="mb-7">
          <h2 className="text-[15px] font-display font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle size={16} style={{ color: "var(--cor-acento)" }} /> Anomalias detectadas
          </h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {painel.anomalias.map((a) => (
              <Cartao key={a.produto_id}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-[13.5px]">{a.produto_nome}</span>
                  <span
                    className="text-[10px] font-bold rounded-full px-2.5 py-1"
                    style={{
                      color: a.classificacao === "pico" ? "var(--cor-status-novo)" : "var(--cor-status-esgotado)",
                      background: a.classificacao === "pico" ? "var(--cor-status-novo-bg)" : "var(--cor-status-esgotado-bg)",
                    }}
                  >
                    {a.classificacao === "pico" ? "▲ pico fora do padrão" : "▼ queda brusca"}
                  </span>
                </div>
                <div className="flex gap-4 py-2.5 border-y" style={{ borderColor: "var(--cor-borda)" }}>
                  <Metrica label="Média semanal" valor={`${a.media_historica} un`} />
                  <Metrica label="Esta semana" valor={`${a.semana_atual} un`} destaque />
                </div>
                <Narrativa texto={a.narrativa} />
              </Cartao>
            ))}
          </div>
        </section>
      )}

      {!!painel?.dead_stock.length && (
        <section className="mb-7">
          <h2 className="text-[15px] font-display font-semibold mb-3 flex items-center gap-2">
            <Archive size={16} style={{ color: "var(--cor-acento)" }} /> Estoque parado (dead stock)
          </h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {painel.dead_stock.map((d) => (
              <Cartao key={d.produto_id}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-[13.5px]">{d.produto_nome}</span>
                  <span
                    className="text-[10px] font-bold rounded-full px-2.5 py-1"
                    style={{ color: "var(--cor-status-minimo)", background: "var(--cor-status-minimo-bg)" }}
                  >
                    parado há {d.dias_parado} dias
                  </span>
                </div>
                <div className="flex gap-4 py-2.5 border-y" style={{ borderColor: "var(--cor-borda)" }}>
                  <Metrica label="Estoque parado" valor={`${d.saldo_parado} un`} />
                  <Metrica label="Valor em risco" valor={`R$ ${d.valor_em_risco.toFixed(2)}`} risco />
                </div>
                <Narrativa texto={d.narrativa} />
              </Cartao>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
