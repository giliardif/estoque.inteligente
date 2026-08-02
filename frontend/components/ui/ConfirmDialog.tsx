"use client";

// Modal de confirmação genérico — usado antes de qualquer ação destrutiva
// ou irreversível (excluir produto, cancelar nota, etc). Fecha com Esc ou
// clique fora, sem precisar duplicar essa lógica em cada tela.

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

type ConfirmDialogProps = {
  aberto: boolean;
  titulo: string;
  descricao?: string;
  labelConfirmar?: string;
  labelCancelar?: string;
  perigoso?: boolean;
  confirmando?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
};

export function ConfirmDialog({
  aberto,
  titulo,
  descricao,
  labelConfirmar = "Confirmar",
  labelCancelar = "Cancelar",
  perigoso = false,
  confirmando = false,
  onConfirmar,
  onCancelar,
}: ConfirmDialogProps) {
  const confirmarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;
    confirmarRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelar();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [aberto, onCancelar]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-4"
      style={{ background: "rgba(10,8,6,0.55)" }}
      onClick={onCancelar}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-titulo"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border p-5 flex flex-col gap-3 shadow-xl"
        style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
      >
        <div className="flex items-start gap-2.5">
          {perigoso && (
            <AlertTriangle size={18} style={{ color: "var(--cor-alerta)", flexShrink: 0, marginTop: 2 }} />
          )}
          <div>
            <h2 id="confirm-dialog-titulo" className="text-sm font-semibold">{titulo}</h2>
            {descricao && (
              <p className="text-sm mt-1" style={{ color: "var(--cor-texto-muted)" }}>{descricao}</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onCancelar}
            disabled={confirmando}
            className="rounded-md px-3.5 py-2 text-sm font-semibold border disabled:opacity-60"
            style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          >
            {labelCancelar}
          </button>
          <button
            ref={confirmarRef}
            onClick={onConfirmar}
            disabled={confirmando}
            className="rounded-md px-3.5 py-2 text-sm font-bold disabled:opacity-60"
            style={
              perigoso
                ? { background: "var(--cor-alerta)", color: "#fff" }
                : { background: "var(--cor-acento)", color: "var(--cor-base)" }
            }
          >
            {confirmando ? "Aguarde..." : labelConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
