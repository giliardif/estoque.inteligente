"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { ItemProdutoLista, PainelProdutos } from "@/lib/types";
import { ProdutoForm } from "@/components/produtos/ProdutoForm";
import {
  useToast, ConfirmDialog, QuickCreateDialog, TableSkeletonRows, Pagination, ThOrdenavel, TrHover,
  useSelecaoMultipla, BulkActionBar, RowMenu, useDebouncedValue, useKeyboardShortcuts,
} from "@/components/ui";
import { Search, Plus, Download, Pencil } from "lucide-react";

const TAMANHO_PAGINA = 25;

export default function ProdutosPage() {
  const { sucesso, erro: toastErro } = useToast();

  const [painel, setPainel] = useState<PainelProdutos | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebouncedValue(busca, 300);
  const [categoriaId, setCategoriaId] = useState("");
  const [somenteInativos, setSomenteInativos] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [ordenarPor, setOrdenarPor] = useState("nome");
  const [direcao, setDirecao] = useState<"asc" | "desc">("asc");

  const [mostrarForm, setMostrarForm] = useState(false);
  const [produtoEditando, setProdutoEditando] = useState<ItemProdutoLista | null>(null);
  const [produtoParaDesativar, setProdutoParaDesativar] = useState<ItemProdutoLista | null>(null);
  const [desativando, setDesativando] = useState(false);
  const [criarCategoria, setCriarCategoria] = useState(false);
  const [salvandoCategoria, setSalvandoCategoria] = useState(false);

  const buscaRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      if (buscaDebounced) params.set("busca", buscaDebounced);
      if (categoriaId) params.set("categoria_id", categoriaId);
      if (somenteInativos) params.set("status", "inativo");
      params.set("ordenar_por", ordenarPor);
      params.set("direcao", direcao);
      params.set("pagina", String(pagina));
      params.set("tamanho", String(TAMANHO_PAGINA));

      const dados = await apiFetch<PainelProdutos>(`/produtos/painel?${params.toString()}`);
      setPainel(dados);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível carregar os produtos.");
    } finally {
      setCarregando(false);
    }
  }, [buscaDebounced, categoriaId, somenteInativos, ordenarPor, direcao, pagina]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    setPagina(1);
  }, [buscaDebounced, categoriaId, somenteInativos]);

  const itens = painel?.itens ?? [];
  const selecao = useSelecaoMultipla(itens);

  function alternarOrdenacao(campo: string) {
    if (ordenarPor !== campo) {
      setOrdenarPor(campo);
      setDirecao("asc");
    } else {
      setDirecao((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  function linhasParaCsv(lista: ItemProdutoLista[]): string {
    const cabecalho = ["Produto", "SKU", "Categoria", "Código de barras", "Unidade", "Custo médio", "Mínimo", "Status"];
    const linhas = lista.map((i) => [
      i.nome, i.sku ?? "", i.categoria_nome ?? "", i.codigo_barras ?? "", i.unidade_medida,
      i.custo_medio.toFixed(2), String(i.estoque_minimo), i.ativo ? "Ativo" : "Inativo",
    ]);
    return [cabecalho, ...linhas]
      .map((linha) => linha.map((campo) => `"${campo.replace(/"/g, '""')}"`).join(","))
      .join("\n");
  }

  function exportarSelecionados() {
    if (selecao.itensSelecionados.length === 0) return;
    const blob = new Blob([`\uFEFF${linhasParaCsv(selecao.itensSelecionados)}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `produtos_selecao_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    sucesso(`${selecao.itensSelecionados.length} produto(s) exportado(s).`);
  }

  async function confirmarDesativacao() {
    if (!produtoParaDesativar) return;
    setDesativando(true);
    try {
      await apiFetch(`/produtos/${produtoParaDesativar.id}`, { method: "DELETE" });
      sucesso(`"${produtoParaDesativar.nome}" foi desativado.`);
      setProdutoParaDesativar(null);
      await carregar();
    } catch (err) {
      toastErro(err instanceof ApiError ? err.message : "Não foi possível desativar o produto.");
    } finally {
      setDesativando(false);
    }
  }

  async function confirmarCriacaoCategoria(nome: string) {
    setSalvandoCategoria(true);
    try {
      const nova = await apiFetch<{ id: string }>("/categorias", { method: "POST", body: JSON.stringify({ nome }) });
      setCategoriaId(nova.id);
      sucesso(`Categoria "${nome}" criada.`);
      setCriarCategoria(false);
    } catch (err) {
      toastErro(err instanceof ApiError ? err.message : "Não foi possível criar a categoria.");
    } finally {
      setSalvandoCategoria(false);
    }
  }

  useKeyboardShortcuts({
    onFocusBusca: () => buscaRef.current?.focus(),
    onNovo: () => setMostrarForm(true),
    onEscape: () => {
      setMostrarForm(false);
      setProdutoEditando(null);
      setProdutoParaDesativar(null);
      setCriarCategoria(false);
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Produtos</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Cadastro e situação de cada item
        </p>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3 md:flex-wrap">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:flex-wrap md:flex-1 md:min-w-[280px]">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 w-full md:w-72"
            style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
            <Search size={15} style={{ color: "var(--cor-texto-muted)" }} />
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, SKU ou código de barras  (/)"
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:contents">
            <div className="flex items-center gap-1 shrink-0">
              <select
                value={categoriaId}
                onChange={(e) => setCategoriaId(e.target.value)}
                className="rounded-md px-2.5 py-2 text-xs font-semibold border outline-none"
                style={{
                  background: categoriaId ? "rgba(16,185,129,0.14)" : "var(--cor-superficie)",
                  borderColor: categoriaId ? "var(--cor-acento)" : "var(--cor-borda)",
                  color: categoriaId ? "var(--cor-acento)" : "var(--cor-texto-muted)",
                }}
              >
                <option value="">Categoria</option>
                {(painel?.filtros.categorias ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
              <button
                onClick={() => setCriarCategoria(true)}
                title="Nova categoria"
                className="rounded-md p-2 border"
                style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
              >
                <Plus size={13} />
              </button>
            </div>

            <button
              onClick={() => setSomenteInativos((v) => !v)}
              className="rounded-md px-3 py-2 text-xs font-semibold border whitespace-nowrap shrink-0"
              style={
                somenteInativos
                  ? { background: "rgba(16,185,129,0.14)", borderColor: "var(--cor-acento)", color: "var(--cor-acento)" }
                  : { background: "var(--cor-superficie)", borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }
              }
            >
              Mostrar inativos
            </button>
          </div>
        </div>

        <button
          onClick={() => setMostrarForm((v) => !v)}
          className="flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2.5 md:py-2 text-sm font-bold"
          style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
        >
          <Plus size={15} /> Novo produto <span className="opacity-60 text-xs hidden md:inline">(N)</span>
        </button>
      </div>

      {mostrarForm && (
        <ProdutoForm onSalvo={() => { setMostrarForm(false); carregar(); }} onCancelar={() => setMostrarForm(false)} />
      )}

      {erro && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
          {erro}
        </div>
      )}

      <BulkActionBar
        quantidade={selecao.itensSelecionados.length}
        onLimpar={selecao.limpar}
        acoes={[{ label: "Exportar selecionados", icon: <Download size={13} />, onClick: exportarSelecionados }]}
      />

      {/* Lista de cards — mobile apenas. Mesmos dados e ações da tabela abaixo. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {carregando && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-3.5 h-24 animate-pulse" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }} />
        ))}
        {!carregando && itens.length === 0 && (
          <div className="rounded-xl border px-5 py-8 text-center text-sm" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}>
            {painel && painel.total === 0 && !buscaDebounced && !categoriaId && !somenteInativos
              ? "Nenhum produto cadastrado ainda."
              : "Nenhum produto encontrado com esses filtros."}
          </div>
        )}
        {!carregando && itens.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border p-3.5 flex flex-col gap-2.5"
            style={{
              background: "var(--cor-superficie)",
              borderColor: selecao.selecionados.has(p.id) ? "var(--cor-acento)" : "var(--cor-borda)",
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5 min-w-0">
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  checked={selecao.selecionados.has(p.id)}
                  onChange={() => selecao.alternar(p.id)}
                  aria-label={`Selecionar ${p.nome}`}
                />
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{p.nome}</div>
                  <div className="text-xs truncate" style={{ color: "var(--cor-texto-muted)" }}>
                    {p.sku ?? "—"}{p.categoria_nome ? ` · ${p.categoria_nome}` : ""}
                  </div>
                </div>
              </div>
              <RowMenu
                itens={[
                  { label: "Editar", icon: <Pencil size={13} />, onClick: () => setProdutoEditando(p) },
                  ...(p.ativo
                    ? [{ label: "Desativar produto", perigoso: true, onClick: () => setProdutoParaDesativar(p) }]
                    : []),
                ]}
              />
            </div>

            <div className="flex items-center justify-between">
              <span
                className="text-xs font-semibold px-2 py-1 rounded-full"
                style={
                  p.ativo
                    ? { color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }
                    : { color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }
                }
              >
                {p.ativo ? "Ativo" : "Inativo"}
              </span>
              <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>{p.unidade_medida}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs" style={{ borderColor: "var(--cor-borda)" }}>
              <div>
                <div style={{ color: "var(--cor-texto-muted)" }}>Custo médio</div>
                <div className="font-medium mt-0.5">R$ {p.custo_medio.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ color: "var(--cor-texto-muted)" }}>Mínimo</div>
                <div className="font-medium mt-0.5">{p.estoque_minimo}</div>
              </div>
              <div>
                <div style={{ color: "var(--cor-texto-muted)" }}>Código</div>
                <div className="font-medium mt-0.5 truncate">{p.codigo_barras ?? "—"}</div>
              </div>
            </div>
          </div>
        ))}
        {painel && painel.total > 0 && (
          <div className="rounded-xl border" style={{ borderColor: "var(--cor-borda)" }}>
            <Pagination pagina={pagina} tamanhoPagina={TAMANHO_PAGINA} total={painel.total} onPaginaChange={setPagina} />
          </div>
        )}
      </div>

      {/* Tabela — desktop apenas */}
      <div className="hidden md:block rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--cor-borda)" }}>
              <th className="px-4 py-3 w-8">
                <input type="checkbox" checked={selecao.todosSelecionados} onChange={selecao.alternarTodos} aria-label="Selecionar todos" />
              </th>
              <ThOrdenavel label="Produto" campo="nome" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <ThOrdenavel label="SKU" campo="sku" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Categoria</th>
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Código</th>
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Unidade</th>
              <ThOrdenavel label="Custo médio" campo="custo_medio" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <ThOrdenavel label="Mínimo" campo="estoque_minimo" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Status</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {carregando && <TableSkeletonRows colunas={10} linhas={8} />}
            {!carregando && itens.length === 0 && (
              <tr>
                <td colSpan={10} className="px-5 py-8 text-center text-sm" style={{ color: "var(--cor-texto-muted)" }}>
                  {painel && painel.total === 0 && !buscaDebounced && !categoriaId && !somenteInativos
                    ? "Nenhum produto cadastrado ainda."
                    : "Nenhum produto encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {!carregando && itens.map((p) => (
              <TrHover key={p.id} selecionada={selecao.selecionados.has(p.id)}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selecao.selecionados.has(p.id)}
                    onChange={() => selecao.alternar(p.id)}
                    aria-label={`Selecionar ${p.nome}`}
                  />
                </td>
                <td className="px-3 py-3 font-medium">{p.nome}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{p.sku ?? "—"}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{p.categoria_nome ?? "—"}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{p.codigo_barras ?? "—"}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{p.unidade_medida}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>R$ {p.custo_medio.toFixed(2)}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{p.estoque_minimo}</td>
                <td className="px-3 py-3">
                  <span
                    className="text-xs font-semibold px-2 py-1 rounded-full"
                    style={
                      p.ativo
                        ? { color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }
                        : { color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }
                    }
                  >
                    {p.ativo ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-2 py-3">
                  <RowMenu
                    itens={[
                      { label: "Editar", icon: <Pencil size={13} />, onClick: () => setProdutoEditando(p) },
                      ...(p.ativo
                        ? [{ label: "Desativar produto", perigoso: true, onClick: () => setProdutoParaDesativar(p) }]
                        : []),
                    ]}
                  />
                </td>
              </TrHover>
            ))}
          </tbody>
        </table>
        {painel && painel.total > 0 && (
          <Pagination pagina={pagina} tamanhoPagina={TAMANHO_PAGINA} total={painel.total} onPaginaChange={setPagina} />
        )}
      </div>

      {produtoEditando && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 py-6 overflow-y-auto" style={{ background: "rgba(10,8,6,0.55)" }} onClick={() => setProdutoEditando(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md max-h-full overflow-y-auto">
            <ProdutoForm
              produto={{
                id: produtoEditando.id, tenant_id: "", nome: produtoEditando.nome, sku: produtoEditando.sku,
                categoria_id: produtoEditando.categoria_id, codigo_barras: produtoEditando.codigo_barras,
                unidade_medida: produtoEditando.unidade_medida, custo_medio: produtoEditando.custo_medio,
                estoque_minimo: produtoEditando.estoque_minimo, estoque_maximo: produtoEditando.estoque_maximo,
                campos_customizados: {}, ativo: produtoEditando.ativo, criado_em: produtoEditando.criado_em,
              }}
              onSalvo={() => { setProdutoEditando(null); sucesso(`"${produtoEditando.nome}" atualizado.`); carregar(); }}
              onCancelar={() => setProdutoEditando(null)}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        aberto={produtoParaDesativar !== null}
        titulo={`Desativar "${produtoParaDesativar?.nome}"?`}
        descricao="O produto sai das listagens ativas, mas o histórico de movimentações é mantido."
        labelConfirmar="Desativar"
        perigoso
        confirmando={desativando}
        onConfirmar={confirmarDesativacao}
        onCancelar={() => setProdutoParaDesativar(null)}
      />

      <QuickCreateDialog
        aberto={criarCategoria}
        titulo="Nova categoria"
        salvando={salvandoCategoria}
        onCriar={confirmarCriacaoCategoria}
        onCancelar={() => setCriarCategoria(false)}
      />
    </div>
  );
}
