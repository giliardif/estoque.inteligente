"use client";

import { useEffect, useRef, useState, FormEvent } from "react";
import { Camera } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { obterMeusDados, atualizarMeuNome, enviarMinhaFoto } from "@/lib/api-conta";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui";
import { Usuario } from "@/lib/types";

const LABEL_PERFIL: Record<string, string> = { admin: "Admin", operador: "Operador", leitura: "Leitura" };

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] || "") + (partes[1]?.[0] || "")).toUpperCase();
}

function CardPerfil() {
  const { atualizarNome } = useAuth();
  const { sucesso, erro: toastErro } = useToast();

  const [dados, setDados] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [nome, setNome] = useState("");
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    obterMeusDados()
      .then((d) => {
        setDados(d);
        setNome(d.nome);
      })
      .catch(() => toastErro("Não foi possível carregar seus dados."))
      .finally(() => setCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function salvarNome() {
    if (!dados || nome.trim().length < 2 || nome === dados.nome) return;
    setSalvandoNome(true);
    try {
      const atualizado = await atualizarMeuNome(nome.trim());
      setDados(atualizado);
      atualizarNome(atualizado.nome);
      sucesso("Nome atualizado.");
    } catch (err) {
      toastErro(err instanceof ApiError ? err.message : "Não foi possível salvar o nome.");
    } finally {
      setSalvandoNome(false);
    }
  }

  async function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setEnviandoFoto(true);
    try {
      const atualizado = await enviarMinhaFoto(arquivo);
      setDados(atualizado);
      sucesso("Foto atualizada.");
    } catch (err) {
      toastErro(err instanceof Error ? err.message : "Não foi possível enviar a foto.");
    } finally {
      setEnviandoFoto(false);
      if (inputArquivoRef.current) inputArquivoRef.current.value = "";
    }
  }

  if (carregando) {
    return <div className="h-40 rounded-xl animate-pulse" style={{ background: "var(--cor-superficie)" }} />;
  }

  if (!dados) return null;

  return (
    <div
      className="rounded-xl border p-5"
      style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }}
    >
      <div className="flex items-center gap-4 mb-6">
        <div className="relative shrink-0">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold overflow-hidden"
            style={{ background: "var(--cor-base)", color: "var(--cor-texto-muted)" }}
          >
            {dados.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dados.avatar_url} alt="" className="w-full h-full object-cover" />
            ) : (
              iniciais(dados.nome)
            )}
          </div>
          <button
            onClick={() => inputArquivoRef.current?.click()}
            disabled={enviandoFoto}
            aria-label="Alterar foto"
            className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center border-2"
            style={{ background: "var(--cor-acento)", borderColor: "var(--cor-superficie)", color: "var(--cor-base)" }}
          >
            <Camera size={12} />
          </button>
          <input
            ref={inputArquivoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={aoEscolherArquivo}
          />
        </div>
        <div>
          <button
            onClick={() => inputArquivoRef.current?.click()}
            disabled={enviandoFoto}
            className="text-xs font-semibold rounded-md px-3 py-1.5 border"
            style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          >
            {enviandoFoto ? "Enviando…" : "Alterar foto"}
          </button>
          <div className="text-[11px] mt-1.5" style={{ color: "var(--cor-texto-muted)" }}>
            JPEG, PNG ou WebP · máx. 2MB
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            Nome
          </label>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="rounded-md px-3 py-2 text-sm border outline-none"
            style={{ borderColor: "var(--cor-borda)", background: "var(--cor-base)", color: "var(--cor-texto)" }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            E-mail
          </label>
          <input
            type="text"
            value={dados.email}
            disabled
            className="rounded-md px-3 py-2 text-sm border outline-none opacity-60"
            style={{ borderColor: "var(--cor-borda)", background: "var(--cor-base)", color: "var(--cor-texto)" }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 mb-5 max-w-[180px]">
        <label className="text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          Perfil
        </label>
        <input
          type="text"
          value={LABEL_PERFIL[dados.perfil] ?? dados.perfil}
          disabled
          className="rounded-md px-3 py-2 text-sm border outline-none opacity-60"
          style={{ borderColor: "var(--cor-borda)", background: "var(--cor-base)", color: "var(--cor-texto)" }}
        />
      </div>

      <button
        onClick={salvarNome}
        disabled={salvandoNome || nome.trim().length < 2 || nome === dados.nome}
        className="rounded-md px-4 py-2 text-sm font-bold disabled:opacity-50"
        style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
      >
        {salvandoNome ? "Salvando…" : "Salvar nome"}
      </button>
    </div>
  );
}

function CardTrocarSenha() {
  const { erro: toastErro, sucesso } = useToast();
  const [senhaAtual, setSenhaAtual] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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
      setSenhaAtual("");
      setSenhaNova("");
      setConfirmarSenha("");
      sucesso("Senha atualizada.");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível trocar a senha.";
      setErro(msg);
      toastErro(msg);
    } finally {
      setEnviando(false);
    }
  }

  const campo = "rounded-md px-3 py-2 text-sm border outline-none w-full";
  const estiloCampo = { borderColor: "var(--cor-borda)", background: "var(--cor-base)", color: "var(--cor-texto)" };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border p-5 mt-4"
      style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }}
    >
      <h3 className="text-sm font-bold mb-1">Trocar senha</h3>
      <p className="text-xs mb-4" style={{ color: "var(--cor-texto-muted)" }}>
        Mínimo 10 caracteres, com maiúscula, minúscula e número.
      </p>

      {erro && (
        <div className="text-sm rounded-md px-3 py-2 mb-4" style={{ color: "var(--cor-alerta)", background: "rgba(239,68,68,0.12)" }}>
          {erro}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>Senha atual</label>
          <input type="password" required value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} className={campo} style={estiloCampo} />
        </div>
        <div />
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>Nova senha</label>
          <input type="password" required minLength={10} value={senhaNova} onChange={(e) => setSenhaNova(e.target.value)} className={campo} style={estiloCampo} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>Confirmar nova senha</label>
          <input type="password" required value={confirmarSenha} onChange={(e) => setConfirmarSenha(e.target.value)} className={campo} style={estiloCampo} />
        </div>
      </div>

      <button
        type="submit"
        disabled={enviando}
        className="rounded-md px-4 py-2 text-sm font-bold disabled:opacity-50"
        style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
      >
        {enviando ? "Salvando…" : "Salvar nova senha"}
      </button>
    </form>
  );
}

export function AbaMinhaConta() {
  return (
    <div>
      <CardPerfil />
      <CardTrocarSenha />
    </div>
  );
}
