"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { InventarioListaItem, PainelInventario, Produto } from "@/lib/types";
import {
  useToast, TableSkeletonRows, Pagination, ThOrdenavel, TrHover, RowMenu, useDebouncedValue, useKeyboardShortcuts,
} from "@/components/ui";
import { Search, Eye, AlertTriangle, ScanBarcode } from "lucide-react";
import { ScannerCodigo } from "@/components/scanner/ScannerCodigo";
import { useLeitorFisico } from "@/lib/useLeitorFisico";

const TAMANHO_PAGINA = 25;

type Inventario = { id: string; status: string; ciclo: string };

const STATUS_LABEL: Record<string, string> = { aberto: "Aberto", fechado: "Fechado" };

export default function InventarioPage() {
  const { erro: toastErro } = useToast();

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [inventario, setInventario] = useState<Inventario | null>(null);
  const [contagem, setContagem] = useState<Record<string, string>>({});
  const [ciclo, setCiclo] = useState(() => new Date().toISOString().slice(0, 7));
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [processando, setProcessando] = useState(false);
  const [verificandoAberto, setVerificandoAberto] = useState(true);

  const [painel, setPainel] = useState<PainelInventario | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebouncedValue(busca, 300);
  const [statusFiltro, setStatusFiltro] = useState("");
  const [depositoId, setDepositoId] = useState("");
  const [pagina, setPagina] = useState(1);
  const [ordenarPor, setOrdenarPor] = useState("criado_em");
  const [direcao, setDirecao] = useState<"asc" | "desc">("desc");

  const buscaRef = useRef<HTMLInputElement>(null);

  // --- Scanner (só faz sentido durante uma contagem em aberto) -----------
  const [scannerAberto, setScannerAberto] = useState(false);
  const [modoContagem, setModoContagem] = useState<"tabela" | "fila">("tabela");
  const [filaContagem, setFilaContagem] = useState<string[]>([]);
  const [linhaDestacadaId, setLinhaDestacadaId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function localizarProdutoNaContagem(produto: Produto) {
    if (modoContagem === "fila") {
      setFilaContagem((atual) => (atual.includes(produto.id) ? atual : [produto.id, ...atual]));
    }
    setLinhaDestacadaId(produto.id);
    // Espera o próximo tick pro item aparecer no DOM (relevante no modo
    // fila, onde o card só existe depois do setFilaContagem acima).
    setTimeout(() => {
      inputRefs.current[produto.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
      inputRefs.current[produto.id]?.focus();
    }, 50);
    setTimeout(() => setLinhaDestacadaId((atual) => (atual === produto.id ? null : atual)), 900);
  }

  const buscarELocalizarNaContagem = useCallback(async (codigo: string) => {
    if (!inventario) return; // sem contagem em aberto, bipar não tem o que fazer aqui
    try {
      const produto = await apiFetch<Produto>(`/produtos/buscar-codigo?codigo=${encodeURIComponent(codigo)}`);
      localizarProdutoNaContagem(produto);
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 404
        ? "Nenhum produto encontrado para esse código."
        : "Não foi possível buscar o produto.";
      toastErro(msg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventario, modoContagem, toastErro]);

  useLeitorFisico(buscarELocalizarNaContagem);

  const carregarPainel = useCallback(async () => {
    setCarregando(true);
    try {
      const params = new URLSearchParams();
      if (buscaDebounced) params.set("busca", buscaDebounced);
      if (statusFiltro) params.set("status", statusFiltro);
      if (depositoId) params.set("deposito_id", depositoId);
      params.set("ordenar_por", ordenarPor);
      params.set("direcao", direcao);
      params.set("pagina", String(pagina));
      params.set("tamanho", String(TAMANHO_PAGINA));
      const dados = await apiFetch<PainelInventario>(`/inventario/painel?${params.toString()}`);
      setPainel(dados);
    } catch {
      // painel é informativo — não deve travar o fluxo de contagem em andamento
    } finally {
      setCarregando(false);
    }
  }, [buscaDebounced, statusFiltro, depositoId, ordenarPor, direcao, pagina]);

  useEffect(() => {
    carregarPainel();
  }, [carregarPainel]);

  useEffect(() => {
    setPagina(1);
  }, [buscaDebounced, statusFiltro, depositoId]);

  useEffect(() => {
    apiFetch<Produto[]>("/produtos").then(setProdutos).catch(() => {});

    // Retomada: se já existe um inventário em aberto (ex.: página recarregada
    // no meio de uma contagem), carrega ele em vez de deixar o usuário perder
    // o progresso e não conseguir nem abrir um novo (backend bloqueia 2
    // inventários abertos ao mesmo tempo pro mesmo depósito).
    apiFetch<Inventario | null>("/inventario/aberto")
      .then((inv) => { if (inv) setInventario(inv); })
      .catch(() => {})
      .finally(() => setVerificandoAberto(false));
  }, []);

  async function abrirInventario() {
    setErro(null);
    setProcessando(true);
    try {
      const inv = await apiFetch<Inventario>("/inventario", { method: "POST", body: JSON.stringify({ ciclo }) });
      setInventario(inv);
      carregarPainel();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível abrir o inventário.";
      setErro(msg);
      toastErro(msg);
    } finally {
      setProcessando(false);
    }
  }

  async function fecharInventario() {
    if (!inventario) return;
    setErro(null);
    setSucesso(null);
    setProcessando(true);
    try {
      const itens = produtos
        .filter((p) => contagem[p.id] !== undefined && contagem[p.id] !== "")
        .map((p) => ({ produto_id: p.id, qtd_contada: Number(contagem[p.id]) }));

      if (itens.length === 0) {
        setErro("Informe a contagem de pelo menos um produto antes de fechar.");
        return;
      }

      await apiFetch(`/inventario/${inventario.id}/fechar`, { method: "POST", body: JSON.stringify({ itens }) });
      setSucesso("Inventário fechado — ajustes de estoque aplicados automaticamente.");
      setInventario(null);
      setContagem({});
      carregarPainel();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível fechar o inventário.";
      setErro(msg);
      toastErro(msg);
    } finally {
      setProcessando(false);
    }
  }

  const itensLista = painel?.itens ?? [];
  const kpis = painel?.kpis;

  function alternarOrdenacao(campo: string) {
    if (ordenarPor !== campo) { setOrdenarPor(campo); setDirecao("asc"); }
    else { setDirecao((d) => (d === "asc" ? "desc" : "asc")); }
  }

  useKeyboardShortcuts({ onFocusBusca: () => buscaRef.current?.focus() });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Inventário</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Contagem física e reconciliação
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        <CartaoKpi titulo="Ciclos de contagem" valor={kpis ? String(kpis.total_inventarios) : "—"} />
        <CartaoKpi
          titulo="Em aberto"
          valor={kpis ? String(kpis.inventarios_abertos) : "—"}
          destaque={kpis && kpis.inventarios_abertos > 0 ? "var(--cor-acento)" : undefined}
        />
        <CartaoKpi titulo="Itens com divergência" valor={kpis ? String(kpis.itens_divergentes) : "—"} />
        <CartaoKpi titulo="Depósitos" valor={kpis ? String(kpis.depositos_distintos) : "—"} />
      </div>

      {erro && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
          {erro}
        </div>
      )}
      {sucesso && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }}>
          {sucesso}
        </div>
      )}

      {verificandoAberto && (
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>Verificando contagem em andamento...</p>
      )}

      {!verificandoAberto && !inventario && (
        <div className="rounded-xl border p-5 flex flex-col gap-3 md:flex-row md:items-end" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            Ciclo
            <input
              value={ciclo}
              onChange={(e) => setCiclo(e.target.value)}
              className="rounded-md px-3 py-2 text-sm outline-none border font-normal w-full md:w-auto"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            />
          </label>
          <button
            onClick={abrirInventario}
            disabled={processando}
            className="rounded-md px-4 py-2 font-bold text-sm disabled:opacity-60 w-full md:w-auto"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            Abrir ciclo de contagem
          </button>
        </div>
      )}

      {!verificandoAberto && inventario && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
          <div className="px-5 py-3.5 border-b flex flex-col gap-2 md:flex-row md:items-center md:justify-between" style={{ borderColor: "var(--cor-borda)" }}>
            <h3 className="font-display font-semibold text-sm">Contagem — ciclo {inventario.ciclo}</h3>
            <button
              onClick={fecharInventario}
              disabled={processando}
              className="rounded-md px-3.5 py-2 font-bold text-xs disabled:opacity-60"
              style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
            >
              {processando ? "Fechando..." : "Fechar contagem e ajustar estoque"}
            </button>
          </div>

          <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: "var(--cor-borda)" }}>
            <div className="flex gap-1.5">
              <button
                onClick={() => setModoContagem("tabela")}
                className="rounded-md px-3 py-1.5 text-xs font-semibold border"
                style={modoContagem === "tabela"
                  ? { background: "rgba(16,185,129,0.14)", borderColor: "var(--cor-acento)", color: "var(--cor-acento)" }
                  : { background: "transparent", borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
              >
                Tabela geral
              </button>
              <button
                onClick={() => setModoContagem("fila")}
                className="rounded-md px-3 py-1.5 text-xs font-semibold border"
                style={modoContagem === "fila"
                  ? { background: "rgba(16,185,129,0.14)", borderColor: "var(--cor-acento)", color: "var(--cor-acento)" }
                  : { background: "transparent", borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
              >
                Fila de contagem
              </button>
            </div>
            <button
              onClick={() => setScannerAberto(true)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold"
              style={{ background: "var(--cor-acento)", color: "#06231a" }}
            >
              <ScanBarcode size={13} /> Escanear
            </button>
          </div>

          {modoContagem === "tabela" ? (
            <>
              {/* Cards — mobile apenas */}
              <div className="flex flex-col gap-2 p-3.5 md:hidden">
                {produtos.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 text-sm rounded-md px-1.5 py-1 transition-colors"
                    style={{ background: linhaDestacadaId === p.id ? "rgba(16,185,129,0.18)" : "transparent" }}
                  >
                    <span className="truncate">{p.nome}</span>
                    <input
                      ref={(el) => { inputRefs.current[p.id] = el; }}
                      type="number" min="0" step="0.01"
                      value={contagem[p.id] ?? ""}
                      onChange={(e) => setContagem({ ...contagem, [p.id]: e.target.value })}
                      className="rounded-md px-2 py-1 text-sm outline-none border w-20 shrink-0"
                      style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                    />
                  </div>
                ))}
              </div>

              {/* Tabela — desktop apenas */}
              <table className="hidden md:table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left px-5 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Produto</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Contagem</th>
                  </tr>
                </thead>
                <tbody>
                  {produtos.map((p) => (
                    <tr
                      key={p.id}
                      style={{ borderTop: "1px solid var(--cor-borda)", background: linhaDestacadaId === p.id ? "rgba(16,185,129,0.18)" : "transparent" }}
                      className="transition-colors"
                    >
                      <td className="px-5 py-2">{p.nome}</td>
                      <td className="px-3 py-2">
                        <input
                          ref={(el) => { inputRefs.current[p.id] = el; }}
                          type="number" min="0" step="0.01"
                          value={contagem[p.id] ?? ""}
                          onChange={(e) => setContagem({ ...contagem, [p.id]: e.target.value })}
                          className="rounded-md px-2 py-1 text-sm outline-none border w-24"
                          style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            // Fila de contagem: só mostra o que já foi bipado, mais recente
            // no topo — pensada pra quem tá andando pela loja com o leitor,
            // sem precisar rolar a tabela inteira pra achar cada item.
            <div className="flex flex-col gap-2 p-3.5">
              {filaContagem.length === 0 && (
                <div className="text-center text-sm py-8" style={{ color: "var(--cor-texto-muted)" }}>
                  Nenhum item bipado ainda. Clique em &quot;Escanear&quot; ou use o leitor físico pra começar.
                </div>
              )}
              {filaContagem.map((produtoId) => {
                const p = produtos.find((x) => x.id === produtoId);
                if (!p) return null;
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors"
                    style={{
                      borderColor: linhaDestacadaId === p.id ? "var(--cor-acento)" : "var(--cor-borda)",
                      background: linhaDestacadaId === p.id ? "rgba(16,185,129,0.1)" : "var(--cor-base)",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{p.nome}</div>
                      <div className="text-xs font-mono" style={{ color: "var(--cor-texto-muted)" }}>
                        {p.sku || p.codigo_barras || "—"}
                      </div>
                    </div>
                    <input
                      ref={(el) => { inputRefs.current[p.id] = el; }}
                      type="number" min="0" step="0.01"
                      value={contagem[p.id] ?? ""}
                      onChange={(e) => setContagem({ ...contagem, [p.id]: e.target.value })}
                      placeholder="Qtd."
                      className="rounded-md px-2 py-1.5 text-sm outline-none border w-24 shrink-0"
                      style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                    />
                  </div>
                );
              })}
              {filaContagem.length > 0 && (
                <button
                  onClick={() => setModoContagem("tabela")}
                  className="text-xs font-semibold self-start mt-1"
                  style={{ color: "var(--cor-acento)" }}
                >
                  Ver tabela completa →
                </button>
              )}
            </div>
          )}
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
              placeholder="Buscar por ciclo  (/)"
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:contents">
            {["aberto", "fechado"].map((s) => (
              <ChipFiltro key={s} label={STATUS_LABEL[s]} ativo={statusFiltro === s}
                onClick={() => setStatusFiltro((atual) => (atual === s ? "" : s))} />
            ))}

            {(painel?.filtros.depositos.length ?? 0) > 0 && (
              <select
                value={depositoId}
                onChange={(e) => setDepositoId(e.target.value)}
                className="rounded-md px-2.5 py-2 text-xs font-semibold border outline-none shrink-0"
                style={{
                  background: depositoId ? "rgba(16,185,129,0.14)" : "var(--cor-superficie)",
                  borderColor: depositoId ? "var(--cor-acento)" : "var(--cor-borda)",
                  color: depositoId ? "var(--cor-acento)" : "var(--cor-texto-muted)",
                }}
              >
                <option value="">Depósito</option>
                {painel?.filtros.depositos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
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
              ? "Nenhum inventário registrado ainda."
              : "Nenhum inventário encontrado com esses filtros."}
          </div>
        )}
        {!carregando && itensLista.map((inv) => <CardInventario key={inv.id} inv={inv} />)}
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
              <ThOrdenavel label="Ciclo" campo="ciclo" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Depósito</th>
              <ThOrdenavel label="Status" campo="status" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Itens contados</th>
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Divergências</th>
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
                    ? "Nenhum inventário registrado ainda."
                    : "Nenhum inventário encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {!carregando && itensLista.map((inv) => (
              <TrHover key={inv.id}>
                <td className="px-5 py-3 font-medium">{inv.ciclo}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{inv.deposito_nome ?? "Padrão"}</td>
                <td className="px-3 py-3"><StatusBadge status={inv.status} /></td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{inv.qtd_itens_contados}</td>
                <td className="px-3 py-3"><DivergenciaBadge qtd={inv.qtd_divergentes} /></td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>
                  {new Date(inv.criado_em).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-2 py-3" />
              </TrHover>
            ))}
          </tbody>
        </table>
        {painel && painel.total > 0 && (
          <Pagination pagina={pagina} tamanhoPagina={TAMANHO_PAGINA} total={painel.total} onPaginaChange={setPagina} />
        )}
      </div>

      <ScannerCodigo
        aberto={scannerAberto}
        onFechar={() => setScannerAberto(false)}
        onProdutoEncontrado={localizarProdutoNaContagem}
      />
    </div>
  );
}

function CardInventario({ inv }: { inv: InventarioListaItem }) {
  return (
    <div className="rounded-xl border p-3.5 flex flex-col gap-2.5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">Ciclo {inv.ciclo}</div>
          <div className="text-xs truncate" style={{ color: "var(--cor-texto-muted)" }}>
            {inv.deposito_nome ?? "Padrão"} · {inv.qtd_itens_contados} item(ns) contado(s)
          </div>
        </div>
        <StatusBadge status={inv.status} />
      </div>
      <div className="flex items-center justify-between">
        <DivergenciaBadge qtd={inv.qtd_divergentes} />
        <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>
          {new Date(inv.criado_em).toLocaleDateString("pt-BR")}
        </span>
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
  const estilo = status === "aberto"
    ? { color: "var(--cor-acento)", background: "rgba(16,185,129,0.14)" }
    : { color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" };
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={estilo}>{STATUS_LABEL[status] ?? status}</span>;
}

function DivergenciaBadge({ qtd }: { qtd: number }) {
  if (qtd > 0) {
    return (
      <span className="text-xs font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 w-fit" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
        <AlertTriangle size={11} /> {qtd} divergente(s)
      </span>
    );
  }
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }}>
      Sem divergências
    </span>
  );
}
