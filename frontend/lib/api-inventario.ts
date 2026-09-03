import { apiFetch, obterAccessToken } from "@/lib/api";
import {
  Conciliacao, DetalheCiclo, InventarioCiclo, MotivoDivergencia, PainelOperador, ResultadoContagem,
  StatusItemInventario,
} from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

// --- Etapa A: operador -------------------------------------------------------

export function obterPainelOperador(inventarioId: string) {
  return apiFetch<PainelOperador>(`/inventario/${inventarioId}/operador`);
}

// Etapa 39.1 — cada chamada aqui é uma tentativa de contagem (logada no
// backend), não um autosave de digitação. Só chamar quando o operador
// aperta "Confirmar" na linha.
export function registrarContagemItem(inventarioId: string, produtoId: string, qtdContada: number) {
  return apiFetch<ResultadoContagem>(`/inventario/${inventarioId}/itens/${produtoId}/contagem`, {
    method: "PATCH",
    body: JSON.stringify({ qtd_contada: qtdContada }),
  });
}

// Operador decide não recontar mais — aceita a última contagem como
// divergência final, sem consumir mais uma tentativa.
export function manterDivergencia(inventarioId: string, produtoId: string) {
  return apiFetch<ResultadoContagem>(`/inventario/${inventarioId}/itens/${produtoId}/manter-divergencia`, {
    method: "POST",
  });
}

// Só pode ser chamado depois do item já estar finalizado como divergente —
// nunca durante a digitação da contagem.
export function registrarJustificativa(
  inventarioId: string, produtoId: string, motivo: MotivoDivergencia, anexoUrl: string | null
) {
  return apiFetch<{ produto_id: string; motivo: MotivoDivergencia; anexo_url: string | null }>(
    `/inventario/${inventarioId}/itens/${produtoId}/justificativa`,
    { method: "PATCH", body: JSON.stringify({ motivo, anexo_url: anexoUrl }) }
  );
}

export function enviarParaAnalise(inventarioId: string) {
  return apiFetch<{ inventario: InventarioCiclo; itens_contados: number; itens_pendentes: number }>(
    `/inventario/${inventarioId}/enviar-analise`,
    { method: "POST" }
  );
}

// Descarta um ciclo aberto sem nenhuma contagem ainda — ex: aberto antes
// de existir produto no tenant, ou aberto por engano.
export function cancelarCiclo(inventarioId: string) {
  return apiFetch<InventarioCiclo>(`/inventario/${inventarioId}/cancelar`, { method: "POST" });
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

// --- Detalhes do ciclo (histórico, qualquer status) -------------------------

export function obterDetalheCiclo(inventarioId: string) {
  return apiFetch<DetalheCiclo>(`/inventario/${inventarioId}/detalhe`);
}
