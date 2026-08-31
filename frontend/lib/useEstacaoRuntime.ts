"use client";

import { useCallback, useEffect, useRef, useState } from "react";import { useQzTray } from "@/lib/useQzTray";
import {
  buscarJobsPendentes,
  concluirJobComoEstacao,
  marcarErroComoEstacao,
  EstacaoTokenError,
} from "@/lib/api-estacoes";

const CHAVE_LOCAL_STORAGE = "girostock-estacao-ativa";
const INTERVALO_POLLING_MS = 6000; // dentro da faixa 5-8s definida na etapa

export type EstacaoLocal = {
  id: string;
  nome: string;
  impressora_nome: string;
  token: string;
};

/**
 * O token da estação fica em localStorage — diferente do access_token de
 * usuário (guardado só em memória, por segurança contra XSS), porque a
 * estação PRECISA sobreviver a fechar aba / reiniciar o navegador sem
 * depender de ninguém logar de novo. O escopo desse token já é mínimo por
 * natureza (só lê a própria fila e marca jobs como impresso/erro do
 * próprio tenant) — o blast radius de um roubo é bem menor que o de um
 * JWT de usuário, o que torna esse tradeoff aceitável aqui.
 */
export function salvarEstacaoLocal(dados: EstacaoLocal) {
  localStorage.setItem(CHAVE_LOCAL_STORAGE, JSON.stringify(dados));
}

export function obterEstacaoLocal(): EstacaoLocal | null {
  if (typeof window === "undefined") return null;
  const bruto = localStorage.getItem(CHAVE_LOCAL_STORAGE);
  if (!bruto) return null;
  try {
    return JSON.parse(bruto) as EstacaoLocal;
  } catch {
    return null;
  }
}

export function limparEstacaoLocal() {
  localStorage.removeItem(CHAVE_LOCAL_STORAGE);
}

type StatusRuntime = "inativo" | "aguardando_qz" | "rodando" | "token_invalido";

/**
 * Roda em qualquer página que monte este hook (a própria tela de
 * Estações de Impressão) SE este navegador tiver uma estação registrada
 * localmente. Se não tiver (visualização de outro dispositivo/admin
 * olhando de longe), o hook fica inerte — não tenta conectar QZ Tray nem
 * faz polling.
 */
export function useEstacaoRuntime() {
  const [estacaoLocal, setEstacaoLocal] = useState<EstacaoLocal | null>(null);
  const [status, setStatus] = useState<StatusRuntime>("inativo");
  const [ultimoJobImpresso, setUltimoJobImpresso] = useState<string | null>(null);
  const { status: statusQz, imprimirHtml } = useQzTray();
  const processandoRef = useRef(false);

  useEffect(() => {
    setEstacaoLocal(obterEstacaoLocal());
  }, []);

  const registrarNesteNavegador = useCallback((dados: EstacaoLocal) => {
    salvarEstacaoLocal(dados);
    setEstacaoLocal(dados);
  }, []);

  const desconectarDesteNavegador = useCallback(() => {
    limparEstacaoLocal();
    setEstacaoLocal(null);
    setStatus("inativo");
  }, []);

  const processarFila = useCallback(async () => {
    if (!estacaoLocal || processandoRef.current) return;
    processandoRef.current = true;
    try {
      const pendentes = await buscarJobsPendentes(estacaoLocal.token);
      if (statusQz !== "conectado") {
        setStatus("aguardando_qz");
        return; // heartbeat já foi registrado pela chamada acima, mesmo sem imprimir
      }
      setStatus("rodando");
      for (const job of pendentes) {
        try {
          const html = job.payload_json?.html || `<div>${job.titulo}</div>`;
          await imprimirHtml(html, estacaoLocal.impressora_nome);
          await concluirJobComoEstacao(estacaoLocal.token, job.id);
          setUltimoJobImpresso(job.titulo);
        } catch {
          // Falha real de impressão (driver, papel, impressora desligada) —
          // marca erro explícito. Diferente de "sem resposta" (que é a
          // estação inteira offline, não um job específico falhando).
          await marcarErroComoEstacao(estacaoLocal.token, job.id).catch(() => {});
        }
      }
    } catch (err) {
      if (err instanceof EstacaoTokenError && err.status === 401) {
        // Token revogado no meio da execução — para de tentar e limpa o
        // registro local, pra não ficar martelando um token morto.
        setStatus("token_invalido");
        limparEstacaoLocal();
        setEstacaoLocal(null);
      }
    } finally {
      processandoRef.current = false;
    }
  }, [estacaoLocal, statusQz, imprimirHtml]);

  // Fix de stale closure: o setInterval abaixo só reinicia quando a
  // ESTAÇÃO muda (não a cada mudança de statusQz/imprimirHtml, que
  // mudam com frequência normal — reiniciar o interval toda hora
  // atrapalharia o cronograma de polling). Por isso ele chama sempre a
  // versão mais recente de processarFila via ref, em vez de fechar sobre
  // uma cópia congelada da função pega no momento em que o efeito rodou.
  const processarFilaRef = useRef(processarFila);
  useEffect(() => {
    processarFilaRef.current = processarFila;
  }, [processarFila]);

  useEffect(() => {
    if (!estacaoLocal) return;
    processarFilaRef.current();
    const intervalo = setInterval(() => processarFilaRef.current(), INTERVALO_POLLING_MS);

    // Reconexão em foco: se o navegador jogou a aba pra segundo plano e
    // throttlou o setInterval, força um ciclo assim que a aba volta a
    // ficar visível, em vez de esperar o próximo tick regular.
    const aoVoltarFoco = () => {
      if (document.visibilityState === "visible") processarFilaRef.current();
    };
    document.addEventListener("visibilitychange", aoVoltarFoco);

    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltarFoco);
    };
  }, [estacaoLocal?.id]);

  return {
    estacaoLocal,
    status,
    statusQz,
    ultimoJobImpresso,
    registrarNesteNavegador,
    desconectarDesteNavegador,
  };
}
