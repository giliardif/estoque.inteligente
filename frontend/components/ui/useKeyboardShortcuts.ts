"use client";

import { useEffect } from "react";

// Atalhos padrão do kit, usados em todas as telas de lista:
//   "/"   -> foca a busca
//   "n"   -> abre "novo item"
//   "Esc" -> fecha formulário/modal aberto
//
// "/" e "n" são ignorados quando o foco já está num campo de texto (senão
// digitar "n" numa descrição abriria o formulário no meio da digitação).
// "Esc" funciona mesmo dentro de inputs, pra sempre poder fechar algo.
export function useKeyboardShortcuts({
  onFocusBusca, onNovo, onEscape,
}: {
  onFocusBusca?: () => void;
  onNovo?: () => void;
  onEscape?: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement;
      const digitando = alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable;

      if (e.key === "Escape") {
        onEscape?.();
        return;
      }
      if (digitando) return;

      if (e.key === "/") {
        e.preventDefault();
        onFocusBusca?.();
      } else if (e.key === "n" || e.key === "N") {
        onNovo?.();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onFocusBusca, onNovo, onEscape]);
}
