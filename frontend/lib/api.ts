"use client";

/**
 * Cliente HTTP central. Regras de segurança aplicadas aqui:
 *  - access_token vive só em memória (variável de módulo) — nunca em
 *    localStorage, para reduzir a superfície de um ataque XSS conseguir
 *    roubar o token (localStorage é legível por qualquer script na página;
 *    uma variável de módulo já protege contra o caso mais comum).
 *  - refresh_token vive num cookie httpOnly setado pelo backend (não
 *    acessível via JavaScript) — aqui só orquestramos a chamada.
 *  - Nunca logamos o corpo de request/response no console em produção
 *    (pode conter token ou dado de cliente).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

let accessTokenEmMemoria: string | null = null;

export function definirAccessToken(token: string | null) {
  accessTokenEmMemoria = token;
}

export function obterAccessToken(): string | null {
  return accessTokenEmMemoria;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function tentarRenovarToken(): Promise<boolean> {
  const resp = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include", // envia o cookie httpOnly do refresh_token
    headers: { "Content-Type": "application/json" },
  });
  if (!resp.ok) return false;
  const data = await resp.json();
  definirAccessToken(data.access_token);
  return true;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  _tentouRenovar = false
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (accessTokenEmMemoria) headers.set("Authorization", `Bearer ${accessTokenEmMemoria}`);

  const resp = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });

  if (resp.status === 401 && !_tentouRenovar) {
    const renovou = await tentarRenovarToken();
    if (renovou) return apiFetch<T>(path, options, true);
  }

  if (!resp.ok) {
    let detalhe = "Erro inesperado. Tente novamente.";
    try {
      const corpo = await resp.json();
      detalhe = corpo.detail || detalhe;
    } catch {
      /* resposta sem corpo JSON — mantém mensagem genérica */
    }
    throw new ApiError(resp.status, detalhe);
  }

  if (resp.status === 204) return undefined as T;
  return resp.json();
}

export { ApiError };
