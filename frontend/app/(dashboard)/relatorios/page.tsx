"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Produto } from "@/lib/types";

type Sugestao = { produto_id: string; produto_nome: string; saldo_atual: number; estoque_minimo: number; quantidade_sugerida: number };

export default function RelatoriosPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);

  useEffect(() => {
    apiFetch<Produto[]>("/produtos").then(setProdutos).catch(() => {});
    apiFetch<Sugestao[]>("/compras/sugestao-reposicao").then(setSugestoes).catch(() => {});
  }, []);

  const valorTotalEstoque = produtos.reduce((s, p) => s + p.custo_medio * p.estoque_minimo, 0);

  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Relatórios</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Indicadores de gestão
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>Produtos cadastrados</span>
          <div className="font-display text-2xl font-semibold mt-1">{produtos.length}</div>
        </div>
        <div className="rounded-xl border p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <span className="text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>Produtos precisando reposição</span>
          <div className="font-display text-2xl font-semibold mt-1">{sugestoes.length}</div>
        </div>
      </div>

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
        <div className="px-5 py-3.5 border-b" style={{ borderColor: "var(--cor-borda)" }}>
          <h3 className="font-display font-semibold text-sm">Sugestão de reposição</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              {["Produto", "Saldo atual", "Mínimo", "Sugestão de compra"].map((h) => (
                <th key={h} className="text-left px-5 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sugestoes.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-6 text-center" style={{ color: "var(--cor-texto-muted)" }}>Nenhum produto abaixo do mínimo no momento.</td></tr>
            )}
            {sugestoes.map((s) => (
              <tr key={s.produto_id} style={{ borderTop: "1px solid var(--cor-borda)" }}>
                <td className="px-5 py-2.5">{s.produto_nome}</td>
                <td className="px-3 py-2.5" style={{ color: "var(--cor-alerta)" }}>{s.saldo_atual}</td>
                <td className="px-3 py-2.5" style={{ color: "var(--cor-texto-muted)" }}>{s.estoque_minimo}</td>
                <td className="px-3 py-2.5 font-semibold">{s.quantidade_sugerida}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
