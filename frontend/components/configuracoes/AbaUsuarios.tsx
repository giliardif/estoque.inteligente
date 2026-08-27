"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Usuario } from "@/lib/types";
import { ConvidarUsuarioDialog } from "@/components/usuarios/ConvidarUsuarioDialog";
import { useToast, ConfirmDialog, TableSkeletonRows } from "@/components/ui";
import { UserPlus } from "lucide-react";

const LABEL_PERFIL: Record<string, string> = { admin: "Admin", operador: "Operador", leitura: "Leitura" };
const COR_PERFIL: Record<string, { cor: string; fundo: string }> = {
  admin: { cor: "#7DA2FA", fundo: "rgba(37,99,235,.15)" },
  operador: { cor: "var(--cor-acento)", fundo: "color-mix(in srgb, var(--cor-acento) 15%, transparent)" },
  leitura: { cor: "var(--cor-texto-muted)", fundo: "rgba(143,160,190,.15)" },
};

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] || "") + (partes[1]?.[0] || "")).toUpperCase();
}

export function AbaUsuarios() {
  const { usuario: eu } = useAuth();
  const { sucesso, erro: toastErro } = useToast();

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroCarregar, setErroCarregar] = useState<string | null>(null);
  const [mostrarConvite, setMostrarConvite] = useState(false);
  const [alvoDesativar, setAlvoDesativar] = useState<Usuario | null>(null);
  const [processando, setProcessando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroCarregar(null);
    try {
      const dados = await apiFetch<Usuario[]>("/usuarios");
      setUsuarios(dados);
    } catch (err) {
      setErroCarregar(err instanceof ApiError ? err.message : "Não foi possível carregar os usuários.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Proteção real é o backend (403 para leitura). Isto é só uma mensagem
  // mais amigável do que deixar o erro de rede genérico aparecer, caso
  // alguém navegue direto para a URL sem passar pelo menu.
  if (eu?.perfil === "leitura") {
    return (
      <div className="text-sm rounded-md px-4 py-3" style={{ color: "var(--cor-alerta)", background: "rgba(239,68,68,0.12)" }}>
        Seu perfil não tem permissão para acessar esta aba.
      </div>
    );
  }

  async function alternarStatus(usuarioAlvo: Usuario) {
    setProcessando(true);
    try {
      await apiFetch(`/usuarios/${usuarioAlvo.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativo: !usuarioAlvo.ativo }),
      });
      sucesso(usuarioAlvo.ativo ? "Usuário desativado." : "Usuário reativado.");
      setAlvoDesativar(null);
      carregar();
    } catch (err) {
      toastErro(err instanceof ApiError ? err.message : "Não foi possível atualizar o usuário.");
    } finally {
      setProcessando(false);
    }
  }

  async function alterarPerfil(usuarioAlvo: Usuario, novoPerfil: string) {
    try {
      await apiFetch(`/usuarios/${usuarioAlvo.id}`, {
        method: "PATCH",
        body: JSON.stringify({ perfil: novoPerfil }),
      });
      sucesso("Papel atualizado.");
      carregar();
    } catch (err) {
      toastErro(err instanceof ApiError ? err.message : "Não foi possível atualizar o papel.");
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Gerencie quem tem acesso ao sistema.
        </p>
        {eu?.perfil === "admin" && (
          <button
            onClick={() => setMostrarConvite(true)}
            className="flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-bold shrink-0"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            <UserPlus size={15} /> Convidar usuário
          </button>
        )}
      </div>

      {erroCarregar && (
        <div
          className="text-sm rounded-md px-3 py-2 mb-4"
          style={{ color: "var(--cor-alerta)", background: "rgba(239,68,68,0.12)" }}
        >
          {erroCarregar}
        </div>
      )}

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--cor-borda)" }}>
              <th className="text-left px-5 py-3 text-[11px] uppercase tracking-wide font-bold" style={{ color: "var(--cor-texto-muted)" }}>Usuário</th>
              <th className="text-left px-5 py-3 text-[11px] uppercase tracking-wide font-bold" style={{ color: "var(--cor-texto-muted)" }}>Papel</th>
              <th className="text-left px-5 py-3 text-[11px] uppercase tracking-wide font-bold" style={{ color: "var(--cor-texto-muted)" }}>Status</th>
              <th className="text-left px-5 py-3 text-[11px] uppercase tracking-wide font-bold" style={{ color: "var(--cor-texto-muted)" }}>Adicionado em</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {carregando ? (
              <TableSkeletonRows colunas={5} />
            ) : usuarios.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm" style={{ color: "var(--cor-texto-muted)" }}>
                  Nenhum usuário cadastrado ainda.
                </td>
              </tr>
            ) : (
              usuarios.map((u) => {
                const souEu = u.id === eu?.id;
                const corPerfil = COR_PERFIL[u.perfil];
                return (
                  <tr key={u.id} style={{ borderBottom: "1px solid var(--cor-borda)" }}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                          style={{ background: "var(--cor-base)", color: "var(--cor-texto-muted)" }}
                        >
                          {iniciais(u.nome)}
                        </div>
                        <div>
                          <div className="font-semibold">{u.nome}{souEu && <span className="ml-1.5 text-xs font-normal" style={{ color: "var(--cor-texto-muted)" }}>(você)</span>}</div>
                          <div className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {souEu || eu?.perfil !== "admin" ? (
                        <span
                          className="inline-block px-2.5 py-0.5 rounded-full text-[11.5px] font-bold"
                          style={{ color: corPerfil.cor, background: corPerfil.fundo }}
                        >
                          {LABEL_PERFIL[u.perfil]}
                        </span>
                      ) : (
                        <select
                          value={u.perfil}
                          onChange={(e) => alterarPerfil(u, e.target.value)}
                          className="text-xs font-bold rounded-full px-2.5 py-1 border-0 outline-none cursor-pointer"
                          style={{ color: corPerfil.cor, background: corPerfil.fundo }}
                        >
                          <option value="admin">Admin</option>
                          <option value="operador">Operador</option>
                          <option value="leitura">Leitura</option>
                        </select>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="flex items-center gap-1.5 text-xs">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: u.ativo ? "var(--cor-acento)" : "#5A6B8C" }}
                        />
                        <span style={{ color: u.ativo ? "var(--cor-texto)" : "var(--cor-texto-muted)" }}>
                          {u.ativo ? "Ativo" : "Inativo"}
                        </span>
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs" style={{ color: "var(--cor-texto-muted)" }}>
                      {new Date(u.criado_em).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {!souEu && eu?.perfil === "admin" && (
                        <button
                          onClick={() => setAlvoDesativar(u)}
                          className="text-xs font-semibold"
                          style={{ color: u.ativo ? "var(--cor-alerta)" : "var(--cor-acento)" }}
                        >
                          {u.ativo ? "Desativar" : "Reativar"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ConvidarUsuarioDialog
        aberto={mostrarConvite}
        onFechar={() => setMostrarConvite(false)}
        onSucesso={carregar}
      />

      <ConfirmDialog
        aberto={!!alvoDesativar}
        titulo={alvoDesativar?.ativo ? "Desativar usuário?" : "Reativar usuário?"}
        descricao={
          alvoDesativar?.ativo
            ? `${alvoDesativar?.nome} perderá o acesso ao sistema imediatamente.`
            : `${alvoDesativar?.nome} voltará a ter acesso ao sistema.`
        }
        labelConfirmar={alvoDesativar?.ativo ? "Desativar" : "Reativar"}
        perigoso={!!alvoDesativar?.ativo}
        confirmando={processando}
        onConfirmar={() => alvoDesativar && alternarStatus(alvoDesativar)}
        onCancelar={() => setAlvoDesativar(null)}
      />
    </div>
  );
}
