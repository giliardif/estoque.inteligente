import { apiFetch, obterAccessToken } from "@/lib/api";
import { Usuario } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export function obterMeusDados() {
  return apiFetch<Usuario>("/usuarios/me");
}

export function atualizarMeuNome(nome: string) {
  return apiFetch<Usuario>("/usuarios/me", {
    method: "PATCH",
    body: JSON.stringify({ nome }),
  });
}

export async function enviarMinhaFoto(arquivo: File): Promise<Usuario> {
  // Upload multipart não passa pelo apiFetch (que sempre seta Content-Type
  // json) — mesmo padrão já usado no upload de imagem de produto e na
  // importação de XML de NF-e.
  const formData = new FormData();
  formData.append("arquivo", arquivo);
  const token = obterAccessToken();
  const resp = await fetch(`${API_URL}/usuarios/me/foto`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
    body: formData,
  });
  if (!resp.ok) {
    const corpo = await resp.json().catch(() => ({}));
    const detalhe = typeof corpo.detail === "string" ? corpo.detail : "Não foi possível enviar a foto.";
    throw new Error(detalhe);
  }
  return resp.json();
}
