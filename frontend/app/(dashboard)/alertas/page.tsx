"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { Bell, Check, Power, RefreshCw } from "lucide-react";

type Alerta = { id: string; tipo: string; produto_id: string; mensagem: string; lido: boolean; criado_em: string };

type Regra = { id: string; tipo: string; parametros: Record<string, number>; ativo: boolean };

const TIPO_LABEL: Record<string, string> = {
  validade: "Validade",
  estoque_baixo: "Estoque baixo",
  produto_parado: "Produto parado",
};

// Campo numérico configurável de cada tipo de regra, se houver — usado pra
// renderizar o input de parâmetro certo sem hardcodar um formulário por tipo.
const PARAM_KEY: Record<string, string | null> = {
  validade: "dias_antes",
  produto_parado: "dias_sem_movimento",
  estoque_baixo: null, // sem parâmetro configurável — compara direto com estoque_minimo do produto
};

export default function AlertasPage() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [executando, setExecutando] = useState(false);

  async function carregarRegras() {
    try {
      const dados = await apiFetch<Regra[]>("/alertas/regras");
      setRegras(dados);
    } catch {
      // se o tenant ainda não configurou nenhuma regra, o motor usa os padrões — falha aqui não é crítica
    }
  }

  async function alternarAtiva(regra: Regra) {
    setErro(null);
    try {
      const atualizada = await apiFetch<Regra>(`/alertas/regras/${regra.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativo: !regra.ativo }),
      });
      setRegras((atual) => atual.map((r) => (r.id === regra.id ? atualizada : r)));
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível atualizar a regra.");
    }
  }

  async function atualizarParametro(regra: Regra, valor: number) {
    const chave = PARAM_KEY[regra.tipo];
    if (!chave) return;
    setErro(null);
    try {
      const atualizada = await apiFetch<Regra>(`/alertas/regras/${regra.id}`, {
        method: "PATCH",
        body: JSON.stringify({ parametros: { ...regra.parametros, [chave]: valor } }),
      });
      setRegras((atual) => atual.map((r) => (r.id === regra.id ? atualizada : r)));
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível atualizar o parâmetro.");
    }
  }

  async function carregar() {
    try {
      const dados = await apiFetch<Alerta[]>("/alertas?apenas_nao_lidos=true");
      setAlertas(dados);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível carregar os alertas.");
    }
  }

  useEffect(() => {
    carregar();
    carregarRegras();
  }, []);

  async function executarMotor() {
    setExecutando(true);
    setErro(null);
    try {
      await apiFetch("/alertas/executar", { method: "POST" });
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível executar o motor de alertas.");
    } finally {
      setExecutando(false);
    }
  }

  async function marcarLido(id: string) {
    await apiFetch(`/alertas/${id}/marcar-lido`, { method: "POST" }).catch(() => {});
    setAlertas((atual) => atual.filter((a) => a.id !== id));
  }

  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Alertas</h1>
          <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
            Validade, estoque baixo e produtos parados
          </p>
        </div>
        <button
          onClick={executarMotor}
          disabled={executando}
          className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-bold disabled:opacity-60"
          style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
        >
          <RefreshCw size={14} className={executando ? "animate-spin" : ""} />
          {executando ? "Executando..." : "Executar motor agora"}
        </button>
      </div>

      {erro && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
          {erro}
        </div>
      )}

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
        <div className="px-5 py-3.5 border-b" style={{ borderColor: "var(--cor-borda)" }}>
          <h3 className="font-display font-semibold text-sm">Regras configuradas</h3>
        </div>
        {regras.length === 0 && (
          <p className="text-sm px-5 py-4" style={{ color: "var(--cor-texto-muted)" }}>
            Nenhuma regra customizada — o motor usa os padrões (validade: 5 dias antes, produto parado: 30 dias).
          </p>
        )}
        <div className="flex flex-col">
          {regras.map((r) => {
            const chaveParam = PARAM_KEY[r.tipo];
            return (
              <div key={r.id} className="flex items-center gap-3 px-5 py-3" style={{ borderTop: "1px solid #221D18" }}>
                <span className="text-sm flex-1">{TIPO_LABEL[r.tipo] ?? r.tipo}</span>
                {chaveParam && (
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--cor-texto-muted)" }}>
                    {chaveParam === "dias_antes" ? "Dias antes" : "Dias sem movimento"}
                    <input
                      type="number" min="1"
                      value={r.parametros?.[chaveParam] ?? ""}
                      onChange={(e) => atualizarParametro(r, Number(e.target.value))}
                      className="w-16 rounded-md px-2 py-1 text-sm outline-none border"
                      style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                    />
                  </label>
                )}
                <button
                  onClick={() => alternarAtiva(r)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md"
                  style={
                    r.ativo
                      ? { color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }
                      : { color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }
                  }
                >
                  <Power size={12} />
                  {r.ativo ? "Ativa" : "Desativada"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {alertas.length === 0 && (
        <div className="rounded-xl border p-8 text-center flex flex-col items-center gap-2" style={{ borderColor: "var(--cor-borda)" }}>
          <Bell size={22} style={{ color: "var(--cor-texto-muted)" }} />
          <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>Nenhum alerta em aberto no momento.</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {alertas.map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-3 rounded-xl border px-4 py-3"
            style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
          >
            <span
              className="text-xs font-semibold px-2 py-1 rounded-full shrink-0"
              style={{ color: "var(--cor-acento)", background: "rgba(201,134,43,0.14)" }}
            >
              {TIPO_LABEL[a.tipo] ?? a.tipo}
            </span>
            <span className="text-sm flex-1">{a.mensagem}</span>
            <button onClick={() => marcarLido(a.id)} style={{ color: "var(--cor-texto-muted)" }} title="Marcar como lido">
              <Check size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
