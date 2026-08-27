"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { obterTenant, atualizarTenant } from "@/lib/api-tenant";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/components/ui";
import { Tenant } from "@/lib/types";

function formatarCnpj(digitos: string | null): string {
  if (!digitos) return "";
  const d = digitos.replace(/\D/g, "");
  if (d.length !== 14) return digitos;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

const LABEL_SEGMENTO: Record<string, string> = {
  generico: "Genérico",
  confeitaria: "Confeitaria",
};

export function AbaEmpresa() {
  const { usuario } = useAuth();
  const { sucesso, erro: toastErro } = useToast();
  const souAdmin = usuario?.perfil === "admin";

  const [dados, setDados] = useState<Tenant | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    obterTenant()
      .then((d) => {
        setDados(d);
        setNome(d.nome);
        setCnpj(formatarCnpj(d.cnpj));
      })
      .catch(() => toastErro("Não foi possível carregar os dados da empresa."))
      .finally(() => setCarregando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const houveMudanca = dados && (nome.trim() !== dados.nome || cnpj.replace(/\D/g, "") !== (dados.cnpj ?? ""));

  async function salvar() {
    if (!dados || !houveMudanca) return;
    setSalvando(true);
    try {
      const atualizado = await atualizarTenant({
        nome: nome.trim() !== dados.nome ? nome.trim() : undefined,
        cnpj: cnpj.replace(/\D/g, "") !== (dados.cnpj ?? "") ? cnpj : undefined,
      });
      setDados(atualizado);
      setNome(atualizado.nome);
      setCnpj(formatarCnpj(atualizado.cnpj));
      sucesso("Dados da empresa atualizados.");
    } catch (err) {
      toastErro(err instanceof ApiError ? err.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return <div className="h-40 rounded-xl animate-pulse" style={{ background: "var(--cor-superficie)" }} />;
  }

  if (!dados) return null;

  const campo = "rounded-md px-3 py-2 text-sm border outline-none w-full";
  const estiloCampo = { borderColor: "var(--cor-borda)", background: "var(--cor-base)", color: "var(--cor-texto)" };

  return (
    <div
      className="rounded-xl border p-5"
      style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }}
    >
      {!souAdmin && (
        <p className="text-xs mb-4" style={{ color: "var(--cor-texto-muted)" }}>
          Só administradores podem editar os dados da empresa.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            Nome do negócio
          </label>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            disabled={!souAdmin}
            className={campo + (souAdmin ? "" : " opacity-60")}
            style={estiloCampo}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            Segmento
          </label>
          <input
            type="text"
            value={LABEL_SEGMENTO[dados.segmento_slug] ?? dados.segmento_slug}
            disabled
            className={campo + " opacity-60"}
            style={estiloCampo}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 mb-5 max-w-[280px]">
        <label className="text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          CNPJ
        </label>
        <input
          type="text"
          value={cnpj}
          onChange={(e) => setCnpj(e.target.value)}
          disabled={!souAdmin}
          placeholder="00.000.000/0000-00"
          className={campo + (souAdmin ? "" : " opacity-60")}
          style={estiloCampo}
        />
      </div>

      {souAdmin && (
        <button
          onClick={salvar}
          disabled={salvando || !houveMudanca}
          className="rounded-md px-4 py-2 text-sm font-bold disabled:opacity-50"
          style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      )}
    </div>
  );
}
