import { apiFetch } from "@/lib/api";
import { Tenant } from "@/lib/types";

export function obterTenant() {
  return apiFetch<Tenant>("/tenant");
}

export function atualizarTenant(dados: { nome?: string; cnpj?: string | null }) {
  return apiFetch<Tenant>("/tenant", {
    method: "PATCH",
    body: JSON.stringify(dados),
  });
}
