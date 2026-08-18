"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";

export type ModoTema = "escuro" | "claro";

type ModoTokens = {
  cor_base: string;
  cor_superficie: string;
  cor_acento: string;
  cor_acento_soft?: string;
  cor_sucesso: string;
  cor_alerta: string;
  cor_aviso?: string;
  cor_borda: string;
  cor_texto: string;
  cor_texto_muted: string;
  cor_grafico_neutro?: string;
  cor_grafico_extra_1?: string;
  cor_grafico_extra_2?: string;
  cor_status_esgotado?: string;
  cor_status_esgotado_bg?: string;
  cor_status_vencimento?: string;
  cor_status_vencimento_bg?: string;
  cor_status_minimo?: string;
  cor_status_minimo_bg?: string;
  cor_status_novo?: string;
  cor_status_novo_bg?: string;
  cor_marca_azul?: string;
  cor_marca_gradiente_de?: string;
  cor_marca_gradiente_para?: string;
};

type TemaArquivo = {
  tenant: string;
  modos: Record<ModoTema, ModoTokens>;
  fonte_display: string;
  fonte_corpo: string;
  logo_texto: string;
  logo_tagline?: string;
  logo_simbolo?: string;
  logo_completo?: string;
};

type ThemeContextValue = ModoTokens & {
  fonte_display: string;
  fonte_corpo: string;
  logo_texto: string;
  logo_tagline?: string;
  logo_simbolo?: string;
  logo_completo?: string;
  modo: ModoTema;
  alternarModo: () => void;
};

const CHAVE_MODO_STORAGE = "nexstock-modo-tema";
const ThemeContext = createContext<ThemeContextValue | null>(null);

// Em produção isso viria de GET /tenants/{id}/tema (tabela `themes`), não de um
// import estático — aqui carregado localmente só porque ainda não existe
// tela de administração de tema. A identidade padrão do sistema é a NexStock;
// todo tenant usa esse token a menos que tenha um override próprio configurado
// (mecanismo mantido para clientes futuros, mas nenhum tenant usa hoje —
// inclusive o Doce Encanto, que abriu mão da identidade caramelo/rosa própria
// em favor do padrão). Trocar o default = trocar este import. O arquivo traz
// os dois modos (escuro/claro); um tenant com override pode customizar um,
// os dois, ou nenhum — o modo escuro continua sendo o padrão do sistema.
async function carregarArquivoDoTenant(): Promise<TemaArquivo> {
  const mod = await import("../../themes/nexstock.tokens.json");
  return mod as unknown as TemaArquivo;
}

function detectarModoInicial(): ModoTema {
  if (typeof window === "undefined") return "escuro";
  const salvo = window.localStorage.getItem(CHAVE_MODO_STORAGE);
  if (salvo === "escuro" || salvo === "claro") return salvo;
  // Sem preferência salva: respeita prefers-color-scheme do sistema, mas o
  // padrão do produto (quando o navegador não informa nada) continua escuro.
  const prefereClaro = window.matchMedia?.("(prefers-color-scheme: light)")?.matches;
  return prefereClaro ? "claro" : "escuro";
}

function aplicarTokensNoDocumento(modoTokens: ModoTokens, arquivo: TemaArquivo, modo: ModoTema) {
  const root = document.documentElement;
  root.style.setProperty("--cor-base", modoTokens.cor_base);
  root.style.setProperty("--cor-superficie", modoTokens.cor_superficie);
  root.style.setProperty("--cor-acento", modoTokens.cor_acento);
  root.style.setProperty("--cor-sucesso", modoTokens.cor_sucesso);
  root.style.setProperty("--cor-alerta", modoTokens.cor_alerta);
  root.style.setProperty("--cor-borda", modoTokens.cor_borda);
  root.style.setProperty("--cor-texto", modoTokens.cor_texto);
  root.style.setProperty("--cor-texto-muted", modoTokens.cor_texto_muted);
  root.style.setProperty("--fonte-display", arquivo.fonte_display);
  root.style.setProperty("--fonte-corpo", arquivo.fonte_corpo);
  if (modoTokens.cor_acento_soft) root.style.setProperty("--cor-acento-soft", modoTokens.cor_acento_soft);
  if (modoTokens.cor_aviso) root.style.setProperty("--cor-aviso", modoTokens.cor_aviso);
  if (modoTokens.cor_grafico_neutro) root.style.setProperty("--cor-grafico-neutro", modoTokens.cor_grafico_neutro);
  if (modoTokens.cor_grafico_extra_1) root.style.setProperty("--cor-grafico-extra-1", modoTokens.cor_grafico_extra_1);
  if (modoTokens.cor_grafico_extra_2) root.style.setProperty("--cor-grafico-extra-2", modoTokens.cor_grafico_extra_2);
  if (modoTokens.cor_status_esgotado) root.style.setProperty("--cor-status-esgotado", modoTokens.cor_status_esgotado);
  if (modoTokens.cor_status_esgotado_bg) root.style.setProperty("--cor-status-esgotado-bg", modoTokens.cor_status_esgotado_bg);
  if (modoTokens.cor_status_vencimento) root.style.setProperty("--cor-status-vencimento", modoTokens.cor_status_vencimento);
  if (modoTokens.cor_status_vencimento_bg) root.style.setProperty("--cor-status-vencimento-bg", modoTokens.cor_status_vencimento_bg);
  if (modoTokens.cor_status_minimo) root.style.setProperty("--cor-status-minimo", modoTokens.cor_status_minimo);
  if (modoTokens.cor_status_minimo_bg) root.style.setProperty("--cor-status-minimo-bg", modoTokens.cor_status_minimo_bg);
  if (modoTokens.cor_status_novo) root.style.setProperty("--cor-status-novo", modoTokens.cor_status_novo);
  if (modoTokens.cor_status_novo_bg) root.style.setProperty("--cor-status-novo-bg", modoTokens.cor_status_novo_bg);
  if (modoTokens.cor_marca_azul) root.style.setProperty("--cor-marca-azul", modoTokens.cor_marca_azul);
  if (modoTokens.cor_marca_gradiente_de) root.style.setProperty("--cor-marca-gradiente-de", modoTokens.cor_marca_gradiente_de);
  if (modoTokens.cor_marca_gradiente_para) root.style.setProperty("--cor-marca-gradiente-para", modoTokens.cor_marca_gradiente_para);
  root.setAttribute("data-tema", modo);
  root.style.colorScheme = modo === "claro" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [arquivo, setArquivo] = useState<TemaArquivo | null>(null);
  const [modo, setModo] = useState<ModoTema>("escuro");

  useEffect(() => {
    carregarArquivoDoTenant().then((a) => {
      const modoInicial = detectarModoInicial();
      setArquivo(a);
      setModo(modoInicial);
      aplicarTokensNoDocumento(a.modos[modoInicial], a, modoInicial);
    });
  }, []);

  const alternarModo = useCallback(() => {
    setModo((atual) => {
      const proximo: ModoTema = atual === "escuro" ? "claro" : "escuro";
      if (arquivo) aplicarTokensNoDocumento(arquivo.modos[proximo], arquivo, proximo);
      if (typeof window !== "undefined") window.localStorage.setItem(CHAVE_MODO_STORAGE, proximo);
      return proximo;
    });
  }, [arquivo]);

  if (!arquivo) return null; // evita flash de tema errado antes do token carregar

  const tokensAtuais = arquivo.modos[modo];

  return (
    <ThemeContext.Provider
      value={{
        ...tokensAtuais,
        fonte_display: arquivo.fonte_display,
        fonte_corpo: arquivo.fonte_corpo,
        logo_texto: arquivo.logo_texto,
        logo_tagline: arquivo.logo_tagline,
        logo_simbolo: arquivo.logo_simbolo,
        logo_completo: arquivo.logo_completo,
        modo,
        alternarModo,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve ser usado dentro de <ThemeProvider>");
  return ctx;
}
