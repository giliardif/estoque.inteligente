"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { Produto, PainelVendas, ItemVendaLista, StatusVenda } from "@/lib/types";
import {
  useToast, ConfirmDialog, TableSkeletonRows, Pagination, ThOrdenavel, TrHover,
  useSelecaoMultipla, BulkActionBar, RowMenu, useDebouncedValue, useKeyboardShortcuts,
} from "@/components/ui";
import { ScannerCodigo } from "@/components/scanner/ScannerCodigo";
import { useLeitorFisico } from "@/lib/useLeitorFisico";
import { Minus, Plus, ScanBarcode, Trash2, Eye, Ban, Download, Search } from "lucide-react";

type ItemCarrinho = { produto_id: string; nome: string; quantidade: number; preco_unitario: number };

const TAMANHO_PAGINA = 25;

const STATUS_INFO: Record<StatusVenda, { label: string; cor: string; bg: string }> = {
  finalizada: { label: "Finalizada", cor: "var(--cor-sucesso)", bg: "rgba(91,140,99,0.14)" },
  cancelada: { label: "Cancelada", cor: "var(--cor-alerta)", bg: "rgba(162,59,59,0.14)" },
};

export default function VendasPage() {
  const { sucesso, erro: toastErro } = useToast();

  // --- PDV / carrinho -------------------------------------------------------
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [finalizando, setFinalizando] = useState(false);
  const [scannerAberto, setScannerAberto] = useState(false);
  const buscaProdutoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch<Produto[]>("/produtos").then(setProdutos).catch(() => {});
  }, []);

  const total = carrinho.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0);

  function adicionarAoCarrinho(produto: Produto) {
    setCarrinho((atual) => {
      const existente = atual.find((i) => i.produto_id === produto.id);
      if (existente) {
        return atual.map((i) => i.produto_id === produto.id ? { ...i, quantidade: i.quantidade + 1 } : i);
      }
      return [...atual, { produto_id: produto.id, nome: produto.nome, quantidade: 1, preco_unitario: produto.custo_medio || 1 }];
    });
  }

  function alterarQtd(produtoId: string, delta: number) {
    setCarrinho((atual) =>
      atual.map((i) => i.produto_id === produtoId ? { ...i, quantidade: Math.max(1, i.quantidade + delta) } : i)
    );
  }

  function remover(produtoId: string) {
    setCarrinho((atual) => atual.filter((i) => i.produto_id !== produtoId));
  }

  // --- Scanner ----------------------------------------------------------
  // Leitor físico (HID) funciona no mesmo campo de busca, sem UI extra: o
  // hook detecta o padrão de digitação rápida + Enter e resolve pro
  // produto certo, sem interferir na digitação humana normal (filtro por
  // nome continua igual). A câmera usa o modal ScannerCodigo à parte.
  const buscarEAdicionarPorCodigo = useCallback(async (codigo: string) => {
    try {
      const produto = await apiFetch<Produto>(`/produtos/buscar-codigo?codigo=${encodeURIComponent(codigo)}`);
      adicionarAoCarrinho(produto);
      setBuscaProduto("");
      sucesso(`${produto.nome} adicionado ao carrinho.`);
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 404
        ? "Nenhum produto encontrado para esse código."
        : "Não foi possível buscar o produto.";
      toastErro(msg);
    }
  }, [sucesso, toastErro]);

  useLeitorFisico(buscarEAdicionarPorCodigo);

  async function finalizarVenda() {
    setErro(null);
    setFinalizando(true);
    try {
      await apiFetch("/vendas", {
        method: "POST",
        body: JSON.stringify({
          itens: carrinho.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco_unitario: i.preco_unitario })),
        }),
      });
      sucesso("Venda finalizada — estoque baixado automaticamente.");
      setCarrinho([]);
      carregarPainel();
    } catch (err) {
      // Ex: "Saldo insuficiente para X" — mensagem já vem pronta do backend
      setErro(err instanceof ApiError ? err.message : "Não foi possível finalizar a venda.");
    } finally {
      setFinalizando(false);
    }
  }

  const produtosFiltrados = produtos.filter((p) => p.nome.toLowerCase().includes(buscaProduto.toLowerCase()));

  // --- Histórico / painel (kit de UX) ---------------------------------------
  const [painel, setPainel] = useState<PainelVendas | null>(null);
  const [carregandoPainel, setCarregandoPainel] = useState(true);
  const [erroPainel, setErroPainel] = useState<string | null>(null);

  const [buscaHistorico, setBuscaHistorico] = useState("");
  const buscaHistoricoDebounced = useDebouncedValue(buscaHistorico, 300);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<"" | StatusVenda>("");
  const [pagina, setPagina] = useState(1);
  const [ordenarPor, setOrdenarPor] = useState("criado_em");
  const [direcao, setDirecao] = useState<"asc" | "desc">("desc");

  const [vendaDetalhes, setVendaDetalhes] = useState<ItemVendaLista | null>(null);
  const [itensDetalhes, setItensDetalhes] = useState<{ produto_id: string; quantidade: number; preco_unitario: number }[] | null>(null);
  const [carregandoDetalhes, setCarregandoDetalhes] = useState(false);
  const [vendaParaCancelar, setVendaParaCancelar] = useState<ItemVendaLista | null>(null);
  const [cancelando, setCancelando] = useState(false);

  const carregarPainel = useCallback(async () => {
    setCarregandoPainel(true);
    setErroPainel(null);
    try {
      const params = new URLSearchParams();
      if (buscaHistoricoDebounced) params.set("busca", buscaHistoricoDebounced);
      if (dataInicio) params.set("data_inicio", dataInicio);
      if (dataFim) params.set("data_fim", dataFim);
      if (statusFiltro) params.set("status", statusFiltro);
      params.set("ordenar_por", ordenarPor);
      params.set("direcao", direcao);
      params.set("pagina", String(pagina));
      params.set("tamanho", String(TAMANHO_PAGINA));

      const dados = await apiFetch<PainelVendas>(`/vendas/painel?${params.toString()}`);
      setPainel(dados);
    } catch (err) {
      setErroPainel(err instanceof ApiError ? err.message : "Não foi possível carregar o histórico de vendas.");
    } finally {
      setCarregandoPainel(false);
    }
  }, [buscaHistoricoDebounced, dataInicio, dataFim, statusFiltro, ordenarPor, direcao, pagina]);

  useEffect(() => {
    carregarPainel();
  }, [carregarPainel]);

  useEffect(() => {
    setPagina(1);
  }, [buscaHistoricoDebounced, dataInicio, dataFim, statusFiltro]);

  const itensHistorico = painel?.itens ?? [];
  const selecao = useSelecaoMultipla(itensHistorico);
  const kpis = painel?.kpis;

  function alternarOrdenacao(campo: string) {
    if (ordenarPor !== campo) {
      setOrdenarPor(campo);
      setDirecao("desc");
    } else {
      setDirecao((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  function nomeProduto(produtoId: string): string {
    return produtos.find((p) => p.id === produtoId)?.nome ?? produtoId;
  }

  async function abrirDetalhes(venda: ItemVendaLista) {
    setVendaDetalhes(venda);
    setItensDetalhes(null);
    setCarregandoDetalhes(true);
    try {
      const completa = await apiFetch<{ itens: { produto_id: string; quantidade: number; preco_unitario: number }[] }>(`/vendas/${venda.id}`);
      setItensDetalhes(completa.itens);
    } catch (err) {
      toastErro(err instanceof ApiError ? err.message : "Não foi possível carregar os itens da venda.");
      setVendaDetalhes(null);
    } finally {
      setCarregandoDetalhes(false);
    }
  }

  async function confirmarCancelamento() {
    if (!vendaParaCancelar) return;
    setCancelando(true);
    try {
      await apiFetch(`/vendas/${vendaParaCancelar.id}/cancelar`, { method: "POST" });
      sucesso("Venda cancelada — estoque estornado automaticamente.");
      setVendaParaCancelar(null);
      await carregarPainel();
    } catch (err) {
      toastErro(err instanceof ApiError ? err.message : "Não foi possível cancelar a venda.");
    } finally {
      setCancelando(false);
    }
  }

  function linhasParaCsv(lista: ItemVendaLista[]): string {
    const cabecalho = ["Data/Hora", "Status", "Itens", "Valor total"];
    const linhas = lista.map((v) => [
      new Date(v.criado_em).toLocaleString("pt-BR"), STATUS_INFO[v.status].label, String(v.qtd_itens), v.valor_total.toFixed(2),
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
    link.download = `vendas_selecao_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    sucesso(`${selecao.itensSelecionados.length} venda(s) exportada(s).`);
  }

  useKeyboardShortcuts({
    onFocusBusca: () => buscaProdutoRef.current?.focus(),
    onEscape: () => {
      setVendaDetalhes(null);
      setVendaParaCancelar(null);
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Vendas / PDV</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Baixa automática de estoque na venda
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 items-start md:grid-cols-2">
        <div className="rounded-xl border p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 flex-1" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-base)" }}>
              <ScanBarcode size={15} style={{ color: "var(--cor-acento)" }} />
              <input
                ref={buscaProdutoRef}
                value={buscaProduto}
                onChange={(e) => setBuscaProduto(e.target.value)}
                placeholder="Buscar produto por nome  (/)"
                className="bg-transparent outline-none text-sm w-full"
              />
            </div>
            <button
              onClick={() => setScannerAberto(true)}
              className="flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold shrink-0"
              style={{ background: "var(--cor-acento)", color: "#06231a" }}
            >
              <ScanBarcode size={14} /> Escanear
            </button>
          </div>
          <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
            {produtosFiltrados.map((p) => (
              <button
                key={p.id}
                onClick={() => adicionarAoCarrinho(p)}
                className="flex items-center justify-between px-3 py-2 rounded-md text-sm text-left hover:bg-white/5"
              >
                <span>{p.nome}</span>
                <span style={{ color: "var(--cor-texto-muted)" }}>R$ {p.custo_medio.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border p-5 flex flex-col gap-3" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <h3 className="font-display font-semibold text-sm">Carrinho</h3>

          {erro && (
            <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
              {erro}
            </div>
          )}

          {carrinho.length === 0 && (
            <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>Nenhum item ainda — clique em um produto ao lado.</p>
          )}

          <div className="flex flex-col gap-2">
            {carrinho.map((i) => (
              <div key={i.produto_id} className="flex items-center gap-3 text-sm border-b pb-2" style={{ borderColor: "var(--cor-borda)" }}>
                <span className="flex-1 truncate">{i.nome}</span>
                <div className="flex items-center gap-2 rounded-md border px-2 py-1 shrink-0" style={{ borderColor: "var(--cor-borda)" }}>
                  <button onClick={() => alterarQtd(i.produto_id, -1)}><Minus size={13} /></button>
                  <span>{i.quantidade}</span>
                  <button onClick={() => alterarQtd(i.produto_id, 1)}><Plus size={13} /></button>
                </div>
                <span className="font-semibold w-16 text-right shrink-0">R$ {(i.quantidade * i.preco_unitario).toFixed(2)}</span>
                <button onClick={() => remover(i.produto_id)} className="shrink-0" style={{ color: "var(--cor-texto-muted)" }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center pt-2 text-lg font-bold">
            <span className="text-sm font-normal" style={{ color: "var(--cor-texto-muted)" }}>Total</span>
            <span>R$ {total.toFixed(2)}</span>
          </div>

          <button
            onClick={finalizarVenda}
            disabled={carrinho.length === 0 || finalizando}
            className="rounded-md py-2.5 font-bold text-sm disabled:opacity-60"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            {finalizando ? "Finalizando..." : "Finalizar venda"}
          </button>
        </div>
      </div>

      {/* --- Histórico de vendas (kit de UX) --- */}

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        <CartaoKpi titulo="Vendas hoje" valor={kpis ? String(kpis.vendas_hoje) : "—"} />
        <CartaoKpi titulo="Faturamento hoje" valor={kpis ? formatarMoeda(kpis.faturamento_hoje) : "—"} />
        <CartaoKpi titulo="Ticket médio hoje" valor={kpis ? formatarMoeda(kpis.ticket_medio_hoje) : "—"} />
        <CartaoKpi
          titulo="Canceladas (total)" valor={kpis ? String(kpis.vendas_canceladas_total) : "—"}
          destaque={(kpis?.vendas_canceladas_total ?? 0) > 0 ? "var(--cor-alerta)" : undefined}
          ativo={statusFiltro === "cancelada"}
          onClick={() => setStatusFiltro((s) => (s === "cancelada" ? "" : "cancelada"))}
        />
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3 md:flex-wrap">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:flex-wrap md:flex-1 md:min-w-[280px]">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 w-full md:w-64"
            style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
            <Search size={15} style={{ color: "var(--cor-texto-muted)" }} />
            <input
              value={buscaHistorico}
              onChange={(e) => setBuscaHistorico(e.target.value)}
              placeholder="Buscar por produto ou SKU"
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:contents">
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="rounded-md px-2.5 py-2 text-xs border outline-none shrink-0"
              style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
            />
            <span className="text-xs shrink-0" style={{ color: "var(--cor-texto-muted)" }}>até</span>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              className="rounded-md px-2.5 py-2 text-xs border outline-none shrink-0"
              style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
            />

            <select
              value={statusFiltro}
              onChange={(e) => setStatusFiltro(e.target.value as "" | StatusVenda)}
              className="rounded-md px-2.5 py-2 text-xs font-semibold border outline-none shrink-0"
              style={{
                background: statusFiltro ? "rgba(16,185,129,0.14)" : "var(--cor-superficie)",
                borderColor: statusFiltro ? "var(--cor-acento)" : "var(--cor-borda)",
                color: statusFiltro ? "var(--cor-acento)" : "var(--cor-texto-muted)",
              }}
            >
              <option value="">Todos os status</option>
              <option value="finalizada">Finalizada</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </div>
        </div>
      </div>

      {erroPainel && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
          {erroPainel}
        </div>
      )}

      <BulkActionBar
        quantidade={selecao.itensSelecionados.length}
        onLimpar={selecao.limpar}
        acoes={[{ label: "Exportar selecionadas", icon: <Download size={13} />, onClick: exportarSelecionados }]}
      />

      {/* Lista de cards — mobile apenas. Mesmos dados e ações da tabela abaixo. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {carregandoPainel && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-3.5 h-20 animate-pulse" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }} />
        ))}
        {!carregandoPainel && itensHistorico.length === 0 && (
          <div className="rounded-xl border px-5 py-8 text-center text-sm" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}>
            {painel && painel.total === 0 && !buscaHistoricoDebounced && !dataInicio && !dataFim && !statusFiltro
              ? "Nenhuma venda registrada ainda."
              : "Nenhuma venda encontrada com esses filtros."}
          </div>
        )}
        {!carregandoPainel && itensHistorico.map((v) => (
          <div
            key={v.id}
            onClick={() => abrirDetalhes(v)}
            className="rounded-xl border p-3.5 flex flex-col gap-2.5"
            style={{
              background: "var(--cor-superficie)",
              borderColor: selecao.selecionados.has(v.id) ? "var(--cor-acento)" : "var(--cor-borda)",
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5 min-w-0">
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  checked={selecao.selecionados.has(v.id)}
                  onChange={() => selecao.alternar(v.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Selecionar venda de ${new Date(v.criado_em).toLocaleString("pt-BR")}`}
                />
                <div className="min-w-0">
                  <div className="font-medium text-sm">{new Date(v.criado_em).toLocaleString("pt-BR")}</div>
                  <div className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>{v.qtd_itens} item(ns)</div>
                </div>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <RowMenu
                  itens={[
                    { label: "Ver detalhes", icon: <Eye size={13} />, onClick: () => abrirDetalhes(v) },
                    ...(v.status === "finalizada"
                      ? [{ label: "Cancelar venda", icon: <Ban size={13} />, perigoso: true, onClick: () => setVendaParaCancelar(v) }]
                      : []),
                  ]}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span
                className="text-xs font-semibold px-2 py-1 rounded-full"
                style={{ color: STATUS_INFO[v.status].cor, background: STATUS_INFO[v.status].bg }}
              >
                {STATUS_INFO[v.status].label}
              </span>
              <span className="font-semibold text-sm">{formatarMoeda(v.valor_total)}</span>
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
                <input type="checkbox" checked={selecao.todosSelecionados} onChange={selecao.alternarTodos} aria-label="Selecionar todas" />
              </th>
              <ThOrdenavel label="Data/Hora" campo="criado_em" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Itens</th>
              <ThOrdenavel label="Valor total" campo="valor_total" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Status</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {carregandoPainel && <TableSkeletonRows colunas={6} linhas={6} />}
            {!carregandoPainel && itensHistorico.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm" style={{ color: "var(--cor-texto-muted)" }}>
                  {painel && painel.total === 0 && !buscaHistoricoDebounced && !dataInicio && !dataFim && !statusFiltro
                    ? "Nenhuma venda registrada ainda."
                    : "Nenhuma venda encontrada com esses filtros."}
                </td>
              </tr>
            )}
            {!carregandoPainel && itensHistorico.map((v) => (
              <TrHover key={v.id} selecionada={selecao.selecionados.has(v.id)} onClick={() => abrirDetalhes(v)}>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selecao.selecionados.has(v.id)}
                    onChange={() => selecao.alternar(v.id)}
                    aria-label={`Selecionar venda de ${new Date(v.criado_em).toLocaleString("pt-BR")}`}
                  />
                </td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{new Date(v.criado_em).toLocaleString("pt-BR")}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{v.qtd_itens} item(ns)</td>
                <td className="px-3 py-3 font-semibold">{formatarMoeda(v.valor_total)}</td>
                <td className="px-3 py-3">
                  <span
                    className="text-xs font-semibold px-2 py-1 rounded-full"
                    style={{ color: STATUS_INFO[v.status].cor, background: STATUS_INFO[v.status].bg }}
                  >
                    {STATUS_INFO[v.status].label}
                  </span>
                </td>
                <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                  <RowMenu
                    itens={[
                      { label: "Ver detalhes", icon: <Eye size={13} />, onClick: () => abrirDetalhes(v) },
                      ...(v.status === "finalizada"
                        ? [{ label: "Cancelar venda", icon: <Ban size={13} />, perigoso: true, onClick: () => setVendaParaCancelar(v) }]
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

      {vendaDetalhes && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 py-6 overflow-y-auto" style={{ background: "rgba(10,8,6,0.55)" }} onClick={() => setVendaDetalhes(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md max-h-full overflow-y-auto rounded-xl border p-5 flex flex-col gap-3 shadow-xl"
            style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
          >
            <div>
              <h2 className="text-sm font-semibold">Venda de {new Date(vendaDetalhes.criado_em).toLocaleString("pt-BR")}</h2>
              <span
                className="text-xs font-semibold px-2 py-1 rounded-full inline-block mt-1"
                style={{ color: STATUS_INFO[vendaDetalhes.status].cor, background: STATUS_INFO[vendaDetalhes.status].bg }}
              >
                {STATUS_INFO[vendaDetalhes.status].label}
              </span>
            </div>

            {carregandoDetalhes && <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>Carregando itens...</p>}

            {itensDetalhes && (
              <div className="flex flex-col gap-1">
                {itensDetalhes.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 text-sm border-b py-2" style={{ borderColor: "var(--cor-borda)" }}>
                    <span className="truncate">{nomeProduto(item.produto_id)}</span>
                    <span className="shrink-0 whitespace-nowrap" style={{ color: "var(--cor-texto-muted)" }}>{item.quantidade}x R$ {item.preco_unitario.toFixed(2)}</span>
                    <span className="font-semibold shrink-0 whitespace-nowrap">R$ {(item.quantidade * item.preco_unitario).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between items-center pt-1 text-base font-bold">
              <span className="text-sm font-normal" style={{ color: "var(--cor-texto-muted)" }}>Total</span>
              <span>{formatarMoeda(vendaDetalhes.valor_total)}</span>
            </div>

            <button
              onClick={() => setVendaDetalhes(null)}
              className="rounded-md py-2 text-sm font-semibold border self-end px-4"
              style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        aberto={vendaParaCancelar !== null}
        titulo="Cancelar esta venda?"
        descricao="O estoque de todos os itens é estornado automaticamente (entrada equivalente à quantidade vendida). Essa ação não pode ser desfeita."
        labelConfirmar="Cancelar venda"
        perigoso
        confirmando={cancelando}
        onConfirmar={confirmarCancelamento}
        onCancelar={() => setVendaParaCancelar(null)}
      />

      <ScannerCodigo
        aberto={scannerAberto}
        onFechar={() => setScannerAberto(false)}
        onProdutoEncontrado={(produto) => {
          adicionarAoCarrinho(produto);
          sucesso(`${produto.nome} adicionado ao carrinho.`);
        }}
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

function formatarMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
