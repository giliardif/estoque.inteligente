"use client";

// Toasts globais de sucesso/erro. Uso: const { sucesso, erro } = useToast();
// sucesso("Produto salvo"); erro("Não foi possível salvar o produto.");
//
// Fica montado uma vez em app/layout.tsx (ToastProvider) e qualquer tela
// chama useToast() sem precisar renderizar nada extra.

import {
  createContext, useCallback, useContext, useState, ReactNode,
} from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";

type ToastTipo = "sucesso" | "erro";

type ToastItem = {
  id: number;
  tipo: ToastTipo;
  mensagem: string;
};

type ToastContextValue = {
  sucesso: (mensagem: string) => void;
  erro: (mensagem: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DURACAO_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [itens, setItens] = useState<ToastItem[]>([]);

  const remover = useCallback((id: number) => {
    setItens((atuais) => atuais.filter((t) => t.id !== id));
  }, []);

  const adicionar = useCallback((tipo: ToastTipo, mensagem: string) => {
    const id = Date.now() + Math.random();
    setItens((atuais) => [...atuais, { id, tipo, mensagem }]);
    setTimeout(() => remover(id), DURACAO_MS);
  }, [remover]);

  const value: ToastContextValue = {
    sucesso: (mensagem) => adicionar("sucesso", mensagem),
    erro: (mensagem) => adicionar("erro", mensagem),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80">
        {itens.map((t) => (
          <div
            key={t.id}
            role="status"
            className="flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm shadow-lg animate-[toast-in_0.15s_ease-out]"
            style={{
              background: "var(--cor-superficie)",
              borderColor: t.tipo === "sucesso" ? "var(--cor-sucesso)" : "var(--cor-alerta)",
              color: "var(--cor-texto)",
            }}
          >
            {t.tipo === "sucesso" ? (
              <CheckCircle2 size={17} style={{ color: "var(--cor-sucesso)", flexShrink: 0, marginTop: 1 }} />
            ) : (
              <XCircle size={17} style={{ color: "var(--cor-alerta)", flexShrink: 0, marginTop: 1 }} />
            )}
            <span className="flex-1">{t.mensagem}</span>
            <button
              onClick={() => remover(t.id)}
              aria-label="Fechar"
              className="opacity-60 hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast deve ser usado dentro de <ToastProvider>");
  return ctx;
}
