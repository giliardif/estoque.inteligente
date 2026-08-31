"use client";

import { useEffect, useState } from "react";
import { Wifi, WifiOff, Send, Check, Loader2 } from "lucide-react";
import { listarEstacoes, criarJobImpressao, listarFila } from "@/lib/api-estacoes";
import { EstacaoImpressao } from "@/lib/types";

const CHAVE_ULTIMA_ESTACAO = "girostock-ultima-estacao-escolhida";

type Props = {
  titulo: string;
  quantidade: number;
  produtoId?: string | null;
  obterHtml: () => string;
  onEnviado?: () => void;
};

type EstadoEnvio = "ocioso" | "enviando" | "enviado" | "impresso" | "sem_resposta" | "falhou";

/**
 * Alternativa ao QZ Tray local: usada quando este dispositivo não tem
 * impressora conectada (celular, ou PC sem QZ Tray) — manda o job pra
 * fila do backend em vez de tentar imprimir direto. A estação escolhida
 * é lembrada localmente pra não pedir de novo a cada etiqueta.
 */
export function EnviarParaEstacaoBotao({ titulo, quantidade, produtoId, obterHtml, onEnviado }: Props) {
  const [estacoes, setEstacoes] = useState<EstacaoImpressao[]>([]);
  const [estacaoId, setEstacaoId] = useState<string>("");
  const [estado, setEstado] = useState<EstadoEnvio>("ocioso");
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    listarEstacoes()
      .then((lista) => {
        setEstacoes(lista);
        const salva = localStorage.getItem(CHAVE_ULTIMA_ESTACAO);
        const preferida = lista.find((e) => e.id === salva && e.online) || lista.find((e) => e.online);
        if (preferida) setEstacaoId(preferida.id);
      })
      .catch(() => {});
  }, []);

  // Acompanha o status do job por um tempo curto depois do envio — não
  // fica pra sempre, só o suficiente pra dar feedback visual imediato.
  useEffect(() => {
    if (!jobId || estado !== "enviado") return;
    let tentativas = 0;
    const intervalo = setInterval(async () => {
      tentativas += 1;
      try {
        const fila = await listarFila();
        const job = fila.find((j) => j.id === jobId);
        if (job?.status === "impresso") {
          setEstado("impresso");
          clearInterval(intervalo);
        } else if (job?.status === "erro") {
          setEstado("falhou");
          clearInterval(intervalo);
        } else if (tentativas >= 5) {
          setEstado("sem_resposta"); // continua na fila — só para de acompanhar aqui
          clearInterval(intervalo);
        }
      } catch {
        /* mantém tentando até o limite */
      }
    }, 3000);
    return () => clearInterval(intervalo);
  }, [jobId, estado]);

  async function enviar() {
    if (!estacaoId) return;
    setEstado("enviando");
    try {
      localStorage.setItem(CHAVE_ULTIMA_ESTACAO, estacaoId);
      const job = await criarJobImpressao({
        estacao_id: estacaoId,
        produto_id: produtoId || null,
        titulo,
        quantidade,
        payload_json: { html: obterHtml() },
      });
      setJobId(job.id);
      setEstado("enviado");
      onEnviado?.();
    } catch {
      setEstado("falhou");
    }
  }

  if (estacoes.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>
        Nenhuma estação de impressão registrada ainda. Peça pra um admin registrar uma em Configurações →
        Estações de Impressão.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <label className="mb-1.5 block text-[11.5px] font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          Imprimir em
        </label>
        <div className="flex flex-col gap-1.5">
          {estacoes.map((e) => (
            <button
              key={e.id}
              type="button"
              disabled={!e.online}
              onClick={() => setEstacaoId(e.id)}
              className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
              style={
                estacaoId === e.id
                  ? { borderColor: "var(--cor-acento)", background: "rgba(16,185,129,0.06)" }
                  : { borderColor: "var(--cor-borda)", background: "var(--cor-base)" }
              }
            >
              <div>
                <div className="text-[13px] font-semibold" style={{ color: "var(--cor-texto)" }}>
                  {e.nome}
                </div>
                <div className="text-[11px]" style={{ color: "var(--cor-texto-muted)" }}>
                  {e.impressora_nome}
                </div>
              </div>
              <span
                className="flex items-center gap-1 text-[10.5px] font-bold uppercase"
                style={{ color: e.online ? "var(--cor-acento)" : "var(--cor-alerta)" }}
              >
                {e.online ? <Wifi size={11} /> : <WifiOff size={11} />} {e.online ? "Online" : "Offline"}
              </span>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={enviar}
        disabled={!estacaoId || estado === "enviando"}
        className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold disabled:opacity-40"
        style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
      >
        {estado === "enviando" ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        Imprimir
      </button>

      {estado !== "ocioso" && estado !== "enviando" && (
        <div
          className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs"
          style={{
            borderColor: estado === "falhou" ? "var(--cor-alerta)" : "var(--cor-borda)",
            background: "var(--cor-base)",
          }}
        >
          {estado === "impresso" ? (
            <Check size={14} style={{ color: "var(--cor-acento)" }} />
          ) : estado === "falhou" ? (
            <WifiOff size={14} style={{ color: "var(--cor-alerta)" }} />
          ) : (
            <Loader2 size={14} className="animate-spin" style={{ color: "var(--cor-aviso, #F59E0B)" }} />
          )}
          <div>
            <div className="font-semibold" style={{ color: "var(--cor-texto)" }}>
              {estado === "enviado" && "Enviado pra impressão"}
              {estado === "impresso" && "Impresso"}
              {estado === "sem_resposta" && "Continua na fila — aguardando a estação"}
              {estado === "falhou" && "Não foi possível enviar"}
            </div>
            <div style={{ color: "var(--cor-texto-muted)" }}>
              {estado === "sem_resposta"
                ? "Acompanhe em Configurações → Estações de Impressão."
                : estacoes.find((e) => e.id === estacaoId)?.nome}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
