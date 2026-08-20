"use client";

import { useEffect, useRef, useState, FormEvent } from "react";
import { Copy, Check } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Perfil, UsuarioCreateResult } from "@/lib/types";

const PERFIS: { valor: Perfil; titulo: string; descricao: string }[] = [
  { valor: "operador", titulo: "Operador", descricao: "Cria vendas, movimenta estoque, lança compras. Não altera configurações do tenant." },
  { valor: "leitura", titulo: "Leitura", descricao: "Visualiza painéis e relatórios, sem permissão de edição." },
  { valor: "admin", titulo: "Admin", descricao: "Acesso total, incluindo cadastro de outros usuários." },
];

type ConvidarUsuarioDialogProps = {
  aberto: boolean;
  onFechar: () => void;
  onSucesso: () => void;
};

export function ConvidarUsuarioDialog({ aberto, onFechar, onSucesso }: ConvidarUsuarioDialogProps) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [perfil, setPerfil] = useState<Perfil>("operador");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<UsuarioCreateResult | null>(null);
  const [copiado, setCopiado] = useState(false);

  const primeiroCampoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aberto) {
      setNome("");
      setEmail("");
      setPerfil("operador");
      setErro(null);
      setResultado(null);
      setCopiado(false);
      setTimeout(() => primeiroCampoRef.current?.focus(), 0);
    }
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onFechar();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const dados = await apiFetch<UsuarioCreateResult>("/usuarios", {
        method: "POST",
        body: JSON.stringify({ nome, email, perfil }),
      });
      setResultado(dados);
      onSucesso();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível criar o acesso. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  async function copiarSenha() {
    if (!resultado) return;
    await navigator.clipboard.writeText(resultado.senha_provisoria);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-4"
      style={{ background: "rgba(10,8,6,0.55)" }}
      onClick={resultado ? undefined : onFechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border p-6 shadow-xl"
        style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
      >
        {!resultado ? (
          <form onSubmit={handleSubmit}>
            <h2 className="text-lg font-semibold mb-1">Convidar usuário</h2>
            <p className="text-sm mb-5" style={{ color: "var(--cor-texto-muted)" }}>
              Uma senha provisória será gerada — repasse ao usuário por fora do sistema.
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
              Nome completo
            </label>
            <input
              ref={primeiroCampoRef}
              type="text"
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Marina Costa"
              className="w-full mb-4 rounded-md px-3 py-2 text-sm outline-none border transition-colors focus:border-[var(--cor-acento)]"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            />

            <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>
              E-mail
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@email.com"
              className="w-full mb-4 rounded-md px-3 py-2 text-sm outline-none border transition-colors focus:border-[var(--cor-acento)]"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            />

            <label className="block text-xs font-semibold mb-2" style={{ color: "var(--cor-texto-muted)" }}>
              Papel de acesso
            </label>
            <div className="flex flex-col gap-2 mb-6">
              {PERFIS.map((p) => (
                <label
                  key={p.valor}
                  className="flex gap-2.5 p-2.5 rounded-lg border cursor-pointer items-start"
                  style={
                    perfil === p.valor
                      ? { borderColor: "var(--cor-acento)", background: "color-mix(in srgb, var(--cor-acento) 6%, transparent)" }
                      : { borderColor: "var(--cor-borda)" }
                  }
                >
                  <input
                    type="radio"
                    name="perfil"
                    className="mt-0.5 accent-[var(--cor-acento)]"
                    checked={perfil === p.valor}
                    onChange={() => setPerfil(p.valor)}
                  />
                  <div>
                    <div className="text-sm font-bold">{p.titulo}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--cor-texto-muted)" }}>{p.descricao}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onFechar}
                disabled={enviando}
                className="rounded-md px-3.5 py-2 text-sm font-semibold border disabled:opacity-60"
                style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={enviando}
                className="rounded-md px-3.5 py-2 text-sm font-bold disabled:opacity-60"
                style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
              >
                {enviando ? "Criando..." : "Criar acesso"}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <h2 className="text-lg font-semibold mb-1">Acesso criado</h2>
            <p className="text-sm mb-5" style={{ color: "var(--cor-texto-muted)" }}>
              Repasse estas informações para {resultado.usuario.nome} de forma segura (fora do sistema).
            </p>

            <div className="rounded-lg border border-dashed p-4 mb-1" style={{ borderColor: "var(--cor-acento)", background: "var(--cor-base)" }}>
              <div className="text-[11px] uppercase tracking-wide font-bold mb-1" style={{ color: "var(--cor-texto-muted)" }}>
                E-mail de acesso
              </div>
              <div className="text-sm mb-3.5">{resultado.usuario.email}</div>

              <div className="text-[11px] uppercase tracking-wide font-bold mb-1" style={{ color: "var(--cor-texto-muted)" }}>
                Senha provisória
              </div>
              <div className="flex items-center justify-between gap-2">
                <code className="text-base tracking-wide" style={{ color: "var(--cor-acento)" }}>
                  {resultado.senha_provisoria}
                </code>
                <button
                  type="button"
                  onClick={copiarSenha}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold border"
                  style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                >
                  {copiado ? <Check size={13} /> : <Copy size={13} />}
                  {copiado ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>
            <p className="text-xs mt-2.5 flex gap-1.5" style={{ color: "#F0B94D" }}>
              ⚠ O usuário será obrigado a trocar essa senha no primeiro login. Esta senha não poderá ser recuperada depois — anote agora.
            </p>

            <div className="flex justify-end mt-6">
              <button
                type="button"
                onClick={onFechar}
                className="rounded-md px-3.5 py-2 text-sm font-bold"
                style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
              >
                Concluir
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
