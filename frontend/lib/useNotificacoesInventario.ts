"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { obterNotificacoes } from "@/lib/api-inventario";
import { useAuth } from "@/lib/auth-context";

const INTERVALO_POLL_MS = 20_000;

/**
 * Badge leve pro menu de Inventário: quantos itens estão com recontagem
 * solicitada pela supervisão, esperando o operador. Como não existe push
 * de verdade (fase separada, no backlog), isso cobre o caso prático de
 * "saí do app e voltei" com duas estratégias baratas: refetch quando a
 * aba ganha foco/fica visível de novo, e polling leve enquanto o app
 * estiver aberto. Sem autenticação, nem tenta.
 */
export function useNotificacoesInventario() {
  const { usuario } = useAuth();
  const [itensRecontagemPendente, setItensRecontagemPendente] = useState(0);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const atualizar = useCallback(async () => {
    if (!usuario) return;
    try {
      const dados = await obterNotificacoes();
      setItensRecontagemPendente(dados.itens_recontagem_pendente);
    } catch {
      // Notificação é informativa — uma falha aqui não deve incomodar o usuário
    }
  }, [usuario]);

  useEffect(() => {
    if (!usuario) return;
    atualizar();

    intervaloRef.current = setInterval(atualizar, INTERVALO_POLL_MS);
    const aoFicarVisivel = () => { if (document.visibilityState === "visible") atualizar(); };
    document.addEventListener("visibilitychange", aoFicarVisivel);
    window.addEventListener("focus", atualizar);

    return () => {
      if (intervaloRef.current) clearInterval(intervaloRef.current);
      document.removeEventListener("visibilitychange", aoFicarVisivel);
      window.removeEventListener("focus", atualizar);
    };
  }, [usuario, atualizar]);

  return { itensRecontagemPendente, atualizar };
}
