"use client";

import { ReactNode } from "react";
import { X } from "lucide-react";

export type AcaoLote = {
  label: string;
  icon?: ReactNode;
  perigosa?: boolean;
  onClick: () => void;
};

export function BulkActionBar({
  quantidade, acoes, onLimpar,
}: { quantidade: number; acoes: AcaoLote[]; onLimpar: () => void }) {
  if (quantidade === 0) return null;

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm"
      style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-acento)" }}
    >
      <div className="flex items-center gap-2">
        <button onClick={onLimpar} aria-label="Limpar seleção" className="opacity-70 hover:opacity-100">
          <X size={15} />
        </button>
        <span className="font-semibold">{quantidade} selecionado{quantidade > 1 ? "s" : ""}</span>
      </div>
      <div className="flex items-center gap-2">
        {acoes.map((acao) => (
          <button
            key={acao.label}
            onClick={acao.onClick}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold border"
            style={{
              borderColor: acao.perigosa ? "var(--cor-alerta)" : "var(--cor-borda)",
              color: acao.perigosa ? "var(--cor-alerta)" : "var(--cor-texto)",
            }}
          >
            {acao.icon}
            {acao.label}
          </button>
        ))}
      </div>
    </div>
  );
}
