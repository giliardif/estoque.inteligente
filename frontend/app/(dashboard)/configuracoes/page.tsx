"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { AbaMinhaConta } from "@/components/configuracoes/AbaMinhaConta";
import { AbaEmpresa } from "@/components/configuracoes/AbaEmpresa";
import { AbaUsuarios } from "@/components/configuracoes/AbaUsuarios";
import { AbaEstacoes } from "@/components/configuracoes/AbaEstacoes";

type ChaveAba = "conta" | "empresa" | "usuarios" | "estacoes";

function ConfiguracoesConteudo() {
  const { usuario } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Usuários e Estações seguem restritas a admin — mesma visibilidade que
  // já existia quando eram itens separados no menu principal (a leitura
  // real desses dados o backend já permite pra mais perfis, mas a decisão
  // de UI de só anunciar a tela pra quem consegue geri-la é anterior a
  // esta etapa e foi só preservada, não ampliada).
  const souAdmin = usuario?.perfil === "admin";

  const abas: { chave: ChaveAba; label: string }[] = [
    { chave: "conta", label: "Minha Conta" },
    { chave: "empresa", label: "Empresa" },
    ...(souAdmin ? ([{ chave: "usuarios", label: "Usuários" }, { chave: "estacoes", label: "Estações de Impressão" }] as const) : []),
  ];

  const abaPedida = searchParams.get("aba") as ChaveAba | null;
  const abaAtiva: ChaveAba = abas.some((a) => a.chave === abaPedida) ? (abaPedida as ChaveAba) : "conta";

  function irPara(chave: ChaveAba) {
    router.replace(`/configuracoes?aba=${chave}`, { scroll: false });
  }

  return (
    <div className="max-w-[920px]">
      <h1 className="font-display text-[24px] sm:text-[26px] font-semibold mb-1" style={{ color: "var(--cor-texto)" }}>
        Configurações
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--cor-texto-muted)" }}>
        Conta, empresa e preferências do sistema.
      </p>

      <div className="flex gap-1 mb-6 overflow-x-auto" style={{ borderBottom: "1px solid var(--cor-borda)" }}>
        {abas.map((a) => (
          <button
            key={a.chave}
            onClick={() => irPara(a.chave)}
            className="px-4 py-2.5 text-[13.5px] font-semibold whitespace-nowrap relative -mb-px"
            style={{
              color: abaAtiva === a.chave ? "var(--cor-acento)" : "var(--cor-texto-muted)",
              borderBottom: abaAtiva === a.chave ? "2px solid var(--cor-acento)" : "2px solid transparent",
            }}
          >
            {a.label}
          </button>
        ))}
      </div>

      {abaAtiva === "conta" && <AbaMinhaConta />}
      {abaAtiva === "empresa" && <AbaEmpresa />}
      {abaAtiva === "usuarios" && souAdmin && <AbaUsuarios />}
      {abaAtiva === "estacoes" && souAdmin && <AbaEstacoes />}
    </div>
  );
}

export default function ConfiguracoesPage() {
  return (
    <Suspense fallback={<div className="h-40 rounded-xl animate-pulse" style={{ background: "var(--cor-superficie)" }} />}>
      <ConfiguracoesConteudo />
    </Suspense>
  );
}
