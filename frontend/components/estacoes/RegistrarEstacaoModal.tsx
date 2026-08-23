"use client";

import { useEffect, useState } from "react";
import { X, CheckCircle2, AlertCircle } from "lucide-react";
import { useQzTray } from "@/lib/useQzTray";
import { registrarEstacao, atualizarEstacao } from "@/lib/api-estacoes";
import { salvarEstacaoLocal } from "@/lib/useEstacaoRuntime";
import { EstacaoImpressao } from "@/lib/types";
import { useToast } from "@/components/ui";

type Props = {
  aberto: boolean;
  estacaoParaEditar?: EstacaoImpressao | null;
  onFechar: () => void;
  onSalvo: () => void;
};

/**
 * Registro só funciona no navegador do PRÓPRIO computador que vai
 * imprimir — precisa do QZ Tray local respondendo pra listar as
 * impressoras que o SO enxerga. Editar reaproveita o mesmo modal, mas só
 * altera nome/impressora (nunca gera token novo).
 */
export default function RegistrarEstacaoModal({ aberto, estacaoParaEditar, onFechar, onSalvo }: Props) {
  const { status: statusQz, impressoras, conectar } = useQzTray();
  const { sucesso, erro: toastErro } = useToast();
  const [nome, setNome] = useState("");
  const [impressoraEscolhida, setImpressoraEscolhida] = useState("");
  const [salvando, setSalvando] = useState(false);
  const ehEdicao = !!estacaoParaEditar;

  useEffect(() => {
    if (!aberto) return;
    conectar();
    setNome(estacaoParaEditar?.nome || "");
    setImpressoraEscolhida(estacaoParaEditar?.impressora_nome || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, estacaoParaEditar]);

  if (!aberto) return null;

  const qzPronto = statusQz === "conectado";
  const podeSalvar = qzPronto && nome.trim().length >= 2 && !!impressoraEscolhida && !salvando;

  async function salvar() {
    setSalvando(true);
    try {
      if (ehEdicao && estacaoParaEditar) {
        await atualizarEstacao(estacaoParaEditar.id, {
          nome: nome.trim(),
          impressora_nome: impressoraEscolhida,
        });
        sucesso("Estação atualizada.");
      } else {
        const registrada = await registrarEstacao({
          nome: nome.trim(),
          impressora_nome: impressoraEscolhida,
        });
        salvarEstacaoLocal({
          id: registrada.id,
          nome: registrada.nome,
          impressora_nome: registrada.impressora_nome,
          token: registrada.token,
        });
        sucesso(`Estação "${registrada.nome}" registrada — esta aba já está ativa.`);
      }
      onSalvo();
      onFechar();
    } catch {
      toastErro("Não foi possível salvar a estação. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  const corStatus = qzPronto ? "var(--cor-acento)" : "var(--cor-alerta)";

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-4"
      style={{ background: "rgba(10,8,6,0.55)" }}
      onClick={onFechar}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-xl border p-5 shadow-xl"
        style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold" style={{ color: "var(--cor-texto)" }}>
            {ehEdicao ? "Editar estação" : "Registrar estação"}
          </h2>
          <button onClick={onFechar} aria-label="Fechar" style={{ color: "var(--cor-texto-muted)" }}>
            <X size={18} />
          </button>
        </div>
        <p className="mb-5 text-xs" style={{ color: "var(--cor-texto-muted)" }}>
          Precisa ser feito no navegador do próprio computador que vai imprimir.
        </p>

        <div
          className="mb-4 flex items-center gap-3 rounded-lg border p-3"
          style={{ borderColor: corStatus, background: qzPronto ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)" }}
        >
          {qzPronto ? (
            <CheckCircle2 size={20} style={{ color: corStatus, flexShrink: 0 }} />
          ) : (
            <AlertCircle size={20} style={{ color: "var(--cor-alerta)", flexShrink: 0 }} />
          )}
          <div>
            <div className="text-sm font-semibold" style={{ color: "var(--cor-texto)" }}>
              {statusQz === "conectando" && "Procurando QZ Tray…"}
              {statusQz === "conectado" && "QZ Tray detectado nesta máquina"}
              {statusQz === "indisponivel" && "QZ Tray não encontrado"}
              {statusQz === "desconectado" && "Conectando ao QZ Tray…"}
            </div>
            <div className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>
              {qzPronto
                ? `${impressoras.length} impressora(s) encontrada(s) no sistema`
                : statusQz === "indisponivel"
                ? "Instale e abra o QZ Tray nesta máquina, depois clique em tentar de novo."
                : "Aguardando resposta do agente local…"}
            </div>
          </div>
        </div>

        {statusQz === "indisponivel" && (
          <button
            onClick={conectar}
            className="mb-4 text-xs font-semibold underline underline-offset-2"
            style={{ color: "var(--cor-acento)" }}
          >
            Tentar de novo
          </button>
        )}

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            Nome da estação
          </label>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex: Caixa 1, Depósito, Balcão"
            disabled={!qzPronto}
            className="w-full rounded-lg border px-3 py-2.5 text-sm disabled:opacity-50"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          />
        </div>

        <div className="mb-2">
          <label className="mb-1.5 block text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            Impressora
          </label>
          <select
            value={impressoraEscolhida}
            onChange={(e) => setImpressoraEscolhida(e.target.value)}
            disabled={!qzPronto}
            className="w-full appearance-none rounded-lg border px-3 py-2.5 text-sm disabled:opacity-50"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          >
            <option value="" disabled>
              Selecione…
            </option>
            {impressoras.map((imp) => (
              <option key={imp} value={imp}>
                {imp}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px]" style={{ color: "var(--cor-texto-muted)" }}>
            Lista vem direto do QZ Tray — mesmas impressoras que aparecem no seu sistema.
          </p>
        </div>

        <div className="mt-5 flex gap-2.5">
          <button
            onClick={onFechar}
            className="flex-1 rounded-md border py-2.5 text-sm font-semibold"
            style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={!podeSalvar}
            className="flex-[1.4] rounded-md py-2.5 text-sm font-bold disabled:opacity-40"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            {salvando ? "Salvando…" : "Salvar estação"}
          </button>
        </div>
      </div>
    </div>
  );
}
