"use client";

// Substitui NovoProdutoForm: mesmo formulário agora serve pra criar E editar
// (PATCH /produtos/{id} já existia no backend e não estava sendo usado em
// lugar nenhum). Passe `produto` pra abrir em modo edição.
//
// Etapa 25: preço de venda + margem (margem é só de exibição/edição no
// formulário — nunca enviada pro backend, que sempre recalcula a partir de
// custo_medio e preco_venda), categoria vinculada, marca, NCM, controla_lote
// e imagem (upload de arquivo pro Supabase Storage OU URL externa).

import { useState, FormEvent, useRef } from "react";
import { apiFetch, ApiError, obterAccessToken } from "@/lib/api";
import { Produto, ProdutoCreateInput, OpcaoFiltro } from "@/lib/types";
import { ImagePlus, Link as LinkIcon, X } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export function ProdutoForm({
  produto, categorias = [], onSalvo, onCancelar,
}: { produto?: Produto; categorias?: OpcaoFiltro[]; onSalvo: () => void; onCancelar?: () => void }) {
  const editando = !!produto;
  const [form, setForm] = useState<ProdutoCreateInput>(
    produto
      ? {
          nome: produto.nome, sku: produto.sku, categoria_id: produto.categoria_id,
          codigo_barras: produto.codigo_barras, unidade_medida: produto.unidade_medida,
          custo_medio: produto.custo_medio, preco_venda: produto.preco_venda,
          marca: produto.marca, ncm: produto.ncm, controla_lote: produto.controla_lote,
          estoque_minimo: produto.estoque_minimo, estoque_maximo: produto.estoque_maximo,
        }
      : { nome: "", unidade_medida: "un", custo_medio: 0, estoque_minimo: 0, controla_lote: false }
  );

  // Margem é derivada localmente só pra UX (editar um lado recalcula o
  // outro); a fonte de verdade continua sendo custo_medio/preco_venda no
  // backend, que recalcula margem em runtime a cada leitura.
  const margemInicial = calcularMargem(form.custo_medio ?? 0, form.preco_venda ?? null);
  const [margem, setMargem] = useState<string>(margemInicial !== null ? String(margemInicial) : "");

  const [modoImagem, setModoImagem] = useState<"upload" | "url">(produto?.imagem_url ? "url" : "upload");
  const [imagemUrl, setImagemUrl] = useState(produto?.imagem_url ?? "");
  const [arquivoImagem, setArquivoImagem] = useState<File | null>(null);
  const [previewImagem, setPreviewImagem] = useState<string | null>(produto?.imagem_url ?? null);
  const inputArquivoRef = useRef<HTMLInputElement>(null);

  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  function calcularMargem(custo: number, venda: number | null): number | null {
    if (!venda) return null;
    return Math.round(((venda - custo) / venda) * 100 * 100) / 100;
  }

  function aoMudarCustoOuVenda(campo: "custo_medio" | "preco_venda", valor: number) {
    const novoForm = { ...form, [campo]: valor };
    setForm(novoForm);
    const m = calcularMargem(novoForm.custo_medio ?? 0, novoForm.preco_venda ?? null);
    setMargem(m !== null ? String(m) : "");
  }

  function aoMudarMargem(valorMargem: string) {
    setMargem(valorMargem);
    const m = Number(valorMargem);
    const custo = form.custo_medio ?? 0;
    if (valorMargem === "" || Number.isNaN(m) || m >= 100) {
      return; // margem >= 100% implicaria preço de venda infinito/negativo — não recalcula
    }
    // margem = (venda - custo) / venda  =>  venda = custo / (1 - margem/100)
    const novoPrecoVenda = Math.round((custo / (1 - m / 100)) * 100) / 100;
    setForm({ ...form, preco_venda: novoPrecoVenda });
  }

  function aoEscolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setArquivoImagem(arquivo);
    setPreviewImagem(URL.createObjectURL(arquivo));
  }

  function removerImagem() {
    setArquivoImagem(null);
    setImagemUrl("");
    setPreviewImagem(null);
    if (inputArquivoRef.current) inputArquivoRef.current.value = "";
  }

  async function enviarImagemSeNecessario(produtoId: string) {
    if (modoImagem === "upload" && arquivoImagem) {
      // Upload multipart não passa pelo apiFetch (que sempre seta
      // Content-Type json) — mesmo padrão já usado no import de XML de NF-e.
      const formData = new FormData();
      formData.append("arquivo", arquivoImagem);
      const token = obterAccessToken();
      const resp = await fetch(`${API_URL}/produtos/${produtoId}/imagem`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        body: formData,
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.detail || "Não foi possível enviar a imagem.");
      }
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      // margem nunca vai no payload — é sempre recalculada pelo backend a
      // partir de custo_medio/preco_venda, pra nunca divergir.
      const payload: ProdutoCreateInput = { ...form };
      if (modoImagem === "url" && imagemUrl.trim()) {
        (payload as ProdutoCreateInput & { imagem_url?: string }).imagem_url = imagemUrl.trim();
      }

      let produtoId: string;
      if (editando) {
        const atualizado = await apiFetch<Produto>(`/produtos/${produto.id}`, {
          method: "PATCH", body: JSON.stringify(payload),
        });
        produtoId = atualizado.id;
      } else {
        const criado = await apiFetch<Produto>("/produtos", { method: "POST", body: JSON.stringify(payload) });
        produtoId = criado.id;
      }

      await enviarImagemSeNecessario(produtoId);
      onSalvo();
    } catch (err) {
      setErro(err instanceof ApiError || err instanceof Error ? err.message : "Não foi possível salvar o produto.");
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

      {/* Imagem do produto */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>Imagem do produto</span>
        <div className="flex items-center gap-3">
          <div
            className="w-16 h-16 rounded-lg border flex items-center justify-center shrink-0 overflow-hidden"
            style={{ borderColor: "var(--cor-borda)", background: "var(--cor-base)" }}
          >
            {previewImagem ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewImagem} alt="" className="w-full h-full object-cover" />
            ) : (
              <ImagePlus size={20} style={{ color: "var(--cor-texto-muted)" }} />
            )}
          </div>
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => { setModoImagem("upload"); inputArquivoRef.current?.click(); }}
                className="rounded-md px-2.5 py-1.5 text-xs font-semibold border flex items-center gap-1"
                style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
              >
                <ImagePlus size={12} /> Enviar arquivo
              </button>
              <button
                type="button"
                onClick={() => setModoImagem("url")}
                className="rounded-md px-2.5 py-1.5 text-xs font-semibold border flex items-center gap-1"
                style={{
                  borderColor: modoImagem === "url" ? "var(--cor-acento)" : "var(--cor-borda)",
                  color: modoImagem === "url" ? "var(--cor-acento)" : "var(--cor-texto)",
                }}
              >
                <LinkIcon size={12} /> URL
              </button>
              {previewImagem && (
                <button
                  type="button"
                  onClick={removerImagem}
                  title="Remover imagem"
                  className="rounded-md px-2 py-1.5 border"
                  style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <input
              ref={inputArquivoRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={aoEscolherArquivo}
              className="hidden"
            />
            {modoImagem === "url" && (
              <input
                type="url"
                placeholder="https://..."
                value={imagemUrl}
                onChange={(e) => { setImagemUrl(e.target.value); setPreviewImagem(e.target.value || null); }}
                className="rounded-md px-2.5 py-1.5 text-xs outline-none border font-normal"
                style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
              />
            )}
          </div>
        </div>
      </div>

      <Campo label="Nome" required value={form.nome} onChange={(v) => setForm({ ...form, nome: v })} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo label="SKU" value={form.sku ?? ""} onChange={(v) => setForm({ ...form, sku: v })} />
        <Campo label="Marca" value={form.marca ?? ""} onChange={(v) => setForm({ ...form, marca: v })} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          Categoria
          <select
            value={form.categoria_id ?? ""}
            onChange={(e) => setForm({ ...form, categoria_id: e.target.value || null })}
            className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          >
            <option value="">Sem categoria</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </label>
        <Campo label="Unidade" value={form.unidade_medida ?? "un"} onChange={(v) => setForm({ ...form, unidade_medida: v })} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo
          label="Código de barras"
          value={form.codigo_barras ?? ""}
          onChange={(v) => setForm({ ...form, codigo_barras: v })}
        />
        <Campo label="NCM" value={form.ncm ?? ""} onChange={(v) => setForm({ ...form, ncm: v })} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Campo
          label="Custo"
          type="number"
          value={String(form.custo_medio ?? 0)}
          onChange={(v) => aoMudarCustoOuVenda("custo_medio", Number(v))}
        />
        <Campo
          label="Preço de venda"
          type="number"
          value={form.preco_venda != null ? String(form.preco_venda) : ""}
          onChange={(v) => aoMudarCustoOuVenda("preco_venda", v === "" ? 0 : Number(v))}
        />
        <Campo
          label="Margem (%)"
          type="number"
          value={margem}
          onChange={aoMudarMargem}
        />
      </div>

      <Campo
        label="Estoque mínimo"
        type="number"
        value={String(form.estoque_minimo ?? 0)}
        onChange={(v) => setForm({ ...form, estoque_minimo: Number(v) })}
      />

      <div className="flex flex-col gap-0.5 pt-1">
        <label className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          <input
            type="checkbox"
            checked={form.controla_lote ?? false}
            onChange={(e) => setForm({ ...form, controla_lote: e.target.checked })}
          />
          Controla lote/validade
        </label>
        <span className="text-[10px] pl-5" style={{ color: "var(--cor-texto-muted)" }}>
          Rastreamento de lote ainda não disponível — em breve. Marcar aqui só reserva o produto pra quando a funcionalidade existir.
        </span>
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
