"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { PainelCompras, PedidoListaItem, Produto } from "@/lib/types";
import {
  useToast, TableSkeletonRows, Pagination, ThOrdenavel, TrHover, RowMenu, useDebouncedValue, useKeyboardShortcuts,
} from "@/components/ui";
import { Search, Plus, Eye, PackageCheck } from "lucide-react";

const TAMANHO_PAGINA = 25;

type PedidoItem = { id: string; produto_id: string; quantidade: number; custo_unitario: number; quantidade_recebida: number };
type Pedido = { id: string; status: string; itens: PedidoItem[] };
type Sugestao = { produto_id: string; produto_nome: string; quantidade_sugerida: number };

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  recebido_parcial: "Recebido parcial",
  recebido: "Recebido",
  cancelado: "Cancelado",
};

export default function ComprasPage() {
  const { erro: toastErro } = useToast();

  const [painel, setPainel] = useState<PainelCompras | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebouncedValue(busca, 300);
  const [statusFiltro, setStatusFiltro] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [pagina, setPagina] = useState(1);
  const [ordenarPor, setOrdenarPor] = useState("criado_em");
  const [direcao, setDirecao] = useState<"asc" | "desc">("desc");

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [produtoId, setProdutoId] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [custo, setCusto] = useState("");

  const [pedidoAberto, setPedidoAberto] = useState<Pedido | null>(null);

  const buscaRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      if (buscaDebounced) params.set("busca", buscaDebounced);
      if (statusFiltro) params.set("status", statusFiltro);
      if (fornecedorId) params.set("fornecedor_id", fornecedorId);
      params.set("ordenar_por", ordenarPor);
      params.set("direcao", direcao);
      params.set("pagina", String(pagina));
      params.set("tamanho", String(TAMANHO_PAGINA));

      const dados = await apiFetch<PainelCompras>(`/compras/painel?${params.toString()}`);
      setPainel(dados);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível carregar os pedidos de compra.");
    } finally {
      setCarregando(false);
    }
  }, [buscaDebounced, statusFiltro, fornecedorId, ordenarPor, direcao, pagina]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    setPagina(1);
  }, [buscaDebounced, statusFiltro, fornecedorId]);

  useEffect(() => {
    Promise.all([
      apiFetch<Produto[]>("/produtos"),
      apiFetch<Sugestao[]>("/compras/sugestao-reposicao"),
    ])
      .then(([prods, sugs]) => {
        setProdutos(prods);
        setSugestoes(sugs);
      })
      .catch(() => {});
  }, []);

  const itensLista = painel?.itens ?? [];
  const kpis = painel?.kpis;

  function alternarOrdenacao(campo: string) {
    if (ordenarPor !== campo) {
      setOrdenarPor(campo);
      setDirecao("asc");
    } else {
      setDirecao((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  function nomeProduto(id: string) {
    return produtos.find((p) => p.id === id)?.nome ?? id;
  }

  async function verPedido(item: PedidoListaItem) {
    setErro(null);
    try {
      const pedido = await apiFetch<Pedido>(`/compras/pedidos/${item.id}`);
      setPedidoAberto(pedido);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível carregar o pedido.");
    }
  }

  async function criarPedido() {
    setErro(null);
    try {
      await apiFetch("/compras/pedidos", {
        method: "POST",
        body: JSON.stringify({ itens: [{ produto_id: produtoId, quantidade: Number(quantidade), custo_unitario: Number(custo) }] }),
      });
      setProdutoId(""); setQuantidade(""); setCusto("");
      await carregar();
      const sugs = await apiFetch<Sugestao[]>("/compras/sugestao-reposicao").catch(() => sugestoes);
      setSugestoes(sugs);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível criar o pedido.";
      setErro(msg);
      toastErro(msg);
    }
  }

  async function receber(pedidoId: string, itemId: string, faltante: number) {
    try {
      await apiFetch(`/compras/pedidos/${pedidoId}/receber`, {
        method: "POST",
        body: JSON.stringify({ item_id: itemId, quantidade_recebida: faltante }),
      });
      const pedido = await apiFetch<Pedido>(`/compras/pedidos/${pedidoId}`);
      setPedidoAberto(pedido);
      await carregar();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível registrar o recebimento.";
      setErro(msg);
      toastErro(msg);
    }
  }

  useKeyboardShortcuts({
    onFocusBusca: () => buscaRef.current?.focus(),
    onEscape: () => setPedidoAberto(null),
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Compras</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Pedidos e sugestão de reposição
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        <CartaoKpi titulo="Pedidos" valor={kpis ? String(kpis.total_pedidos) : "—"} />
        <CartaoKpi
          titulo="Em aberto"
          valor={kpis ? String(kpis.pedidos_em_aberto) : "—"}
          destaque={kpis && kpis.pedidos_em_aberto > 0 ? "var(--cor-acento)" : undefined}
        />
        <CartaoKpi titulo="Valor total" valor={kpis ? formatarMoeda(kpis.valor_total_pedidos) : "—"} />
        <CartaoKpi titulo="Fornecedores" valor={kpis ? String(kpis.fornecedores_distintos) : "—"} />
      </div>

      {erro && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
          {erro}
        </div>
      )}

      {sugestoes.length > 0 && (
        <div className="rounded-xl border p-4" style={{ background: "rgba(16,185,129,0.08)", borderColor: "var(--cor-acento)" }}>
          <p className="text-xs font-semibold mb-1" style={{ color: "var(--cor-acento)" }}>Sugestão de reposição</p>
          <div className="flex flex-col gap-0.5">
            {sugestoes.map((s) => (
              <p key={s.produto_id} className="text-sm">{s.produto_nome} — repor {s.quantidade_sugerida}</p>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border p-5 flex flex-col gap-3 md:flex-row md:items-end md:flex-wrap" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
        <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          Produto
          <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)}
            className="rounded-md px-3 py-2 text-sm outline-none border font-normal w-full md:w-auto"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}>
            <option value="">Selecione</option>
            {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>
        <div className="flex gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold flex-1" style={{ color: "var(--cor-texto-muted)" }}>
            Quantidade
            <input type="number" value={quantidade} onChange={(e) => setQuantidade(e.target.value)}
              className="rounded-md px-3 py-2 text-sm outline-none border w-full md:w-28"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold flex-1" style={{ color: "var(--cor-texto-muted)" }}>
            Custo unitário
            <input type="number" value={custo} onChange={(e) => setCusto(e.target.value)}
              className="rounded-md px-3 py-2 text-sm outline-none border w-full md:w-28"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }} />
          </label>
        </div>
        <button onClick={criarPedido} className="flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-bold w-full md:w-auto"
          style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}>
          <Plus size={15} /> Criar pedido
        </button>
      </div>

      {pedidoAberto && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
          <div className="px-5 py-3.5 border-b flex items-center justify-between" style={{ borderColor: "var(--cor-borda)" }}>
            <h3 className="font-display font-semibold text-sm">Pedido {pedidoAberto.id.slice(0, 8)}</h3>
            <button onClick={() => setPedidoAberto(null)} className="text-xs underline" style={{ color: "var(--cor-texto-muted)" }}>Fechar (esc)</button>
          </div>
          <div className="flex flex-col p-3.5 gap-2">
            {pedidoAberto.itens.map((item) => {
              const faltante = item.quantidade - item.quantidade_recebida;
              return (
                <div key={item.id} className="flex items-center justify-between text-sm py-1.5 gap-2">
                  <span className="truncate">{nomeProduto(item.produto_id)} — {item.quantidade_recebida}/{item.quantidade}</span>
                  {faltante > 0 && (
                    <button onClick={() => receber(pedidoAberto.id, item.id, faltante)}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-md flex items-center gap-1 shrink-0"
                      style={{ color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }}>
                      <PackageCheck size={12} /> Receber {faltante}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3 md:flex-wrap">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:flex-wrap md:flex-1 md:min-w-[280px]">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 w-full md:w-72"
            style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
            <Search size={15} style={{ color: "var(--cor-texto-muted)" }} />
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por fornecedor  (/)"
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:contents">
            {["rascunho", "recebido_parcial", "recebido", "cancelado"].map((s) => (
              <ChipFiltro
                key={s}
                label={STATUS_LABEL[s]}
                ativo={statusFiltro === s}
                onClick={() => setStatusFiltro((atual) => (atual === s ? "" : s))}
              />
            ))}

            {(painel?.filtros.fornecedores.length ?? 0) > 0 && (
              <select
                value={fornecedorId}
                onChange={(e) => setFornecedorId(e.target.value)}
                className="rounded-md px-2.5 py-2 text-xs font-semibold border outline-none shrink-0"
                style={{
                  background: fornecedorId ? "rgba(16,185,129,0.14)" : "var(--cor-superficie)",
                  borderColor: fornecedorId ? "var(--cor-acento)" : "var(--cor-borda)",
                  color: fornecedorId ? "var(--cor-acento)" : "var(--cor-texto-muted)",
                }}
              >
                <option value="">Fornecedor</option>
                {painel?.filtros.fornecedores.map((f) => (
                  <option key={f.id} value={f.id}>{f.nome}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Lista de cards — mobile apenas */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {carregando && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-3.5 h-24 animate-pulse" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }} />
        ))}
        {!carregando && itensLista.length === 0 && (
          <div className="rounded-xl border px-5 py-8 text-center text-sm" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}>
            {painel && painel.total === 0 && !buscaDebounced && !statusFiltro
              ? "Nenhum pedido de compra ainda."
              : "Nenhum pedido encontrado com esses filtros."}
          </div>
        )}
        {!carregando && itensLista.map((p) => (
          <div
            key={p.id}
            className="rounded-xl border p-3.5 flex flex-col gap-2.5"
            style={{
              background: "var(--cor-superficie)",
              borderColor: pedidoAberto?.id === p.id ? "var(--cor-acento)" : "var(--cor-borda)",
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">Pedido {p.id.slice(0, 8)}</div>
                <div className="text-xs truncate" style={{ color: "var(--cor-texto-muted)" }}>
                  {p.fornecedor_nome ?? "Fornecedor não informado"} · {p.qtd_itens} item(ns)
                </div>
              </div>
              <RowMenu itens={[{ label: "Ver / receber", icon: <Eye size={13} />, onClick: () => verPedido(p) }]} />
            </div>
            <div className="flex items-center justify-between">
              <StatusBadge status={p.status} />
              <span className="text-sm font-medium">{formatarMoeda(p.valor_total)}</span>
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
              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Pedido</th>
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Fornecedor</th>
              <ThOrdenavel label="Status" campo="status" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Pendente</th>
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Valor total</th>
              <ThOrdenavel label="Data" campo="criado_em" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {carregando && <TableSkeletonRows colunas={7} linhas={8} />}
            {!carregando && itensLista.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-sm" style={{ color: "var(--cor-texto-muted)" }}>
                  {painel && painel.total === 0 && !buscaDebounced && !statusFiltro
                    ? "Nenhum pedido de compra ainda."
                    : "Nenhum pedido encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {!carregando && itensLista.map((p) => (
              <TrHover key={p.id} selecionada={pedidoAberto?.id === p.id} onClick={() => verPedido(p)}>
                <td className="px-5 py-3 font-medium">{p.id.slice(0, 8)}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{p.fornecedor_nome ?? "—"}</td>
                <td className="px-3 py-3"><StatusBadge status={p.status} /></td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>
                  {p.quantidade_pendente > 0 ? `${p.quantidade_pendente} un.` : "—"}
                </td>
                <td className="px-3 py-3">{formatarMoeda(p.valor_total)}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>
                  {new Date(p.criado_em).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                  <RowMenu itens={[{ label: "Ver / receber", icon: <Eye size={13} />, onClick: () => verPedido(p) }]} />
                </td>
              </TrHover>
            ))}
          </tbody>
        </table>
        {painel && painel.total > 0 && (
          <Pagination pagina={pagina} tamanhoPagina={TAMANHO_PAGINA} total={painel.total} onPaginaChange={setPagina} />
        )}
      </div>
    </div>
  );
}

function CartaoKpi({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: string }) {
  return (
    <div className="rounded-xl border p-4 text-left flex flex-col gap-1" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>{titulo}</span>
      <span className="text-xl font-display font-semibold" style={{ color: destaque ?? "var(--cor-texto)" }}>{valor}</span>
    </div>
  );
}

function ChipFiltro({ label, ativo, onClick }: { label: string; ativo: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-3 py-2 text-xs font-semibold border whitespace-nowrap shrink-0"
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

function StatusBadge({ status }: { status: string }) {
  const estilo =
    status === "recebido"
      ? { color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }
      : status === "cancelado"
      ? { color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }
      : { color: "var(--cor-acento)", background: "rgba(16,185,129,0.14)" };
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={estilo}>{STATUS_LABEL[status] ?? status}</span>;
}

function formatarMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
