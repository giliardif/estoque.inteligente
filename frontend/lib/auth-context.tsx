"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, definirAccessToken } from "@/lib/api";

type Usuario = { id: string; tenant_id: string; perfil: "admin" | "operador" | "leitura" };

type AuthContextType = {
  usuario: Usuario | null;
  carregando: boolean;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(false);
  const router = useRouter();

  async function login(email: string, senha: string) {
    setCarregando(true);
    try {
      const resp = await apiFetch<{ access_token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, senha }),
      });
      definirAccessToken(resp.access_token);
      // Decodifica o payload do JWT só para exibir dados na UI (perfil, tenant) —
      // a validação de verdade do token acontece sempre no backend a cada
      // requisição; o frontend nunca confia no conteúdo decodificado para
      // decisões de autorização, só para conveniência de exibição.
      const payload = JSON.parse(atob(resp.access_token.split(".")[1]));
      setUsuario({ id: payload.sub, tenant_id: payload.tenant_id, perfil: payload.perfil });
      router.push("/");
    } finally {
      setCarregando(false);
    }
  }

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    definirAccessToken(null);
    setUsuario(null);
    router.push("/login");
  }

  return (
    <AuthContext.Provider value={{ usuario, carregando, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
