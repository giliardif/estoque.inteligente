"use client";

import { useEffect, useState } from "react";

// Debounce genérico — usado pra busca instantânea sem disparar uma
// requisição a cada tecla digitada. 300ms é o padrão adotado no kit;
// pode ser ajustado por tela se necessário.
export function useDebouncedValue<T>(valor: T, atrasoMs = 300): T {
  const [debounced, setDebounced] = useState(valor);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(valor), atrasoMs);
    return () => clearTimeout(timer);
  }, [valor, atrasoMs]);

  return debounced;
}
