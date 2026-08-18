"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * Alterna entre o modo escuro (padrão do sistema) e claro. A preferência é
 * persistida em localStorage por useTheme; sem preferência salva, o app
 * respeita prefers-color-scheme do navegador, com fallback pra escuro.
 */
export default function ToggleTema({ compacto = false }: { compacto?: boolean }) {
  const { modo, alternarModo } = useTheme();
  const claro = modo === "claro";

  return (
    <button
      type="button"
      onClick={alternarModo}
      aria-label={claro ? "Mudar para modo escuro" : "Mudar para modo claro"}
      title={claro ? "Modo claro (clique para escuro)" : "Modo escuro (clique para claro)"}
      className={`flex items-center gap-2 rounded-lg border transition-colors ${
        compacto ? "p-1.5" : "px-2.5 py-2 text-xs font-medium w-full"
      }`}
      style={{
        borderColor: "var(--cor-borda)",
        color: "var(--cor-texto-muted)",
        background: "transparent",
      }}
    >
      {claro ? <Sun size={14} /> : <Moon size={14} />}
      {!compacto && <span>{claro ? "Modo claro" : "Modo escuro"}</span>}
    </button>
  );
}
