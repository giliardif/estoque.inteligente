"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError, obterAccessToken } from "@/lib/api";
import { ItemNotaFiscalLista, KpisNotasFiscais, PainelNotasFiscais } from "@/lib/types";
import {
  useToast, TableSkeletonRows, Pagination, ThOrdenavel, TrHover, RowMenu, useDebouncedValue, useKeyboardShortcuts,
} from "@/components/ui";
import { Search, Upload, FileText, Eye, XCircle } from "lucide-react";

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
  const [notaSelecionadaId, setNotaSelecionadaId] = useState<string | null>(null);
  const [notaSelecionadaNumero, setNotaSelecionadaNumero] = useState<string | null>(null);

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

  async function verItensDaNota(nota: ItemNotaFiscalLista) {
    setErro(null);
    try {
      const listaItens = await apiFetch<ItemNota[]>(`/notas-fiscais/${nota.id}/itens`);
      setItens(listaItens);
      setNotaSelecionadaId(nota.id);
      setNotaSelecionadaNumero(nota.numero);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível carregar os itens da nota.");
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
      const listaItens = await apiFetch<ItemNota[]>(`/notas-fiscais/${nota.id}/itens`);
      setItens(listaItens);
      setNotaSelecionadaId(nota.id);
      setNotaSelecionadaNumero(nota.numero);
      await carregar();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Não foi possível importar o XML.";
      setErro(msg);
      toastErro(msg);
    } finally {
      setEnviando(false);
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
    onEscape: () => {
      setNotaSelecionadaId(null);
      setNotaSelecionadaNumero(null);
      setItens([]);
    },
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
        className="rounded-xl border p-8 flex flex-col items-center gap-2 text-center cursor-pointer"
        style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
      >
        <Upload size={22} style={{ color: "var(--cor-acento)" }} />
        <span className="font-display font-semibold text-sm">
          {enviando ? "Processando XML..." : "Clique para selecionar o XML da NF-e"}
        </span>
        {nomeArquivo && <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>{nomeArquivo}</span>}
        <input type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={handleArquivo} disabled={enviando} />
      </label>

      {erro && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
          {erro}
        </div>
      )}

      {itens.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
          <div className="px-5 py-3.5 border-b flex items-center gap-2" style={{ borderColor: "var(--cor-borda)" }}>
            <FileText size={15} />
            <h3 className="font-display font-semibold text-sm">
              Itens da nota{notaSelecionadaNumero ? ` ${notaSelecionadaNumero}` : ""}
            </h3>
          </div>

          {/* Cards — mobile apenas */}
          <div className="flex flex-col gap-2.5 p-3.5 md:hidden">
            {itens.map((i) => (
              <div key={i.id} className="rounded-lg border p-3 flex flex-col gap-2" style={{ borderColor: "var(--cor-borda)" }}>
                <div className="text-sm font-medium">{i.descricao_xml}</div>
                <div className="flex items-center justify-between text-xs" style={{ color: "var(--cor-texto-muted)" }}>
                  <span>Qtd: {i.quantidade}</span>
                  <span>R$ {i.valor_unitario.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between">
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

          {/* Tabela — desktop apenas */}
          <table className="hidden md:table w-full text-sm">
            <thead>
              <tr>
                {["Descrição no XML", "Qtd", "Valor un.", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-5 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id} style={{ borderTop: "1px solid var(--cor-borda)" }}>
                  <td className="px-5 py-2.5">{i.descricao_xml}</td>
                  <td className="px-3 py-2.5">{i.quantidade}</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--cor-texto-muted)" }}>R$ {i.valor_unitario.toFixed(2)}</td>
                  <td className="px-3 py-2.5"><StatusMatchBadge status={i.status_match} /></td>
                  <td className="px-3 py-2.5">
                    {i.status_match === "pendente_cadastro" && (
                      <button onClick={() => ignorarItem(i.id)} className="text-xs underline" style={{ color: "var(--cor-texto-muted)" }}>
                        Ignorar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
      </div>

      {/* Lista de cards — mobile apenas. Mesmos dados e ações da tabela abaixo. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {carregando && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-3.5 h-24 animate-pulse" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }} />
        ))}
        {!carregando && itensLista.length === 0 && (
          <div className="rounded-xl border px-5 py-8 text-center text-sm" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}>
            {painel && painel.total === 0 && !buscaDebounced && !statusFiltro
              ? "Nenhuma nota importada ainda."
              : "Nenhuma nota encontrada com esses filtros."}
          </div>
        )}
        {!carregando && itensLista.map((n) => (
          <div
            key={n.id}
            className="rounded-xl border p-3.5 flex flex-col gap-2.5"
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
              <RowMenu itens={[{ label: "Ver itens", icon: <Eye size={13} />, onClick: () => verItensDaNota(n) }]} />
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
      <div className="hidden md:block rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
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
                <td className="px-3 py-3">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }}>
                    {STATUS_LABEL[n.status] ?? n.status}
                  </span>
                </td>
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

function StatusMatchBadge({ status }: { status: "reconhecido" | "pendente_cadastro" | "ignorado" }) {
  const estilo =
    status === "reconhecido"
      ? { color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }
      : status === "ignorado"
      ? { color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }
      : { color: "var(--cor-acento)", background: "rgba(16,185,129,0.14)" };
  const label = status === "reconhecido" ? "Reconhecido" : status === "ignorado" ? "Ignorado" : "Aguardando cadastro";
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={estilo}>{label}</span>;
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

function formatarMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
