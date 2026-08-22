"use client";

import { useEffect, useRef } from "react";

/**
 * Leitores de código de barras/QR USB/Bluetooth "de bancada" quase sempre
 * operam em modo HID: pro navegador, o aparelho se comporta como um
 * teclado — "digita" cada caractere do código muito mais rápido do que
 * uma pessoa digitaria, e manda um Enter no final.
 *
 * Esse hook não precisa de nenhuma API especial de hardware: escuta
 * `keydown` em qualquer input, acumula os caracteres, e usa o intervalo
 * entre teclas pra decidir se aquilo foi bipado ou digitado por uma
 * pessoa. Digitação humana normal tipicamente tem >60-80ms entre teclas;
 * leitores HID emitem a sequência inteira em poucos milissegundos.
 *
 * onCodigoLido só dispara quando o padrão bate (rápido + Enter) — digitação
 * humana normal no mesmo campo continua funcionando exatamente como antes
 * (filtro por nome, etc.), sem nenhuma mudança de comportamento visível.
 */

const INTERVALO_MAX_MS = 40; // acima disso, entre duas teclas, consideramos digitação humana
const TAMANHO_MINIMO_CODIGO = 4; // códigos reais (EAN/SKU) sempre têm mais que isso

export function useLeitorFisico(onCodigoLido: (codigo: string) => void) {
  const bufferRef = useRef<string>("");
  const ultimoTimestampRef = useRef<number>(0);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null;
      const emCampoDeTexto =
        alvo instanceof HTMLInputElement || alvo instanceof HTMLTextAreaElement;
      if (!emCampoDeTexto) return;

      const agora = performance.now();
      const intervalo = agora - ultimoTimestampRef.current;
      ultimoTimestampRef.current = agora;

      if (e.key === "Enter") {
        const codigo = bufferRef.current;
        bufferRef.current = "";
        // Só trata como leitura física se o buffer acumulado é longo o
        // suficiente pra ser um código real — Enter isolado (ex: submeter
        // um formulário normalmente) não deve disparar nada aqui.
        if (codigo.length >= TAMANHO_MINIMO_CODIGO) {
          onCodigoLido(codigo);
        }
        return;
      }

      if (e.key.length !== 1) return; // ignora teclas de controle (Shift, Tab, setas...)

      if (intervalo > INTERVALO_MAX_MS) {
        // Gap grande demais desde a última tecla — não é uma leitura em
        // andamento, reinicia o buffer (evita misturar digitação humana
        // esparsa com uma leitura que comece logo depois).
        bufferRef.current = e.key;
      } else {
        bufferRef.current += e.key;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCodigoLido]);
}
