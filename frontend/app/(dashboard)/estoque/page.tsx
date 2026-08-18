"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { ItemEstoque, PainelEstoque, PrioridadeEstoque } from "@/lib/types";
import { ProdutoForm } from "@/components/produtos/ProdutoForm";
import {
  useToast, ConfirmDialog, QuickCreateDialog, TableSkeletonRows, Pagination, ThOrdenavel, TrHover,
  useSelecaoMultipla, BulkActionBar, RowMenu, useDebouncedValue, useKeyboardShortcuts,
} from "@/components/ui";
import {
  Search, RefreshCw, FileDown, Upload, Plus, ArrowDownToLine, ArrowUpFromLine,
  ArrowLeftRight, SlidersHorizontal, ClipboardList, Download,
} from "lucide-react";

const TAMANHO_PAGINA = 25;

const PRIORIDADE_INFO: Record<PrioridadeEstoque, { emoji: string; label: string; cor: string; bg: string }> = {
  sem_estoque: { emoji: "🔴", label: "Sem estoque", cor: "var(--cor-status-esgotado)", bg: "var(--cor-status-esgotado-bg)" },
  vencimento_proximo: { emoji: "🟠", label: "Vencimento próximo", cor: "var(--cor-status-vencimento)", bg: "var(--cor-status-vencimento-bg)" },
  abaixo_minimo: { emoji: "🟡", label: "Abaixo do mínimo", cor: "var(--cor-status-minimo)", bg: "var(--cor-status-minimo-bg)" },
  novo: { emoji: "🔵", label: "Novo", cor: "var(--cor-status-novo)", bg: "var(--cor-status-novo-bg)" },
  normal: { emoji: "🟢", label: "Normal", cor: "var(--cor-sucesso)", bg: "rgba(91,140,99,0.14)" },
};

export default function EstoquePage() {
  const router = useRouter();
  const { sucesso, erro: toastErro } = useToast();

  const [painel, setPainel] = useState<PainelEstoque | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebouncedValue(busca, 300);
  const [categoriaId, setCategoriaId] = useState("");
  const [depositoId, setDepositoId] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [somenteAbaixoMinimo, setSomenteAbaixoMinimo] = useState(false);
  const [somenteSemEstoque, setSomenteSemEstoque] = useState(false);
  const [somenteVencimentoProximo, setSomenteVencimentoProximo] = useState(false);
  const [pagina, setPagina] = useState(1);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [criarRapido, setCriarRapido] = useState<"categoria" | "deposito" | "fornecedor" | null>(null);
  const [salvandoCriarRapido, setSalvandoCriarRapido] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [produtoParaDesativar, setProdutoParaDesativar] = useState<ItemEstoque | null>(null);
  const [desativando, setDesativando] = useState(false);

  const buscaRef = useRef<HTMLInputElement>(null);

  const [ordenarPor, setOrdenarPor] = useState("nome");
  const [direcao, setDirecao] = useState<"asc" | "desc">("asc");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      if (buscaDebounced) params.set("busca", buscaDebounced);
      if (categoriaId) params.set("categoria_id", categoriaId);
      if (depositoId) params.set("deposito_id", depositoId);
      if (fornecedorId) params.set("fornecedor_id", fornecedorId);
      if (somenteAbaixoMinimo) params.set("somente_abaixo_minimo", "true");
      if (somenteSemEstoque) params.set("somente_sem_estoque", "true");
      if (somenteVencimentoProximo) params.set("somente_vencimento_proximo", "true");
      params.set("ordenar_por", ordenarPor);
      params.set("direcao", direcao);
      params.set("pagina", String(pagina));
      params.set("tamanho", String(TAMANHO_PAGINA));

      const dados = await apiFetch<PainelEstoque>(`/estoque/painel?${params.toString()}`);
      setPainel(dados);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível carregar o estoque.");
    } finally {
      setCarregando(false);
    }
  }, [buscaDebounced, categoriaId, depositoId, fornecedorId, somenteAbaixoMinimo, somenteSemEstoque, somenteVencimentoProximo, ordenarPor, direcao, pagina]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    setPagina(1);
  }, [buscaDebounced, categoriaId, depositoId, fornecedorId, somenteAbaixoMinimo, somenteSemEstoque, somenteVencimentoProximo]);

  const itens = painel?.itens ?? [];
  const selecao = useSelecaoMultipla(itens, (i) => i.produto_id);

  function alternarOrdenacao(campo: string) {
    if (ordenarPor !== campo) {
      setOrdenarPor(campo);
      setDirecao("asc");
    } else {
      setDirecao((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  const usaDepositos = (painel?.filtros.depositos.length ?? 0) > 0;

  function linhasParaCsv(lista: ItemEstoque[]): string {
    const cabecalho = ["Produto", "SKU", "Categoria", "Saldo", "Custo médio", "Valor total", "Mínimo", "Prioridade"];
    const linhas = lista.map((i) => [
      i.nome, i.sku ?? "", i.categoria_nome ?? "", String(i.saldo), i.custo_medio.toFixed(2),
      i.valor_total_custo.toFixed(2), String(i.estoque_minimo), PRIORIDADE_INFO[i.prioridade].label,
    ]);
    return [cabecalho, ...linhas]
      .map((linha) => linha.map((campo) => `"${campo.replace(/"/g, '""')}"`).join(","))
      .join("\n");
  }

  function baixarCsv(conteudo: string, nomeArquivo: string) {
    const blob = new Blob([`\uFEFF${conteudo}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportarTudo() {
    setExportando(true);
    try {
      const params = new URLSearchParams();
      if (buscaDebounced) params.set("busca", buscaDebounced);
      if (categoriaId) params.set("categoria_id", categoriaId);
      if (depositoId) params.set("deposito_id", depositoId);
      if (fornecedorId) params.set("fornecedor_id", fornecedorId);
      if (somenteAbaixoMinimo) params.set("somente_abaixo_minimo", "true");
      if (somenteSemEstoque) params.set("somente_sem_estoque", "true");
      if (somenteVencimentoProximo) params.set("somente_vencimento_proximo", "true");
      params.set("tamanho", "200");

      let todos: ItemEstoque[] = [];
      for (let p = 1; p <= 8; p++) {
        params.set("pagina", String(p));
        const dados = await apiFetch<PainelEstoque>(`/estoque/painel?${params.toString()}`);
        todos = todos.concat(dados.itens);
        if (todos.length >= dados.total) break;
      }
      baixarCsv(linhasParaCsv(todos), `estoque_${new Date().toISOString().slice(0, 10)}.csv`);
      sucesso(`${todos.length} produto${todos.length === 1 ? "" : "s"} exportado${todos.length === 1 ? "" : "s"}.`);
    } catch {
      toastErro("Não foi possível exportar o estoque.");
    } finally {
      setExportando(false);
    }
  }

  function exportarSelecionados() {
    if (selecao.itensSelecionados.length === 0) return;
    baixarCsv(linhasParaCsv(selecao.itensSelecionados), `estoque_selecao_${new Date().toISOString().slice(0, 10)}.csv`);
    sucesso(`${selecao.itensSelecionados.length} produto(s) exportado(s).`);
  }

  async function confirmarCriacaoRapida(nome: string, secundario: string) {
    if (!criarRapido) return;
    setSalvandoCriarRapido(true);
    try {
      if (criarRapido === "categoria") {
        const nova = await apiFetch<{ id: string }>("/categorias", { method: "POST", body: JSON.stringify({ nome }) });
        setCategoriaId(nova.id);
        sucesso(`Categoria "${nome}" criada.`);
      } else if (criarRapido === "deposito") {
        const novo = await apiFetch<{ id: string }>("/depositos", {
          method: "POST", body: JSON.stringify({ nome, endereco: secundario || undefined }),
        });
        setDepositoId(novo.id);
        sucesso(`Depósito "${nome}" criado.`);
      } else {
        const novo = await apiFetch<{ id: string }>("/fornecedores", {
          method: "POST", body: JSON.stringify({ nome, contato: secundario || undefined }),
        });
        setFornecedorId(novo.id);
        sucesso(`Fornecedor "${nome}" criado.`);
      }
      setCriarRapido(null);
    } catch (err) {
      toastErro(err instanceof ApiError ? err.message : "Não foi possível criar o cadastro.");
    } finally {
      setSalvandoCriarRapido(false);
    }
  }

  async function confirmarDesativacao() {
    if (!produtoParaDesativar) return;
    setDesativando(true);
    try {
      await apiFetch(`/produtos/${produtoParaDesativar.produto_id}`, { method: "DELETE" });
      sucesso(`"${produtoParaDesativar.nome}" foi desativado.`);
      setProdutoParaDesativar(null);
      await carregar();
    } catch (err) {
      toastErro(err instanceof ApiError ? err.message : "Não foi possível desativar o produto.");
    } finally {
      setDesativando(false);
    }
  }

  useKeyboardShortcuts({
    onFocusBusca: () => buscaRef.current?.focus(),
    onNovo: () => setMostrarForm(true),
    onEscape: () => {
      setMostrarForm(false);
      setProdutoParaDesativar(null);
      setCriarRapido(null);
    },
  });

  const kpis = painel?.kpis;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Estoque</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Visão consolidada do catálogo — para lançar movimentações, use os atalhos abaixo.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5 md:gap-3">
        <CartaoKpi titulo="Produtos cadastrados" valor={kpis ? String(kpis.produtos_cadastrados) : "—"} />
        <CartaoKpi titulo="Total de unidades" valor={kpis ? formatarNumero(kpis.total_unidades) : "—"} />
        <CartaoKpi titulo="Valor total a custo" valor={kpis ? formatarMoeda(kpis.valor_total_custo) : "—"} />
        <CartaoKpi
          titulo="Abaixo do mínimo" valor={kpis ? String(kpis.produtos_abaixo_minimo) : "—"}
          destaque={(kpis?.produtos_abaixo_minimo ?? 0) > 0 ? "var(--cor-status-minimo)" : undefined}
          ativo={somenteAbaixoMinimo}
          onClick={() => setSomenteAbaixoMinimo((v) => !v)}
        />
        <CartaoKpi
          titulo="Sem estoque" valor={kpis ? String(kpis.produtos_sem_estoque) : "—"}
          destaque={(kpis?.produtos_sem_estoque ?? 0) > 0 ? "var(--cor-alerta)" : undefined}
          ativo={somenteSemEstoque}
          onClick={() => setSomenteSemEstoque((v) => !v)}
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible">
        <AcaoRapida icon={<ArrowDownToLine size={14} />} label="Entrada" onClick={() => router.push("/movimentacao?tipo=entrada")} />
        <AcaoRapida icon={<ArrowUpFromLine size={14} />} label="Saída" onClick={() => router.push("/movimentacao?tipo=saida")} />
        <AcaoRapida icon={<ArrowLeftRight size={14} />} label="Transferência" onClick={() => router.push("/movimentacao?tipo=transferencia")} />
        <AcaoRapida icon={<SlidersHorizontal size={14} />} label="Ajuste" onClick={() => router.push("/movimentacao?tipo=ajuste")} />
        <AcaoRapida icon={<ClipboardList size={14} />} label="Inventário" onClick={() => router.push("/inventario")} />
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
            <SeletorFiltro
              label="Categoria" valor={categoriaId} onChange={setCategoriaId}
              opcoes={painel?.filtros.categorias ?? []} onCriarNovo={() => setCriarRapido("categoria")}
            />
            <SeletorFiltro
              label="Depósito" valor={depositoId} onChange={setDepositoId}
              opcoes={painel?.filtros.depositos ?? []} onCriarNovo={() => setCriarRapido("deposito")}
            />
            <SeletorFiltro
              label="Fornecedor" valor={fornecedorId} onChange={setFornecedorId}
              opcoes={painel?.filtros.fornecedores ?? []} onCriarNovo={() => setCriarRapido("fornecedor")}
            />

            <ChipFiltro
              label="Vencimento próximo"
              ativo={somenteVencimentoProximo}
              onClick={() => setSomenteVencimentoProximo((v) => !v)}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:overflow-visible md:flex-wrap">
          <button
            onClick={carregar}
            title="Atualizar"
            className="rounded-md p-2 border shrink-0"
            style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
          >
            <RefreshCw size={15} className={carregando ? "animate-spin" : ""} />
          </button>
          <button
            onClick={exportarTudo}
            disabled={exportando}
            className="flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold border disabled:opacity-60 shrink-0 whitespace-nowrap"
            style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          >
            <FileDown size={14} /> {exportando ? "Exportando..." : "Exportar Excel"}
          </button>
          <button
            onClick={() => toastErro("Importação de planilha ainda não está disponível nesta versão.")}
            className="flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold border shrink-0 whitespace-nowrap"
            style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          >
            <Upload size={14} /> Importar
          </button>
          <button
            onClick={() => setMostrarForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-bold shrink-0 whitespace-nowrap"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            <Plus size={15} /> Novo produto <span className="opacity-60 text-xs">(N)</span>
          </button>
        </div>
      </div>

      {mostrarForm && (
        <ProdutoForm
          onSalvo={() => {
            setMostrarForm(false);
            carregar();
          }}
          onCancelar={() => setMostrarForm(false)}
        />
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
          <div key={i} className="rounded-xl border p-3.5 h-28 animate-pulse" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }} />
        ))}
        {!carregando && itens.length === 0 && (
          <div className="rounded-xl border px-5 py-8 text-center text-sm" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}>
            {painel && painel.total === 0 && !buscaDebounced && !categoriaId && !depositoId && !fornecedorId
              ? "Nenhum produto cadastrado ainda."
              : "Nenhum produto encontrado com esses filtros."}
          </div>
        )}
        {!carregando && itens.map((item) => {
          const prio = PRIORIDADE_INFO[item.prioridade];
          return (
            <div
              key={item.produto_id}
              className="rounded-xl border p-3.5 flex flex-col gap-2.5"
              style={{
                background: "var(--cor-superficie)",
                borderColor: selecao.selecionados.has(item.produto_id) ? "var(--cor-acento)" : "var(--cor-borda)",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    className="mt-1 shrink-0"
                    checked={selecao.selecionados.has(item.produto_id)}
                    onChange={() => selecao.alternar(item.produto_id)}
                    aria-label={`Selecionar ${item.nome}`}
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{item.nome}</div>
                    <div className="text-xs truncate" style={{ color: "var(--cor-texto-muted)" }}>
                      {item.sku ?? "—"}{item.categoria_nome ? ` · ${item.categoria_nome}` : ""}
                    </div>
                  </div>
                </div>
                <RowMenu
                  itens={[
                    { label: "Ver histórico", onClick: () => router.push(`/movimentacao?produto_id=${item.produto_id}`) },
                    { label: "Registrar entrada", onClick: () => router.push(`/movimentacao?tipo=entrada&produto_id=${item.produto_id}`) },
                    { label: "Registrar saída", onClick: () => router.push(`/movimentacao?tipo=saida&produto_id=${item.produto_id}`) },
                    { label: "Desativar produto", perigoso: true, onClick: () => setProdutoParaDesativar(item) },
                  ]}
                />
              </div>

              <div className="flex items-center justify-between">
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full"
                  style={{ color: prio.cor, background: prio.bg }}
                >
                  {prio.emoji} {prio.label}
                </span>
                <span className="font-semibold text-sm">
                  {item.saldo} <span className="font-normal text-xs" style={{ color: "var(--cor-texto-muted)" }}>{item.unidade_medida}</span>
                </span>
              </div>

              <div className={`grid gap-2 pt-2 border-t text-xs ${usaDepositos ? "grid-cols-2" : "grid-cols-3"}`} style={{ borderColor: "var(--cor-borda)" }}>
                <div>
                  <div style={{ color: "var(--cor-texto-muted)" }}>Custo médio</div>
                  <div className="font-medium mt-0.5">{formatarMoeda(item.custo_medio)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--cor-texto-muted)" }}>Valor total</div>
                  <div className="font-medium mt-0.5">{formatarMoeda(item.valor_total_custo)}</div>
                </div>
                <div>
                  <div style={{ color: "var(--cor-texto-muted)" }}>Mínimo</div>
                  <div className="font-medium mt-0.5">{item.estoque_minimo}</div>
                </div>
                {usaDepositos && (
                  <div>
                    <div style={{ color: "var(--cor-texto-muted)" }}>Posição</div>
                    <div className="font-medium mt-0.5">
                      {item.posicoes.length === 0 ? "—" : item.posicoes.map((p) => `${p.deposito_nome} (${p.saldo})`).join(", ")}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
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
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Categoria</th>
              <ThOrdenavel label="Saldo" campo="saldo" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <ThOrdenavel label="Custo médio" campo="custo_medio" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <ThOrdenavel label="Valor total" campo="valor_total_custo" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <ThOrdenavel label="Mínimo" campo="estoque_minimo" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              {usaDepositos && (
                <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Posição</th>
              )}
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Prioridade</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {carregando && <TableSkeletonRows colunas={usaDepositos ? 9 : 8} linhas={8} />}
            {!carregando && itens.length === 0 && (
              <tr>
                <td colSpan={usaDepositos ? 9 : 8} className="px-5 py-8 text-center text-sm" style={{ color: "var(--cor-texto-muted)" }}>
                  {painel && painel.total === 0 && !buscaDebounced && !categoriaId && !depositoId && !fornecedorId
                    ? "Nenhum produto cadastrado ainda."
                    : "Nenhum produto encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {!carregando && itens.map((item) => {
              const prio = PRIORIDADE_INFO[item.prioridade];
              return (
                <TrHover key={item.produto_id} selecionada={selecao.selecionados.has(item.produto_id)}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selecao.selecionados.has(item.produto_id)}
                      onChange={() => selecao.alternar(item.produto_id)}
                      aria-label={`Selecionar ${item.nome}`}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{item.nome}</div>
                    {item.sku && <div className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>{item.sku}</div>}
                  </td>
                  <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{item.categoria_nome ?? "—"}</td>
                  <td className="px-3 py-3 font-semibold">{item.saldo} <span className="font-normal text-xs" style={{ color: "var(--cor-texto-muted)" }}>{item.unidade_medida}</span></td>
                  <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{formatarMoeda(item.custo_medio)}</td>
                  <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{formatarMoeda(item.valor_total_custo)}</td>
                  <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{item.estoque_minimo}</td>
                  {usaDepositos && (
                    <td className="px-3 py-3 text-xs" style={{ color: "var(--cor-texto-muted)" }}>
                      {item.posicoes.length === 0 ? "—" : item.posicoes.map((p) => `${p.deposito_nome} (${p.saldo})`).join(", ")}
                    </td>
                  )}
                  <td className="px-3 py-3">
                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full"
                      style={{ color: prio.cor, background: prio.bg }}
                      title={prio.label}
                    >
                      {prio.emoji} {prio.label}
                    </span>
                  </td>
                  <td className="px-2 py-3">
                    <RowMenu
                      itens={[
                        { label: "Ver histórico", onClick: () => router.push(`/movimentacao?produto_id=${item.produto_id}`) },
                        { label: "Registrar entrada", onClick: () => router.push(`/movimentacao?tipo=entrada&produto_id=${item.produto_id}`) },
                        { label: "Registrar saída", onClick: () => router.push(`/movimentacao?tipo=saida&produto_id=${item.produto_id}`) },
                        { label: "Desativar produto", perigoso: true, onClick: () => setProdutoParaDesativar(item) },
                      ]}
                    />
                  </td>
                </TrHover>
              );
            })}
          </tbody>
        </table>
        {painel && painel.total > 0 && (
          <Pagination pagina={pagina} tamanhoPagina={TAMANHO_PAGINA} total={painel.total} onPaginaChange={setPagina} />
        )}
      </div>

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
        aberto={criarRapido === "categoria"}
        titulo="Nova categoria"
        salvando={salvandoCriarRapido}
        onCriar={confirmarCriacaoRapida}
        onCancelar={() => setCriarRapido(null)}
      />
      <QuickCreateDialog
        aberto={criarRapido === "deposito"}
        titulo="Novo depósito"
        campoSecundario={{ label: "Endereço (opcional)" }}
        salvando={salvandoCriarRapido}
        onCriar={confirmarCriacaoRapida}
        onCancelar={() => setCriarRapido(null)}
      />
      <QuickCreateDialog
        aberto={criarRapido === "fornecedor"}
        titulo="Novo fornecedor"
        campoSecundario={{ label: "Contato (opcional)", placeholder: "Telefone ou e-mail" }}
        salvando={salvandoCriarRapido}
        onCriar={confirmarCriacaoRapida}
        onCancelar={() => setCriarRapido(null)}
      />
    </div>
  );
}

function CartaoKpi({
  titulo, valor, destaque, ativo, onClick,
}: { titulo: string; valor: string; destaque?: string; ativo?: boolean; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className="rounded-xl border p-4 text-left flex flex-col gap-1"
      style={{
        background: "var(--cor-superficie)",
        borderColor: ativo ? "var(--cor-acento)" : "var(--cor-borda)",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>{titulo}</span>
      <span className="text-xl font-display font-semibold" style={{ color: destaque ?? "var(--cor-texto)" }}>{valor}</span>
    </Tag>
  );
}

function AcaoRapida({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold border"
      style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
    >
      {icon} {label}
    </button>
  );
}

function ChipFiltro({ label, ativo, onClick }: { label: string; ativo: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-3 py-2 text-xs font-semibold border whitespace-nowrap"
      style={
        ativo
          ? { background: "rgba(16,185,129,0.14)", borderColor: "var(--cor-acento)", color: "var(--cor-acento)" }
          : { background: "var(--cor-superficie)", borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }
      }
    >
      {label}
    </button>
  );
}

function SeletorFiltro({
  label, valor, onChange, opcoes, onCriarNovo,
}: { label: string; valor: string; onChange: (v: string) => void; opcoes: { id: string; nome: string }[]; onCriarNovo?: () => void }) {
  if (opcoes.length === 0 && !onCriarNovo) return null;
  return (
    <div className="flex items-center gap-1">
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md px-2.5 py-2 text-xs font-semibold border outline-none"
        style={{
          background: valor ? "rgba(16,185,129,0.14)" : "var(--cor-superficie)",
          borderColor: valor ? "var(--cor-acento)" : "var(--cor-borda)",
          color: valor ? "var(--cor-acento)" : "var(--cor-texto-muted)",
        }}
      >
        <option value="">{label}</option>
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>{o.nome}</option>
        ))}
      </select>
      {onCriarNovo && (
        <button
          onClick={onCriarNovo}
          title={`Novo(a) ${label.toLowerCase()}`}
          className="rounded-md p-2 border"
          style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
        >
          <Plus size={13} />
        </button>
      )}
    </div>
  );
}

function formatarMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarNumero(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}
