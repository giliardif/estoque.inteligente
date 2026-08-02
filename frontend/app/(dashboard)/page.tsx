"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Alerta = { id: string; tipo: string; mensagem: string };

type SaldoProduto = { produto_id: string; nome: string; saldo: number; estoque_minimo: number; abaixo_do_minimo: boolean };

export default function PainelPage() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [saldos, setSaldos] = useState<SaldoProduto[]>([]);

  useEffect(() => {
    apiFetch<Alerta[]>("/alertas?apenas_nao_lidos=true").then(setAlertas).catch(() => {});
    apiFetch<SaldoProduto[]>("/estoque/saldo").then(setSaldos).catch(() => {});
  }, []);

  const abaixoDoMinimo = saldos.filter((s) => s.abaixo_do_minimo);

  return (
    <div className="max-w-5xl flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Painel geral</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Visão consolidada do estoque
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 items-start">
        <div className="rounded-xl border p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <h3 className="font-display font-semibold text-sm mb-3">Alertas em aberto</h3>
          {alertas.length === 0 && (
            <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>Nenhum alerta no momento.</p>
          )}
          <div className="flex flex-col gap-2">
            {alertas.map((a) => (
              <div key={a.id} className="text-sm px-3 py-2 rounded-md" style={{ background: "var(--cor-base)" }}>
                {a.mensagem}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <h3 className="font-display font-semibold text-sm mb-3">Estoque abaixo do mínimo</h3>
          {abaixoDoMinimo.length === 0 && (
            <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>Tudo dentro do esperado — {saldos.length} produto(s) monitorado(s).</p>
          )}
          <div className="flex flex-col gap-2">
            {abaixoDoMinimo.map((s) => (
              <div key={s.produto_id} className="flex items-center justify-between text-sm px-3 py-2 rounded-md" style={{ background: "var(--cor-base)" }}>
                <span>{s.nome}</span>
                <span style={{ color: "var(--cor-alerta)" }}>{s.saldo} / mín. {s.estoque_minimo}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
