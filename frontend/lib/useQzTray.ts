"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * QZ Tray é o agente local que permite imprimir direto numa impressora do
 * SO (Zebra, Elgin etc.) sem passar pelo diálogo de impressão do
 * navegador — mas só funciona se o usuário já instalou e está com o QZ
 * Tray rodando na bandeja do sistema. Se não estiver, `conectar()` falha
 * silenciosamente e a tela volta pro modo navegador (fallback já
 * existente desde o design da Etapa 32).
 *
 * Modo usado aqui é "pixel/html": QZ Tray renderiza o HTML da etiqueta e
 * manda pro driver da impressora já instalada no SO — funciona pra
 * qualquer impressora registrada no sistema (incluindo Zebra/Elgin via
 * driver), sem precisar gerar ZPL manualmente. Impressoras configuradas
 * como "raw"/serial puro (sem driver de SO) exigiriam comandos ZPL
 * nativos em vez de pixel/html — fora do escopo desta etapa.
 *
 * Nota sobre certificado: em produção, QZ Tray pede um certificado
 * digital assinado pra evitar o aviso de segurança a cada impressão. Sem
 * isso, o usuário só vê um popup de confirmação do QZ Tray na primeira
 * impressão de cada sessão — funcional, mas não silencioso. Configurar
 * certificado próprio fica como próximo passo, não bloqueia o uso.
 */

type StatusQzTray = "desconectado" | "conectando" | "conectado" | "indisponivel";

export function useQzTray() {
  const [status, setStatus] = useState<StatusQzTray>("desconectado");
  const [impressoras, setImpressoras] = useState<string[]>([]);

  const conectar = useCallback(async () => {
    setStatus("conectando");
    try {
      const qz = (await import("qz-tray")).default;
      if (!qz.websocket.isActive()) {
        await qz.websocket.connect();
      }
      const lista = await qz.printers.find();
      setImpressoras(Array.isArray(lista) ? lista : [lista]);
      setStatus("conectado");
    } catch {
      setStatus("indisponivel"); // QZ Tray não instalado/rodando neste computador
    }
  }, []);

  useEffect(() => {
    conectar();
  }, [conectar]);

  const imprimirHtml = useCallback(async (html: string, impressora: string) => {
    const qz = (await import("qz-tray")).default;
    if (!qz.websocket.isActive()) {
      throw new Error("QZ Tray não está conectado.");
    }
    const config = qz.configs.create(impressora, { units: "mm" });
    await qz.print(config, [{ type: "pixel", format: "html", flavor: "plain", data: html }]);
  }, []);

  return { status, impressoras, conectar, imprimirHtml };
}
