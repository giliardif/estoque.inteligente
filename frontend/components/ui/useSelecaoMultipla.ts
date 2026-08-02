"use client";

import { useMemo, useState } from "react";

// Seleção múltipla de linhas por id. Genérico o bastante pra qualquer tela
// de lista (produtos, notas, itens de compra etc.) sem duplicar o estado de
// Set<string> e os handlers em cada uma. Por padrão usa `item.id`, mas
// aceita um extrator pra telas cuja chave tem outro nome (ex: `produto_id`
// no painel de Estoque).
export function useSelecaoMultipla<T>(itens: T[], obterId: (item: T) => string = (i) => (i as { id: string }).id) {
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const todosSelecionados = itens.length > 0 && itens.every((i) => selecionados.has(obterId(i)));
  const algumSelecionado = selecionados.size > 0;

  function alternar(id: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function alternarTodos() {
    setSelecionados(todosSelecionados ? new Set() : new Set(itens.map(obterId)));
  }

  function limpar() {
    setSelecionados(new Set());
  }

  const itensSelecionados = useMemo(
    () => itens.filter((i) => selecionados.has(obterId(i))),
    [itens, selecionados, obterId]
  );

  return {
    selecionados, itensSelecionados, todosSelecionados, algumSelecionado,
    alternar, alternarTodos, limpar,
  };
}
