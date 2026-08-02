"use client";

// Modal minúsculo de "criar rápido" — usado nos filtros da tela de Estoque
// pra cadastrar categoria/depósito/fornecedor sem sair da tela e sem abrir
// uma tela de administração inteira só pra isso. Um segundo campo opcional
// (endereço, documento etc.) cobre os casos que precisam de mais que nome.

import { useEffect, useRef, useState } from "react";

type QuickCreateDialogProps = {
  aberto: boolean;
  titulo: string;
  labelNome?: string;
  campoSecundario?: { label: string; placeholder?: string };
  salvando?: boolean;
  onCriar: (nome: string, valorSecundario: string) => void;
  onCancelar: () => void;
};

export function QuickCreateDialog({
  aberto, titulo, labelNome = "Nome", campoSecundario, salvando = false, onCriar, onCancelar,
}: QuickCreateDialogProps) {
  const [nome, setNome] = useState("");
  const [secundario, setSecundario] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aberto) {
      setNome("");
      setSecundario("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelar();
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [aberto, onCancelar]);

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-4"
      style={{ background: "rgba(10,8,6,0.55)" }}
      onClick={onCancelar}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (nome.trim()) onCriar(nome.trim(), secundario.trim());
        }}
        className="w-full max-w-xs rounded-xl border p-5 flex flex-col gap-3 shadow-xl"
        style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
      >
        <h2 className="text-sm font-semibold">{titulo}</h2>
        <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          {labelNome}
          <input
            ref={inputRef}
            required
            minLength={2}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          />
        </label>
        {campoSecundario && (
          <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            {campoSecundario.label}
            <input
              value={secundario}
              onChange={(e) => setSecundario(e.target.value)}
              placeholder={campoSecundario.placeholder}
              className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            />
          </label>
        )}
        <div className="flex justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={onCancelar}
            disabled={salvando}
            className="rounded-md px-3.5 py-2 text-sm font-semibold border disabled:opacity-60"
            style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando}
            className="rounded-md px-3.5 py-2 text-sm font-bold disabled:opacity-60"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            {salvando ? "Salvando..." : "Criar"}
          </button>
        </div>
      </form>
    </div>
  );
}
