import { apiFetch, obterAccessToken } from "@/lib/api";
import { Conciliacao, InventarioCiclo, MotivoDivergencia, PainelOperador, StatusItemInventario } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

// --- Etapa A: operador ------------------------------------------------------

export function obterPainelOperador(inventarioId: string) {
  return apiFetch<PainelOperador>(`/inventario/${inventarioId}/operador`);
}

export function registrarContagemItem(
  inventarioId: string,
  produtoId: string,
  dados: { qtd_contada: number; motivo?: MotivoDivergencia | null; anexo_url?: string | null }
) {
  return apiFetch<{ produto_id: string; qtd_contada: number; divergencia: number | null; status_item: StatusItemInventario }>(
    `/inventario/${inventarioId}/itens/${produtoId}`,
    { method: "PATCH", body: JSON.stringify(dados) }
  );
}

export function enviarParaAnalise(inventarioId: string) {
  return apiFetch<{ inventario: InventarioCiclo; itens_contados: number; itens_pendentes: number }>(
    `/inventario/${inventarioId}/enviar-analise`,
    { method: "POST" }
  );
}

export async function enviarAnexoItem(inventarioId: string, produtoId: string, arquivo: File): Promise<string> {
  // Upload multipart não passa pelo apiFetch — mesmo padrão já usado em
  // enviarMinhaFoto (lib/api-conta.ts) e na importação de imagem de produto.
  const formData = new FormData();
  formData.append("arquivo", arquivo);
  const token = obterAccessToken();
  const resp = await fetch(`${API_URL}/inventario/${inventarioId}/itens/${produtoId}/anexo`, {
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
  const dados = await resp.json();
  return dados.anexo_url as string;
}

// --- Etapa B: supervisor -----------------------------------------------------

export function obterConciliacao(inventarioId: string) {
  return apiFetch<Conciliacao>(`/inventario/${inventarioId}/conciliacao`);
}

export function decidirItem(inventarioId: string, produtoId: string, acao: "aprovar" | "recontagem") {
  return apiFetch<{ produto_id: string; status_item: StatusItemInventario }>(
    `/inventario/${inventarioId}/itens/${produtoId}/decisao`,
    { method: "PATCH", body: JSON.stringify({ acao }) }
  );
}

export function aprovarAjusteFinal(inventarioId: string) {
  return apiFetch<{ inventario: InventarioCiclo; itens_ajustados: number; impacto_financeiro_total: number }>(
    `/inventario/${inventarioId}/aprovar-final`,
    { method: "POST" }
  );
}
