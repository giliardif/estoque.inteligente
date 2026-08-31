"use client";

import { useState, FormEvent } from "react";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";
import { useTheme } from "@/lib/theme/useTheme";

export default function LoginPage() {
  const { login, carregando } = useAuth();
  const tema = useTheme();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [manterConectado, setManterConectado] = useState(false);
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
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "var(--cor-base)" }}
    >
      {/* Glow radial de marca — único acento decorativo da tela, discreto */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(600px circle at 50% 32%, color-mix(in srgb, var(--cor-marca-azul, #2563EB) 16%, transparent), transparent 70%)`,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(500px circle at 50% 85%, color-mix(in srgb, var(--cor-acento) 10%, transparent), transparent 70%)`,
        }}
      />

      <div className="w-full max-w-sm relative">
        <div className="flex flex-col items-center gap-3 mb-8">
          {tema.logo_simbolo ? (
            <Image
              src={tema.logo_simbolo}
              alt={tema.logo_texto}
              width={56}
              height={68}
              priority
              className="drop-shadow-[0_0_24px_rgba(37,99,235,0.25)]"
            />
          ) : null}
          <div className="text-center leading-tight">
            <div className="font-logotype text-2xl font-bold tracking-tight">
              <span style={{ color: "var(--cor-texto)" }}>Giro</span>
              <span style={{ color: "var(--cor-acento)" }}>Stock</span>
            </div>
            {tema.logo_tagline ? (
              <div
                className="text-[11px] tracking-[0.18em] font-semibold mt-0.5"
                style={{ color: "var(--cor-texto-muted)" }}
              >
                {tema.logo_tagline.toUpperCase()}
              </div>
            ) : null}
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-6 border backdrop-blur-xl"
          style={{
            background: "color-mix(in srgb, var(--cor-superficie) 65%, transparent)",
            borderColor: "var(--cor-borda)",
            boxShadow: "0 24px 60px -20px rgba(0,0,0,0.55)",
          }}
        >
          <h1 className="text-lg font-semibold mb-1">Entrar</h1>
          <p className="text-sm mb-5" style={{ color: "var(--cor-texto-muted)" }}>
            Acesse o sistema de gestão de estoque
          </p>

          {erro && (
            <div
              className="text-sm rounded-md px-3 py-2 mb-4"
              style={{ color: "var(--cor-alerta)", background: "rgba(239,68,68,0.12)" }}
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
            className="w-full mb-4 rounded-md px-3 py-2 text-sm outline-none border transition-colors focus:border-[var(--cor-acento)]"
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
            className="w-full mb-3 rounded-md px-3 py-2 text-sm outline-none border transition-colors focus:border-[var(--cor-acento)]"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          />

          <div className="flex items-center justify-between text-xs mb-6">
            <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: "var(--cor-texto-muted)" }}>
              <input
                type="checkbox"
                checked={manterConectado}
                onChange={(e) => setManterConectado(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-[var(--cor-acento)]"
              />
              Manter conectado
            </label>
            {/* Recuperação de senha ainda não existe no backend (sem endpoint) —
                mantido como texto não clicável até essa etapa ser aprovada,
                em vez de simular um link morto. */}
            <span className="font-semibold cursor-not-allowed" style={{ color: "var(--cor-texto-muted)" }} title="Em breve">
              Esqueci minha senha
            </span>
          </div>

          <button
            type="submit"
            disabled={carregando}
            className="w-full rounded-md py-2.5 font-bold text-sm disabled:opacity-60 transition-opacity hover:opacity-90"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            {carregando ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="text-center text-xs mt-6" style={{ color: "var(--cor-texto-muted)" }}>
          Ainda não tem conta?{" "}
          <span className="font-bold" style={{ color: "var(--cor-texto)" }}>
            Fale com nosso time
          </span>
        </p>
      </div>
    </div>
  );
}
