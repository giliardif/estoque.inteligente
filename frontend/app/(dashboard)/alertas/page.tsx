"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { AlertaListaItem, PainelAlertas } from "@/lib/types";
import {
  useToast, TableSkeletonRows, Pagination, TrHover, RowMenu, useDebouncedValue, useKeyboardShortcuts,
} from "@/components/ui";
import { Search, Check, Power, RefreshCw, Bell } from "lucide-react";

const TAMANHO_PAGINA = 25;

type Regra = { id: string; tipo: string; parametros: Record<string, number>; ativo: boolean };

const TIPO_LABEL: Record<string, string> = {
  validade: "Validade",
  estoque_baixo: "Estoque baixo",
  produto_parado: "Produto parado",
};

// Campo numérico configurável de cada tipo de regra, se houver — usado pra
// renderizar o input de parâmetro certo sem hardcodar um formulário por tipo.
const PARAM_KEY: Record<string, string | null> = {
  validade: "dias_antes",
  produto_parado: "dias_sem_movimento",
  estoque_baixo: null, // sem parâmetro configurável — compara direto com estoque_minimo do produto
};

export default function AlertasPage() {
  const { erro: toastErro } = useToast();

  const [painel, setPainel] = useState<PainelAlertas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [executando, setExecutando] = useState(false);

  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebouncedValue(busca, 300);
  const [tipoFiltro, setTipoFiltro] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("nao_lido");
  const [pagina, setPagina] = useState(1);

  const buscaRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams();
      if (buscaDebounced) params.set("busca", buscaDebounced);
      if (tipoFiltro) params.set("tipo", tipoFiltro);
      if (statusFiltro) params.set("status", statusFiltro);
      params.set("pagina", String(pagina));
      params.set("tamanho", String(TAMANHO_PAGINA));
      const dados = await apiFetch<PainelAlertas>(`/alertas/painel?${params.toString()}`);
      setPainel(dados);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível carregar os alertas.");
    } finally {
      setCarregando(false);
    }
  }, [buscaDebounced, tipoFiltro, statusFiltro, pagina]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { setPagina(1); }, [buscaDebounced, tipoFiltro, statusFiltro]);

  async function carregarRegras() {
    try {
      setRegras(await apiFetch<Regra[]>("/alertas/regras"));
    } catch {
      // se o tenant ainda não configurou nenhuma regra, o motor usa os padrões — falha aqui não é crítica
    }
  }
  useEffect(() => { carregarRegras(); }, []);

  async function alternarAtiva(regra: Regra) {
    setErro(null);
    try {
      const atualizada = await apiFetch<Regra>(`/alertas/regras/${regra.id}`, {
        method: "PATCH", body: JSON.stringify({ ativo: !regra.ativo }),
      });
      setRegras((atual) => atual.map((r) => (r.id === regra.id ? atualizada : r)));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível atualizar a regra.";
      setErro(msg); toastErro(msg);
    }
  }

  async function atualizarParametro(regra: Regra, valor: number) {
    const chave = PARAM_KEY[regra.tipo];
    if (!chave) return;
    setErro(null);
    try {
      const atualizada = await apiFetch<Regra>(`/alertas/regras/${regra.id}`, {
        method: "PATCH", body: JSON.stringify({ parametros: { ...regra.parametros, [chave]: valor } }),
      });
      setRegras((atual) => atual.map((r) => (r.id === regra.id ? atualizada : r)));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível atualizar o parâmetro.";
      setErro(msg); toastErro(msg);
    }
  }

  async function executarMotor() {
    setExecutando(true);
    setErro(null);
    try {
      await apiFetch("/alertas/executar", { method: "POST" });
      await carregar();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível executar o motor de alertas.";
      setErro(msg); toastErro(msg);
    } finally {
      setExecutando(false);
    }
  }

  async function marcarLido(id: string) {
    await apiFetch(`/alertas/${id}/marcar-lido`, { method: "POST" }).catch(() => {});
    await carregar();
  }

  useKeyboardShortcuts({ onFocusBusca: () => buscaRef.current?.focus() });

  const itensLista = painel?.itens ?? [];
  const kpis = painel?.kpis;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Alertas</h1>
          <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
            Validade, estoque baixo e produtos parados
          </p>
        </div>
        <button
          onClick={executarMotor}
          disabled={executando}
          className="flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-bold disabled:opacity-60 w-full md:w-auto"
          style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
        >
          <RefreshCw size={14} className={executando ? "animate-spin" : ""} />
          {executando ? "Executando..." : "Executar motor agora"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        <CartaoKpi titulo="Ativos" valor={kpis ? String(kpis.total_ativos) : "—"} destaque={kpis && kpis.total_ativos > 0 ? "var(--cor-acento)" : undefined} />
        <CartaoKpi titulo="Validade" valor={kpis ? String(kpis.validade) : "—"} />
        <CartaoKpi titulo="Estoque baixo" valor={kpis ? String(kpis.estoque_baixo) : "—"} />
        <CartaoKpi titulo="Produto parado" valor={kpis ? String(kpis.produto_parado) : "—"} />
      </div>

      {erro && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
          {erro}
        </div>
      )}

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
        <div className="px-5 py-3.5 border-b" style={{ borderColor: "var(--cor-borda)" }}>
          <h3 className="font-display font-semibold text-sm">Regras configuradas</h3>
        </div>
        {regras.length === 0 && (
          <p className="text-sm px-5 py-4" style={{ color: "var(--cor-texto-muted)" }}>
            Nenhuma regra customizada — o motor usa os padrões (validade: 5 dias antes, produto parado: 30 dias).
          </p>
        )}
        <div className="flex flex-col">
          {regras.map((r) => {
            const chaveParam = PARAM_KEY[r.tipo];
            return (
              <div key={r.id} className="flex flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:gap-3" style={{ borderTop: "1px solid var(--cor-borda)" }}>
                <span className="text-sm flex-1">{TIPO_LABEL[r.tipo] ?? r.tipo}</span>
                <div className="flex items-center gap-3">
                  {chaveParam && (
                    <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--cor-texto-muted)" }}>
                      {chaveParam === "dias_antes" ? "Dias antes" : "Dias sem movimento"}
                      <input
                        type="number" min="1"
                        value={r.parametros?.[chaveParam] ?? ""}
                        onChange={(e) => atualizarParametro(r, Number(e.target.value))}
                        className="w-16 rounded-md px-2 py-1 text-sm outline-none border"
                        style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                      />
                    </label>
                  )}
                  <button
                    onClick={() => alternarAtiva(r)}
                    className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md"
                    style={r.ativo ? { color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" } : { color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }}
                  >
                    <Power size={12} /> {r.ativo ? "Ativa" : "Desativada"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
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
              placeholder="Buscar por produto ou mensagem  (/)"
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:contents">
            <ChipFiltro label="Ativos" ativo={statusFiltro === "nao_lido"} onClick={() => setStatusFiltro((a) => (a === "nao_lido" ? "" : "nao_lido"))} />
            <ChipFiltro label="Lidos" ativo={statusFiltro === "lido"} onClick={() => setStatusFiltro((a) => (a === "lido" ? "" : "lido"))} />
            {Object.entries(TIPO_LABEL).map(([tipo, label]) => (
              <ChipFiltro key={tipo} label={label} ativo={tipoFiltro === tipo} onClick={() => setTipoFiltro((a) => (a === tipo ? "" : tipo))} />
            ))}
          </div>
        </div>
      </div>

      {/* Lista de cards — mobile apenas */}
      <div className="flex flex-col gap-2 md:hidden">
        {carregando && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-3.5 h-16 animate-pulse" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }} />
        ))}
        {!carregando && itensLista.length === 0 && (
          <div className="rounded-xl border p-8 text-center flex flex-col items-center gap-2" style={{ borderColor: "var(--cor-borda)" }}>
            <Bell size={22} style={{ color: "var(--cor-texto-muted)" }} />
            <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
              {statusFiltro === "nao_lido" && !buscaDebounced && !tipoFiltro ? "Nenhum alerta em aberto no momento." : "Nenhum alerta encontrado com esses filtros."}
            </p>
          </div>
        )}
        {!carregando && itensLista.map((a) => <CardAlerta key={a.id} alerta={a} onMarcarLido={() => marcarLido(a.id)} />)}
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
              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Tipo</th>
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Mensagem</th>
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Data</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {carregando && <TableSkeletonRows colunas={4} linhas={8} />}
            {!carregando && itensLista.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-sm" style={{ color: "var(--cor-texto-muted)" }}>
                  {statusFiltro === "nao_lido" && !buscaDebounced && !tipoFiltro ? "Nenhum alerta em aberto no momento." : "Nenhum alerta encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {!carregando && itensLista.map((a) => (
              <TrHover key={a.id}>
                <td className="px-5 py-3">
                  <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ color: "var(--cor-acento)", background: "rgba(16,185,129,0.14)" }}>
                    {TIPO_LABEL[a.tipo] ?? a.tipo}
                  </span>
                </td>
                <td className="px-3 py-3">{a.mensagem}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>
                  {new Date(a.criado_em).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                  {!a.lido && (
                    <RowMenu itens={[{ label: "Marcar como lido", icon: <Check size={13} />, onClick: () => marcarLido(a.id) }]} />
                  )}
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

function CardAlerta({ alerta, onMarcarLido }: { alerta: AlertaListaItem; onMarcarLido: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border px-4 py-3" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
      <span className="text-xs font-semibold px-2 py-1 rounded-full shrink-0" style={{ color: "var(--cor-acento)", background: "rgba(16,185,129,0.14)" }}>
        {TIPO_LABEL[alerta.tipo] ?? alerta.tipo}
      </span>
      <span className="text-sm flex-1 min-w-0 truncate">{alerta.mensagem}</span>
      {!alerta.lido && (
        <button onClick={onMarcarLido} style={{ color: "var(--cor-texto-muted)" }} title="Marcar como lido" className="shrink-0">
          <Check size={16} />
        </button>
      )}
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
