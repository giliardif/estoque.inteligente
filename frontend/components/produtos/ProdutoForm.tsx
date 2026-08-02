"use client";

// Substitui NovoProdutoForm: mesmo formulário agora serve pra criar E editar
// (PATCH /produtos/{id} já existia no backend e não estava sendo usado em
// lugar nenhum). Passe `produto` pra abrir em modo edição.

import { useState, FormEvent } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { Produto, ProdutoCreateInput } from "@/lib/types";

export function ProdutoForm({
  produto, onSalvo, onCancelar,
}: { produto?: Produto; onSalvo: () => void; onCancelar?: () => void }) {
  const editando = !!produto;
  const [form, setForm] = useState<ProdutoCreateInput>(
    produto
      ? {
          nome: produto.nome, sku: produto.sku, categoria_id: produto.categoria_id,
          codigo_barras: produto.codigo_barras, unidade_medida: produto.unidade_medida,
          custo_medio: produto.custo_medio, estoque_minimo: produto.estoque_minimo,
          estoque_maximo: produto.estoque_maximo,
        }
      : { nome: "", unidade_medida: "un", custo_medio: 0, estoque_minimo: 0 }
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      if (editando) {
        await apiFetch(`/produtos/${produto.id}`, { method: "PATCH", body: JSON.stringify(form) });
      } else {
        await apiFetch("/produtos", { method: "POST", body: JSON.stringify(form) });
      }
      onSalvo();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível salvar o produto.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border p-5 flex flex-col gap-3 max-w-md"
      style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
    >
      {erro && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
          {erro}
        </div>
      )}
      <Campo label="Nome" required value={form.nome} onChange={(v) => setForm({ ...form, nome: v })} />
      <div className="grid grid-cols-2 gap-3">
        <Campo
          label="SKU"
          value={form.sku ?? ""}
          onChange={(v) => setForm({ ...form, sku: v })}
        />
        <Campo label="Unidade" value={form.unidade_medida ?? "un"} onChange={(v) => setForm({ ...form, unidade_medida: v })} />
      </div>
      <Campo
        label="Código de barras"
        value={form.codigo_barras ?? ""}
        onChange={(v) => setForm({ ...form, codigo_barras: v })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Campo
          label="Custo médio"
          type="number"
          value={String(form.custo_medio ?? 0)}
          onChange={(v) => setForm({ ...form, custo_medio: Number(v) })}
        />
        <Campo
          label="Estoque mínimo"
          type="number"
          value={String(form.estoque_minimo ?? 0)}
          onChange={(v) => setForm({ ...form, estoque_minimo: Number(v) })}
        />
      </div>
      <div className="flex gap-2 mt-1">
        {onCancelar && (
          <button
            type="button"
            onClick={onCancelar}
            disabled={salvando}
            className="rounded-md py-2 px-4 font-semibold text-sm border disabled:opacity-60"
            style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          >
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={salvando}
          className="flex-1 rounded-md py-2 font-bold text-sm disabled:opacity-60"
          style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
        >
          {salvando ? "Salvando..." : editando ? "Salvar alterações" : "Salvar produto"}
        </button>
      </div>
    </form>
  );
}

function Campo({
  label, value, onChange, type = "text", required = false,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
      {label}
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
        style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
      />
    </label>
  );
}
