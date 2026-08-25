"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError, obterAccessToken } from "@/lib/api";
import { ItemNotaFiscalLista, KpisNotasFiscais, PainelNotasFiscais } from "@/lib/types";
import {
  useToast, TableSkeletonRows, Pagination, ThOrdenavel, TrHover, RowMenu, useDebouncedValue, useKeyboardShortcuts,
} from "@/components/ui";
import { Search, Upload, FileText, Eye, XCircle, CheckCircle2, X } from "lucide-react";

const TAMANHO_PAGINA = 25;

type ItemNota = {
  id: string;
  descricao_xml: string;
  produto_id: string | null;
  quantidade: number;
  valor_unitario: number;
  status_match: "reconhecido" | "pendente_cadastro" | "ignorado";
};

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  processada: "Processada",
  cancelada: "Cancelada",
};

export default function NotasPage() {
  const { erro: toastErro } = useToast();

  const [painel, setPainel] = useState<PainelNotasFiscais | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebouncedValue(busca, 300);
  const [statusFiltro, setStatusFiltro] = useState("");
  const [fornecedorId, setFornecedorId] = useState("");
  const [pagina, setPagina] = useState(1);
  const [ordenarPor, setOrdenarPor] = useState("criado_em");
  const [direcao, setDirecao] = useState<"asc" | "desc">("desc");

  const [enviando, setEnviando] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [itens, setItens] = useState<ItemNota[]>([]);
  const [carregandoItens, setCarregandoItens] = useState(false);
  const [notaSelecionadaId, setNotaSelecionadaId] = useState<string | null>(null);
  const [notaSelecionadaNumero, setNotaSelecionadaNumero] = useState<string | null>(null);
  const [notaSelecionadaFornecedor, setNotaSelecionadaFornecedor] = useState<string | null>(null);
  const [notaSelecionadaStatus, setNotaSelecionadaStatus] = useState<string | null>(null);
  const [painelDetalheAberto, setPainelDetalheAberto] = useState(false);

  const buscaRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      if (buscaDebounced) params.set("busca", buscaDebounced);
      if (statusFiltro) params.set("status", statusFiltro);
      params.set("ordenar_por", ordenarPor);
      params.set("direcao", direcao);
      params.set("pagina", String(pagina));
      params.set("tamanho", String(TAMANHO_PAGINA));

      const dados = await apiFetch<PainelNotasFiscais>(`/notas-fiscais/painel?${params.toString()}`);
      setPainel(dados);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível carregar as notas fiscais.");
    } finally {
      setCarregando(false);
    }
  }, [buscaDebounced, statusFiltro, ordenarPor, direcao, pagina]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    setPagina(1);
  }, [buscaDebounced, statusFiltro]);

  const itensLista = painel?.itens ?? [];
  const kpis: KpisNotasFiscais | undefined = painel?.kpis;

  function alternarOrdenacao(campo: string) {
    if (ordenarPor !== campo) {
      setOrdenarPor(campo);
      setDirecao("asc");
    } else {
      setDirecao((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

  function fecharPainelDetalhe() {
    setPainelDetalheAberto(false);
    setNotaSelecionadaId(null);
    setNotaSelecionadaNumero(null);
    setNotaSelecionadaFornecedor(null);
    setNotaSelecionadaStatus(null);
    setItens([]);
  }

  async function verItensDaNota(nota: ItemNotaFiscalLista) {
    setErro(null);
    setCarregandoItens(true);
    setNotaSelecionadaId(nota.id);
    setNotaSelecionadaNumero(nota.numero);
    setNotaSelecionadaFornecedor(nota.fornecedor_nome ?? null);
    setNotaSelecionadaStatus(nota.status);
    setPainelDetalheAberto(true);
    try {
      const listaItens = await apiFetch<ItemNota[]>(`/notas-fiscais/${nota.id}/itens`);
      setItens(listaItens);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível carregar os itens da nota.");
    } finally {
      setCarregandoItens(false);
    }
  }

  async function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setNomeArquivo(arquivo.name);
    setErro(null);
    setEnviando(true);
    try {
      // Upload multipart não passa pelo apiFetch (que sempre seta Content-Type
      // json) — chamada direta aqui, mas ainda com o mesmo access token em memória.
      const formData = new FormData();
      formData.append("arquivo", arquivo);
      const token = obterAccessToken();
      const resp = await fetch(`${API_URL}/notas-fiscais/importar`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        body: formData,
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.detail || "Não foi possível importar o XML.");
      }
      const nota = await resp.json();
      setNotaSelecionadaId(nota.id);
      setNotaSelecionadaNumero(nota.numero);
      setNotaSelecionadaFornecedor(nota.fornecedor_nome ?? null);
      setNotaSelecionadaStatus(nota.status ?? "pendente");
      setPainelDetalheAberto(true);
      setCarregandoItens(true);
      const listaItens = await apiFetch<ItemNota[]>(`/notas-fiscais/${nota.id}/itens`);
      setItens(listaItens);
      setCarregandoItens(false);
      await carregar();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Não foi possível importar o XML.";
      setErro(msg);
      toastErro(msg);
    } finally {
      setEnviando(false);
      e.target.value = "";
    }
  }

  async function ignorarItem(itemId: string) {
    await apiFetch(`/notas-fiscais/itens/${itemId}/confirmar`, {
      method: "POST",
      body: JSON.stringify({ ignorar: true }),
    }).catch(() => {});
    setItens((atual) => atual.map((i) => (i.id === itemId ? { ...i, status_match: "ignorado" } : i)));
    carregar();
  }

  useKeyboardShortcuts({
    onFocusBusca: () => buscaRef.current?.focus(),
    onEscape: fecharPainelDetalhe,
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Notas Fiscais</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Importação automática via XML de NF-e
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        <CartaoKpi titulo="Notas importadas" valor={kpis ? String(kpis.total_notas) : "—"} />
        <CartaoKpi
          titulo="Pendentes de confirmação"
          valor={kpis ? String(kpis.itens_pendentes_confirmacao) : "—"}
          destaque={kpis && kpis.itens_pendentes_confirmacao > 0 ? "var(--cor-acento)" : undefined}
        />
        <CartaoKpi titulo="Valor total importado" valor={kpis ? formatarMoeda(kpis.valor_total_importado) : "—"} />
        <CartaoKpi titulo="Fornecedores" valor={kpis ? String(kpis.fornecedores_distintos) : "—"} />
      </div>

      <label
        className="rounded-xl border p-6 flex flex-col items-center gap-1.5 text-center cursor-pointer transition-colors"
        style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
      >
        <Upload size={20} style={{ color: "var(--cor-acento)" }} />
        <span className="font-display font-semibold text-sm">
          {enviando ? "Processando XML..." : "Clique para selecionar o XML da NF-e"}
        </span>
        <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>
          {nomeArquivo ?? "ou arraste e solte o arquivo aqui"}
        </span>
        <input type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={handleArquivo} disabled={enviando} />
      </label>

      {erro && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
          {erro}
        </div>
      )}

      {/* Busca + filtros */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2 w-full md:w-72"
          style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <Search size={15} style={{ color: "var(--cor-texto-muted)" }} />
          <input
            ref={buscaRef}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por número ou fornecedor  (/)"
            className="bg-transparent outline-none text-sm w-full"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:contents">
          {["processada", "pendente", "cancelada"].map((s) => (
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

      {/* Workspace: tabela + painel de detalhe unificado (substitui a antiga seção "itens" que empurrava a página) */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex-1 min-w-0 flex flex-col gap-2.5">

          {/* Lista de cards — mobile apenas */}
          <div className="flex flex-col gap-2.5 lg:hidden">
            {carregando && Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border p-3.5 h-24 animate-pulse" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }} />
            ))}
            {!carregando && itensLista.length === 0 && (
              <EstadoVazio painel={painel} buscaDebounced={buscaDebounced} statusFiltro={statusFiltro} />
            )}
            {!carregando && itensLista.map((n) => (
              <div
                key={n.id}
                onClick={() => verItensDaNota(n)}
                className="rounded-xl border p-3.5 flex flex-col gap-2.5 cursor-pointer"
                style={{
                  background: "var(--cor-superficie)",
                  borderColor: n.id === notaSelecionadaId ? "var(--cor-acento)" : "var(--cor-borda)",
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{n.numero}</div>
                    <div className="text-xs truncate" style={{ color: "var(--cor-texto-muted)" }}>
                      {n.fornecedor_nome ?? "Fornecedor não identificado"}
                    </div>
                  </div>
                  <StatusBadge status={n.status} />
                </div>
                <div className="flex items-center justify-between">
                  <PendenciaBadge itensPendentes={n.itens_pendentes} />
                  <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>
                    {new Date(n.criado_em).toLocaleDateString("pt-BR")}
                  </span>
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
          <div className="hidden lg:block rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--cor-borda)" }}>
                  <ThOrdenavel label="Número" campo="numero" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
                  <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Fornecedor</th>
                  <ThOrdenavel label="Data" campo="criado_em" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
                  <ThOrdenavel label="Status" campo="status" campoAtivo={ordenarPor} direcao={direcao} onClick={alternarOrdenacao} />
                  <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Pendências</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {carregando && <TableSkeletonRows colunas={6} linhas={8} />}
                {!carregando && itensLista.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm" style={{ color: "var(--cor-texto-muted)" }}>
                      {painel && painel.total === 0 && !buscaDebounced && !statusFiltro
                        ? "Nenhuma nota importada ainda."
                        : "Nenhuma nota encontrada com esses filtros."}
                    </td>
                  </tr>
                )}
                {!carregando && itensLista.map((n) => (
                  <TrHover key={n.id} selecionada={n.id === notaSelecionadaId} onClick={() => verItensDaNota(n)}>
                    <td className="px-5 py-3 font-medium">{n.numero}</td>
                    <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{n.fornecedor_nome ?? "—"}</td>
                    <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>
                      {new Date(n.criado_em).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-3 py-3"><StatusBadge status={n.status} /></td>
                    <td className="px-3 py-3"><PendenciaBadge itensPendentes={n.itens_pendentes} /></td>
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <RowMenu itens={[{ label: "Ver itens", icon: <Eye size={13} />, onClick: () => verItensDaNota(n) }]} />
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

        {/* Painel de detalhe — desktop: coluna fixa ao lado da tabela. Mobile: bottom sheet. */}
        {painelDetalheAberto && (
          <>
            <div
              className="fixed inset-0 z-40 lg:hidden"
              style={{ background: "rgba(0,0,0,0.4)" }}
              onClick={fecharPainelDetalhe}
            />
            <aside
              className="rounded-xl border overflow-hidden flex flex-col
                fixed inset-x-0 bottom-0 z-50 max-h-[82vh] rounded-b-none
                lg:static lg:w-[340px] lg:shrink-0 lg:max-h-none lg:sticky lg:top-4"
              style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
            >
              <div className="px-4 py-3.5 border-b flex items-start justify-between gap-2" style={{ borderColor: "var(--cor-borda)" }}>
                <div className="min-w-0">
                  {notaSelecionadaStatus && (
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>
                      {STATUS_LABEL[notaSelecionadaStatus] ?? notaSelecionadaStatus}
                    </span>
                  )}
                  <h3 className="font-display font-semibold text-base truncate">
                    Nota {notaSelecionadaNumero}
                  </h3>
                  <p className="text-xs truncate" style={{ color: "var(--cor-texto-muted)" }}>
                    {notaSelecionadaFornecedor ?? "Fornecedor não identificado"}
                  </p>
                </div>
                <button
                  onClick={fecharPainelDetalhe}
                  className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: "rgba(255,255,255,0.06)", color: "var(--cor-texto-muted)" }}
                >
                  <X size={14} />
                </button>
              </div>

              <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid var(--cor-borda)" }}>
                <FileText size={14} style={{ color: "var(--cor-texto-muted)" }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>
                  Itens da nota {itens.length > 0 && `(${itens.length})`}
                </span>
              </div>

              <div className="overflow-y-auto flex-1 px-4 py-3">
                {carregandoItens && (
                  <div className="flex flex-col gap-2.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-14 rounded-lg animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
                    ))}
                  </div>
                )}
                {!carregandoItens && itens.length === 0 && (
                  <div className="text-sm text-center py-6" style={{ color: "var(--cor-texto-muted)" }}>
                    Nenhum item encontrado para esta nota.
                  </div>
                )}
                {!carregandoItens && itens.map((i) => (
                  <div
                    key={i.id}
                    className="flex items-start justify-between gap-3 py-2.5"
                    style={{ borderBottom: "1px solid var(--cor-borda)" }}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{i.descricao_xml}</div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--cor-texto-muted)" }}>
                        Qtd {i.quantidade} · R$ {i.valor_unitario.toFixed(2)}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusMatchBadge status={i.status_match} />
                      {i.status_match === "pendente_cadastro" && (
                        <button onClick={() => ignorarItem(i.id)} className="text-xs underline" style={{ color: "var(--cor-texto-muted)" }}>
                          Ignorar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </>
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
    status === "processada"
      ? { color: "var(--cor-sucesso)", background: "rgba(16,185,129,0.14)" }
      : status === "cancelada"
      ? { color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }
      : { color: "var(--cor-acento)", background: "rgba(16,185,129,0.14)" };
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md" style={estilo}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function StatusMatchBadge({ status }: { status: "reconhecido" | "pendente_cadastro" | "ignorado" }) {
  const estilo =
    status === "reconhecido"
      ? { color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }
      : status === "ignorado"
      ? { color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }
      : { color: "var(--cor-acento)", background: "rgba(16,185,129,0.14)" };
  const label = status === "reconhecido" ? "Reconhecido" : status === "ignorado" ? "Ignorado" : "Aguardando cadastro";
  const Icone = status === "reconhecido" ? CheckCircle2 : status === "ignorado" ? X : XCircle;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md whitespace-nowrap" style={estilo}>
      <Icone size={11} /> {label}
    </span>
  );
}

function PendenciaBadge({ itensPendentes }: { itensPendentes: number }) {
  if (itensPendentes > 0) {
    return (
      <span className="text-xs font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 w-fit" style={{ color: "var(--cor-acento)", background: "rgba(16,185,129,0.14)" }}>
        <XCircle size={11} /> {itensPendentes} pendente(s)
      </span>
    );
  }
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }}>
      Concluída
    </span>
  );
}

function EstadoVazio({
  painel, buscaDebounced, statusFiltro,
}: { painel: PainelNotasFiscais | null; buscaDebounced: string; statusFiltro: string }) {
  return (
    <div className="rounded-xl border px-5 py-8 text-center text-sm" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}>
      {painel && painel.total === 0 && !buscaDebounced && !statusFiltro
        ? "Nenhuma nota importada ainda."
        : "Nenhuma nota encontrada com esses filtros."}
    </div>
  );
}

function formatarMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
