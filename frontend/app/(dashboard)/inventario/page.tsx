"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { Produto } from "@/lib/types";

type Inventario = { id: string; status: string; ciclo: string };

type InventarioResumo = { id: string; status: string; ciclo: string; criado_em: string };

export default function InventarioPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [inventario, setInventario] = useState<Inventario | null>(null);
  const [contagem, setContagem] = useState<Record<string, string>>({});
  const [ciclo, setCiclo] = useState(() => new Date().toISOString().slice(0, 7));
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);
  const [historico, setHistorico] = useState<InventarioResumo[]>([]);
  const [verificandoAberto, setVerificandoAberto] = useState(true);

  async function carregarHistorico() {
    try {
      const lista = await apiFetch<InventarioResumo[]>("/inventario?status=fechado&tamanho=20");
      setHistorico(lista);
    } catch {
      // histórico é informativo — não deve travar a tela de contagem
    }
  }

  useEffect(() => {
    apiFetch<Produto[]>("/produtos").then(setProdutos).catch(() => {});
    carregarHistorico();

    // Retomada: se já existe um inventário em aberto (ex.: página recarregada
    // no meio de uma contagem), carrega ele em vez de deixar o usuário perder
    // o progresso e não conseguir nem abrir um novo (backend bloqueia 2
    // inventários abertos ao mesmo tempo pro mesmo depósito).
    apiFetch<Inventario | null>("/inventario/aberto")
      .then((inv) => {
        if (inv) setInventario(inv);
      })
      .catch(() => {})
      .finally(() => setVerificandoAberto(false));
  }, []);

  async function abrirInventario() {
    setErro(null);
    setProcessando(true);
    try {
      const inv = await apiFetch<Inventario>("/inventario", { method: "POST", body: JSON.stringify({ ciclo }) });
      setInventario(inv);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível abrir o inventário.");
    } finally {
      setProcessando(false);
    }
  }

  async function fecharInventario() {
    if (!inventario) return;
    setErro(null);
    setSucesso(null);
    setProcessando(true);
    try {
      const itens = produtos
        .filter((p) => contagem[p.id] !== undefined && contagem[p.id] !== "")
        .map((p) => ({ produto_id: p.id, qtd_contada: Number(contagem[p.id]) }));

      if (itens.length === 0) {
        setErro("Informe a contagem de pelo menos um produto antes de fechar.");
        return;
      }

      await apiFetch(`/inventario/${inventario.id}/fechar`, { method: "POST", body: JSON.stringify({ itens }) });
      setSucesso("Inventário fechado — ajustes de estoque aplicados automaticamente.");
      setInventario(null);
      setContagem({});
      carregarHistorico();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível fechar o inventário.");
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Inventário</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Contagem física e reconciliação
        </p>
      </div>

      {erro && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
          {erro}
        </div>
      )}
      {sucesso && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }}>
          {sucesso}
        </div>
      )}

      {verificandoAberto && (
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>Verificando contagem em andamento...</p>
      )}

      {!verificandoAberto && !inventario && (
        <div className="rounded-xl border p-5 flex items-end gap-3" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            Ciclo
            <input
              value={ciclo}
              onChange={(e) => setCiclo(e.target.value)}
              className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            />
          </label>
          <button
            onClick={abrirInventario}
            disabled={processando}
            className="rounded-md px-4 py-2 font-bold text-sm disabled:opacity-60"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            Abrir ciclo de contagem
          </button>
        </div>
      )}

      {!verificandoAberto && inventario && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
          <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: "var(--cor-borda)" }}>
            <h3 className="font-display font-semibold text-sm">Contagem — ciclo {inventario.ciclo}</h3>
            <button
              onClick={fecharInventario}
              disabled={processando}
              className="rounded-md px-3.5 py-2 font-bold text-xs disabled:opacity-60"
              style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
            >
              {processando ? "Fechando..." : "Fechar contagem e ajustar estoque"}
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left px-5 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Produto</th>
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Contagem</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--cor-borda)" }}>
                  <td className="px-5 py-2">{p.nome}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number" min="0" step="0.01"
                      value={contagem[p.id] ?? ""}
                      onChange={(e) => setContagem({ ...contagem, [p.id]: e.target.value })}
                      className="rounded-md px-2 py-1 text-sm outline-none border w-24"
                      style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
        <div className="px-5 py-3.5 border-b" style={{ borderColor: "var(--cor-borda)" }}>
          <h3 className="font-display font-semibold text-sm">Inventários anteriores</h3>
        </div>
        {historico.length === 0 ? (
          <p className="text-sm px-5 py-4" style={{ color: "var(--cor-texto-muted)" }}>Nenhum inventário fechado ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                {["Ciclo", "Fechado em"].map((h) => (
                  <th key={h} className="text-left px-5 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historico.map((inv) => (
                <tr key={inv.id} style={{ borderTop: "1px solid var(--cor-borda)" }}>
                  <td className="px-5 py-2.5">{inv.ciclo}</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--cor-texto-muted)" }}>
                    {new Date(inv.criado_em).toLocaleDateString("pt-BR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
