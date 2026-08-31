"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";
import { useTheme } from "@/lib/theme/useTheme";

export default function TrocarSenhaPage() {
  const { usuario, marcarSenhaTrocada } = useAuth();
  const tema = useTheme();
  const router = useRouter();

  const [senhaAtual, setSenhaAtual] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    // Sem usuário em memória (ex: reload da página): volta pro login, não
    // dá pra trocar senha sem sessão ativa. Se o usuário já trocou a senha
    // (não deveria estar aqui), manda pro painel.
    if (!usuario) router.replace("/login");
    else if (!usuario.deve_trocar_senha) router.replace("/");
  }, [usuario, router]);

  if (!usuario || !usuario.deve_trocar_senha) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);

    if (senhaNova !== confirmarSenha) {
      setErro("As senhas não coincidem.");
      return;
    }

    setEnviando(true);
    try {
      await apiFetch("/auth/trocar-senha", {
        method: "POST",
        body: JSON.stringify({ senha_atual: senhaAtual, senha_nova: senhaNova }),
      });
      marcarSenhaTrocada();
      router.push("/");
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível trocar a senha. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: "var(--cor-base)" }}
    >
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
          <h1 className="text-lg font-semibold mb-1">Defina sua senha</h1>
          <p className="text-sm mb-5" style={{ color: "var(--cor-texto-muted)" }}>
            Esta é sua primeira vez no Girostock. Troque a senha provisória antes de continuar.
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
            Senha provisória (recebida do administrador)
          </label>
          <input
            type="password"
            required
            value={senhaAtual}
            onChange={(e) => setSenhaAtual(e.target.value)}
            className="w-full mb-4 rounded-md px-3 py-2 text-sm outline-none border transition-colors focus:border-[var(--cor-acento)]"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          />

          <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>
            Nova senha
          </label>
          <input
            type="password"
            required
            minLength={10}
            value={senhaNova}
            onChange={(e) => setSenhaNova(e.target.value)}
            className="w-full mb-1 rounded-md px-3 py-2 text-sm outline-none border transition-colors focus:border-[var(--cor-acento)]"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          />
          <p className="text-[11px] mb-4" style={{ color: "var(--cor-texto-muted)" }}>
            Mínimo 10 caracteres, com maiúscula, minúscula e número.
          </p>

          <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>
            Confirmar nova senha
          </label>
          <input
            type="password"
            required
            value={confirmarSenha}
            onChange={(e) => setConfirmarSenha(e.target.value)}
            className="w-full mb-6 rounded-md px-3 py-2 text-sm outline-none border transition-colors focus:border-[var(--cor-acento)]"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          />

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-md py-2.5 font-bold text-sm disabled:opacity-60 transition-opacity hover:opacity-90"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            {enviando ? "Salvando..." : "Salvar e continuar"}
          </button>
        </form>
      </div>
    </div>
  );
}
