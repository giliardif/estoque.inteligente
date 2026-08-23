import { apiFetch } from "@/lib/api";
import {
  EstacaoImpressao,
  EstacaoImpressaoRegistrada,
  JobImpressao,
  JobImpressaoPendente,
  StatusJobImpressao,
} from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

// ===== Gestão de estações (sessão de usuário) =====

export function listarEstacoes() {
  return apiFetch<EstacaoImpressao[]>("/estacoes");
}

export function registrarEstacao(dados: { nome: string; impressora_nome: string }) {
  return apiFetch<EstacaoImpressaoRegistrada>("/estacoes", {
    method: "POST",
    body: JSON.stringify(dados),
  });
}

export function atualizarEstacao(id: string, dados: { nome?: string; impressora_nome?: string }) {
  return apiFetch<EstacaoImpressao>(`/estacoes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(dados),
  });
}

export function revogarEstacao(id: string) {
  return apiFetch<void>(`/estacoes/${id}/revogar`, { method: "POST" });
}

// ===== Fila (sessão de usuário) =====

export function listarFila(statusFiltro?: StatusJobImpressao) {
  const qs = statusFiltro ? `?status_filtro=${statusFiltro}` : "";
  return apiFetch<JobImpressao[]>(`/estacoes/fila${qs}`);
}

export function criarJobImpressao(dados: {
  estacao_id: string;
  produto_id?: string | null;
  titulo: string;
  quantidade: number;
  payload_json: { html: string };
}) {
  return apiFetch<JobImpressao>("/estacoes/fila", {
    method: "POST",
    body: JSON.stringify(dados),
  });
}

export function reimprimirJob(jobId: string) {
  return apiFetch<JobImpressao>(`/estacoes/fila/${jobId}/reimprimir`, { method: "POST" });
}

// ===== Chamadas feitas PELA PRÓPRIA estação (token de dispositivo, não
// sessão de usuário) — fetch dedicado, sem o fluxo de refresh de JWT de
// usuário do apiFetch, já que aqui a credencial é outra. =====

class EstacaoTokenError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function estacaoFetch<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-Estacao-Token", token);

  const resp = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!resp.ok) {
    let detalhe = "Erro de comunicação com o backend.";
    try {
      detalhe = (await resp.json()).detail || detalhe;
    } catch {
      /* sem corpo JSON */
    }
    throw new EstacaoTokenError(resp.status, detalhe);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json();
}

export function buscarJobsPendentes(token: string) {
  return estacaoFetch<JobImpressaoPendente[]>("/estacoes/fila/pendentes", token);
}

export function concluirJobComoEstacao(token: string, jobId: string) {
  return estacaoFetch<JobImpressao>(`/estacoes/fila/${jobId}/concluir`, token, { method: "POST" });
}

export function marcarErroComoEstacao(token: string, jobId: string) {
  return estacaoFetch<JobImpressao>(`/estacoes/fila/${jobId}/erro`, token, { method: "POST" });
}

export { EstacaoTokenError };
