"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type ThemeTokens = {
  cor_base: string;
  cor_superficie: string;
  cor_acento: string;
  cor_sucesso: string;
  cor_alerta: string;
  cor_borda: string;
  cor_texto: string;
  cor_texto_muted: string;
  fonte_display: string;
  fonte_corpo: string;
  logo_texto: string;
};

const ThemeContext = createContext<ThemeTokens | null>(null);

// Em produção isso viria de GET /tenants/{id}/tema (tabela `themes`), não de um
// import estático — aqui carregado localmente só porque ainda não existe
// tela de administração de tema. Trocar de cliente = trocar este fetch.
async function carregarTokensDoTenant(): Promise<ThemeTokens> {
  const mod = await import("../../themes/doce-encanto.tokens.json");
  return mod.tokens as ThemeTokens;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState<ThemeTokens | null>(null);

  useEffect(() => {
    carregarTokensDoTenant().then((t) => {
      setTokens(t);
      const root = document.documentElement;
      root.style.setProperty("--cor-base", t.cor_base);
      root.style.setProperty("--cor-superficie", t.cor_superficie);
      root.style.setProperty("--cor-acento", t.cor_acento);
      root.style.setProperty("--cor-sucesso", t.cor_sucesso);
      root.style.setProperty("--cor-alerta", t.cor_alerta);
      root.style.setProperty("--cor-borda", t.cor_borda);
      root.style.setProperty("--cor-texto", t.cor_texto);
      root.style.setProperty("--cor-texto-muted", t.cor_texto_muted);
      root.style.setProperty("--fonte-display", t.fonte_display);
      root.style.setProperty("--fonte-corpo", t.fonte_corpo);
    });
  }, []);

  if (!tokens) return null; // evita flash de tema errado antes do token carregar

  return <ThemeContext.Provider value={tokens}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeTokens {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve ser usado dentro de <ThemeProvider>");
  return ctx;
}
