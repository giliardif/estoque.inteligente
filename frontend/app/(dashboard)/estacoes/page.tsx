"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Printer, Plus, Wifi, WifiOff, RotateCcw, Pencil, ShieldOff, RefreshCw,
} from "lucide-react";
import { useToast, ConfirmDialog } from "@/components/ui";
import RegistrarEstacaoModal from "@/components/estacoes/RegistrarEstacaoModal";
import { useEstacaoRuntime } from "@/lib/useEstacaoRuntime";
import { listarEstacoes, listarFila, revogarEstacao, reimprimirJob } from "@/lib/api-estacoes";
import { EstacaoImpressao, JobImpressao, StatusJobImpressao } from "@/lib/types";

// Job pendente há mais que isso, sem a estação bater heartbeat nesse meio
// tempo, é tratado como "sem resposta" na exibição — nunca reenviado
// sozinho (reimpressão continua sempre manual).
const LIMIAR_SEM_RESPOSTA_MS = 90_000;

function tempoRelativo(iso: string | null): string {
  if (!iso) return "nunca";
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 5) return "agora";
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  return `há ${h}h`;
}

function StatusPill({ status, criadoEm }: { status: StatusJobImpressao; criadoEm: string }) {
  const semResposta =
    status === "pendente" && Date.now() - new Date(criadoEm).getTime() > LIMIAR_SEM_RESPOSTA_MS;
  if (status === "impresso") {
    return (
      <span
        className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase"
        style={{ background: "rgba(16,185,129,0.14)", color: "var(--cor-acento)" }}
      >
        ✓ Impresso
      </span>
    );
  }
  if (status === "erro" || semResposta) {
    return (
      <span
        className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase"
        style={{ background: "rgba(239,68,68,0.12)", color: "var(--cor-alerta)" }}
      >
        ⚠ {status === "erro" ? "Erro" : "Sem resposta"}
      </span>
    );
  }
  return (
    <span
      className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase"
      style={{ background: "rgba(245,158,11,0.14)", color: "var(--cor-aviso, #F59E0B)" }}
    >
      Pendente
    </span>
  );
}

export default function EstacoesImpressaoPage() {
  const { sucesso, erro: toastErro } = useToast();
  const runtime = useEstacaoRuntime();

  const [estacoes, setEstacoes] = useState<EstacaoImpressao[]>([]);
  const [fila, setFila] = useState<JobImpressao[]>([]);
  const [filtroStatus, setFiltroStatus] = useState<StatusJobImpressao | undefined>(undefined);
  const [carregando, setCarregando] = useState(true);

  const [modalAberto, setModalAberto] = useState(false);
  const [estacaoEditando, setEstacaoEditando] = useState<EstacaoImpressao | null>(null);
  const [estacaoParaRevogar, setEstacaoParaRevogar] = useState<EstacaoImpressao | null>(null);
  const [revogando, setRevogando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [estacoesResp, filaResp] = await Promise.all([listarEstacoes(), listarFila(filtroStatus)]);
      setEstacoes(estacoesResp);
      setFila(filaResp);
    } catch {
      toastErro("Não foi possível carregar as estações de impressão.");
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroStatus]);

  useEffect(() => {
    carregar();
    // Qualquer dispositivo olhando esta tela vê o estado real (heartbeat,
    // novos jobs) — não só o dispositivo que É a estação em si.
    const intervalo = setInterval(carregar, 8000);
    return () => clearInterval(intervalo);
  }, [carregar]);

  const estacaoReconectadaComPendente = estacoes.find((e) => {
    if (!e.online) return false;
    return fila.some(
      (j) =>
        j.estacao_id === e.id &&
        j.status === "pendente" &&
        Date.now() - new Date(j.criado_em).getTime() > LIMIAR_SEM_RESPOSTA_MS
    );
  });

  async function confirmarRevogar() {
    if (!estacaoParaRevogar) return;
    setRevogando(true);
    try {
      await revogarEstacao(estacaoParaRevogar.id);
      sucesso(`Acesso de "${estacaoParaRevogar.nome}" revogado.`);
      if (runtime.estacaoLocal?.id === estacaoParaRevogar.id) runtime.desconectarDesteNavegador();
      setEstacaoParaRevogar(null);
      carregar();
    } catch {
      toastErro("Não foi possível revogar o acesso desta estação.");
    } finally {
      setRevogando(false);
    }
  }

  async function handleReimprimir(job: JobImpressao) {
    try {
      await reimprimirJob(job.id);
      sucesso(`"${job.titulo}" reenviado pra fila da ${job.estacao_nome}.`);
      carregar();
    } catch {
      toastErro("Não foi possível reimprimir este item.");
    }
  }

  const th = "text-left px-4 py-2.5 text-[11px] uppercase tracking-wide font-bold";

  return (
    <div className="max-w-[1000px]">
      <div className="mb-1 text-[13px]" style={{ color: "var(--cor-texto-muted)" }}>
        Configurações
      </div>
      <div className="mb-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="font-display text-[24px] sm:text-[26px] font-semibold" style={{ color: "var(--cor-texto)" }}>
          Estações de Impressão
        </h1>
        <button
          onClick={() => {
            setEstacaoEditando(null);
            setModalAberto(true);
          }}
          className="flex shrink-0 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold"
          style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
        >
          <Plus size={16} /> Registrar nova estação
        </button>
      </div>
      <p className="mb-6 max-w-[620px] text-sm" style={{ color: "var(--cor-texto-muted)" }}>
        Cada estação é um computador ligado a uma impressora. Ao mandar imprimir do celular ou de qualquer
        dispositivo, você escolhe pra qual estação enviar.
      </p>

      {runtime.estacaoLocal && (
        <div
          className="mb-5 flex items-center gap-3 rounded-xl border px-4 py-3"
          style={{ borderColor: "var(--cor-acento)", background: "rgba(16,185,129,0.06)" }}
        >
          <RefreshCw
            size={16}
            className={runtime.status === "rodando" ? "animate-spin" : ""}
            style={{ color: "var(--cor-acento)", flexShrink: 0, animationDuration: "2s" }}
          />
          <div className="text-sm">
            <span className="font-semibold" style={{ color: "var(--cor-texto)" }}>
              Este navegador é a estação &quot;{runtime.estacaoLocal.nome}&quot;.
            </span>{" "}
            <span style={{ color: "var(--cor-texto-muted)" }}>
              {runtime.status === "aguardando_qz" && "Aguardando QZ Tray responder…"}
              {runtime.status === "rodando" && "Rodando — verificando a fila em segundo plano."}
              {runtime.status === "token_invalido" && "Acesso revogado — registre de novo."}
              {runtime.status === "inativo" && "Iniciando…"}
            </span>
          </div>
        </div>
      )}

      <div className="mb-8 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {estacoes.map((e) => (
          <div
            key={e.id}
            className="rounded-xl border p-4"
            style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)", opacity: e.online ? 1 : 0.75 }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "var(--cor-base)" }}
                >
                  <Printer size={17} style={{ color: e.online ? "var(--cor-acento)" : "var(--cor-texto-muted)" }} />
                </div>
                <div>
                  <div className="text-[14.5px] font-semibold" style={{ color: "var(--cor-texto)" }}>
                    {e.nome}
                  </div>
                  <div className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>
                    {e.impressora_nome}
                  </div>
                </div>
              </div>
              <span
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase"
                style={
                  e.online
                    ? { background: "rgba(16,185,129,0.14)", color: "var(--cor-acento)" }
                    : { background: "rgba(239,68,68,0.12)", color: "var(--cor-alerta)" }
                }
              >
                {e.online ? <Wifi size={11} /> : <WifiOff size={11} />} {e.online ? "Online" : "Offline"}
              </span>
            </div>
            <div
              className="flex justify-between border-t pt-2.5 text-xs"
              style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
            >
              <span>Última atividade: {tempoRelativo(e.ultima_atividade_em)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <button
                onClick={() => {
                  setEstacaoEditando(e);
                  setModalAberto(true);
                }}
                className="flex items-center gap-1 text-[11px] underline underline-offset-2"
                style={{ color: "var(--cor-texto-muted)" }}
              >
                <Pencil size={11} /> Editar impressora
              </button>
              <button
                onClick={() => setEstacaoParaRevogar(e)}
                className="flex items-center gap-1 text-[11px] underline underline-offset-2"
                style={{ color: "var(--cor-alerta)", opacity: 0.85 }}
              >
                <ShieldOff size={11} /> Revogar acesso
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={() => {
            setEstacaoEditando(null);
            setModalAberto(true);
          }}
          className="flex min-h-[98px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-sm font-semibold"
          style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
        >
          <Plus size={20} /> Registrar nova estação
        </button>
      </div>

      {!carregando && estacoes.length === 0 && (
        <p className="mb-8 text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Nenhuma estação registrada ainda. Abra esta tela no computador ligado à impressora e clique em
          &quot;Registrar nova estação&quot;.
        </p>
      )}

      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[15px] font-bold" style={{ color: "var(--cor-texto)" }}>
          Fila de impressão
        </h2>
        <div className="flex gap-2">
          {([undefined, "pendente", "erro"] as const).map((s) => (
            <button
              key={s ?? "todas"}
              onClick={() => setFiltroStatus(s)}
              className="rounded-full border px-3 py-1.5 text-xs font-semibold"
              style={
                filtroStatus === s
                  ? { borderColor: "var(--cor-acento)", background: "rgba(16,185,129,0.06)", color: "var(--cor-acento)" }
                  : { borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }
              }
            >
              {s === undefined ? "Todas" : s === "pendente" ? "Pendentes" : "Erros"}
            </button>
          ))}
        </div>
      </div>

      {estacaoReconectadaComPendente && (
        <div
          className="mb-4 flex items-center gap-3 rounded-xl border px-4 py-3.5"
          style={{ borderColor: "var(--cor-acento)", background: "rgba(16,185,129,0.06)" }}
        >
          <div
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg"
            style={{ background: "rgba(16,185,129,0.16)" }}
          >
            <RotateCcw size={16} style={{ color: "var(--cor-acento)" }} />
          </div>
          <div>
            <div className="text-[13.5px] font-semibold" style={{ color: "var(--cor-texto)" }}>
              {estacaoReconectadaComPendente.nome} voltou a ficar online
            </div>
            <div className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>
              Tem job pendente sem resposta — quer reimprimir agora?
            </div>
          </div>
        </div>
      )}

      {/* Mobile: cards */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {fila.map((job) => (
          <div
            key={job.id}
            className="rounded-xl border p-3.5"
            style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <div className="text-[13.5px] font-semibold" style={{ color: "var(--cor-texto)" }}>
                  {job.titulo}
                </div>
                <div className="text-[11.5px]" style={{ color: "var(--cor-texto-muted)" }}>
                  {job.quantidade} etiquetas · {job.estacao_nome}
                </div>
              </div>
              <StatusPill status={job.status} criadoEm={job.criado_em} />
            </div>
            <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--cor-texto-muted)" }}>
              <span>
                {job.enviado_por_nome ?? "—"} · {tempoRelativo(job.criado_em)}
              </span>
              {job.status !== "impresso" && (
                <button
                  onClick={() => handleReimprimir(job)}
                  className="flex items-center gap-1 rounded-md border px-2.5 py-1 font-semibold"
                  style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
                >
                  <RotateCcw size={11} /> Reimprimir
                </button>
              )}
            </div>
          </div>
        ))}
        {!carregando && fila.length === 0 && (
          <p className="py-6 text-center text-sm" style={{ color: "var(--cor-texto-muted)" }}>
            Nenhum job na fila.
          </p>
        )}
      </div>

      {/* Desktop: tabela */}
      <div
        className="hidden overflow-hidden rounded-xl border md:block"
        style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }}
      >
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--cor-borda)", background: "var(--cor-base)" }}>
              {["Item", "Estação", "Enviado por", "Quando", "Status", ""].map((h) => (
                <th key={h} className={th} style={{ color: "var(--cor-texto-muted)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fila.map((job) => (
              <tr key={job.id} style={{ borderBottom: "1px solid var(--cor-borda)" }}>
                <td className="px-4 py-3">
                  <div className="text-[13px] font-semibold" style={{ color: "var(--cor-texto)" }}>
                    {job.titulo}
                  </div>
                  <div className="text-[11.5px]" style={{ color: "var(--cor-texto-muted)" }}>
                    {job.quantidade} etiquetas
                  </div>
                </td>
                <td className="px-4 py-3 text-[12.5px]" style={{ color: "var(--cor-texto-muted)" }}>
                  {job.estacao_nome}
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: "var(--cor-texto-muted)" }}>
                  {job.enviado_por_nome ?? "—"}
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: "var(--cor-texto-muted)" }}>
                  {tempoRelativo(job.criado_em)}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={job.status} criadoEm={job.criado_em} />
                </td>
                <td className="px-4 py-3">
                  {job.status !== "impresso" && (
                    <button
                      onClick={() => handleReimprimir(job)}
                      className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold"
                      style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
                    >
                      <RotateCcw size={11} /> Reimprimir
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!carregando && fila.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: "var(--cor-texto-muted)" }}>
                  Nenhum job na fila.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <RegistrarEstacaoModal
        aberto={modalAberto}
        estacaoParaEditar={estacaoEditando}
        onFechar={() => setModalAberto(false)}
        onSalvo={carregar}
      />

      <ConfirmDialog
        aberto={!!estacaoParaRevogar}
        titulo={`Revogar acesso de ${estacaoParaRevogar?.nome ?? ""}?`}
        descricao="Isso invalida o token dessa estação imediatamente. Ela para de puxar a fila, fica offline permanente, e precisa ser registrada de novo (com QZ Tray) pra voltar a funcionar."
        labelConfirmar="Sim, revogar acesso"
        perigoso
        confirmando={revogando}
        onConfirmar={confirmarRevogar}
        onCancelar={() => setEstacaoParaRevogar(null)}
      />
    </div>
  );
}
