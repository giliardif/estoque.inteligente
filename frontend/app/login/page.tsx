"use client";

import { useState, FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
import { useTheme } from "@/lib/theme/useTheme";
import { Store } from "lucide-react";

export default function LoginPage() {
  const { login, carregando } = useAuth();
  const tema = useTheme();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await login(email, senha);
    } catch (err) {
      // Mensagem do backend já é genérica por design (não revela qual campo
      // está errado) — o frontend só repassa, sem tentar adivinhar mais detalhe.
      setErro(err instanceof ApiError ? err.message : "Não foi possível entrar. Tente novamente.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(150deg, ${tema.cor_acento}, #A2631A)` }}>
            <Store size={18} color={tema.cor_base} />
          </div>
          <span className="font-display text-lg font-semibold">{tema.logo_texto}</span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl p-6 border"
          style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
        >
          <h1 className="text-lg font-semibold mb-1">Entrar</h1>
          <p className="text-sm mb-5" style={{ color: "var(--cor-texto-muted)" }}>
            Acesse o sistema de gestão de estoque
          </p>

          {erro && (
            <div
              className="text-sm rounded-md px-3 py-2 mb-4"
              style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}
            >
              {erro}
            </div>
          )}

          <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>
            E-mail
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full mb-4 rounded-md px-3 py-2 text-sm outline-none border"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          />

          <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>
            Senha
          </label>
          <input
            type="password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            className="w-full mb-6 rounded-md px-3 py-2 text-sm outline-none border"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          />

          <button
            type="submit"
            disabled={carregando}
            className="w-full rounded-md py-2.5 font-bold text-sm disabled:opacity-60"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            {carregando ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
