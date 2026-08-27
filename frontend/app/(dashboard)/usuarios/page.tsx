"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Usuários migrou para dentro de Configurações na Etapa 37 — este redirect
// evita quebrar links/favoritos antigos apontando pra /usuarios.
export default function UsuariosRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/configuracoes?aba=usuarios");
  }, [router]);
  return null;
}
