"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Estações de Impressão migrou para dentro de Configurações na Etapa 37 —
// este redirect evita quebrar links/favoritos antigos apontando pra /estacoes.
export default function EstacoesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/configuracoes?aba=estacoes");
  }, [router]);
  return null;
}
