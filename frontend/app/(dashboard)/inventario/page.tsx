"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { InventarioCiclo, InventarioListaItem, PainelInventario } from "@/lib/types";
import {
  useToast, TableSkeletonRows, Pagination, ThOrdenavel, TrHover, useDebouncedValue, useKeyboardShortcuts,
} from "@/components/ui";
import { Search, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { PainelOperadorInventario } from "@/components/inventario/PainelOperadorInventario";
import { PainelConciliacaoInventario } from "@/components/inventario/PainelConciliacaoInventario";

const TAMANHO_PAGINA = 25;

const STATUS_LABEL: Record<string, string> = { aberto: "Aberto", em_analise: "Em Análise", fechado: "Fechado" };

// Perfis com poder de conciliar/aprovar — hoje só admin. Ver
// PERFIS_SUPERVISOR em core/security.py no backend: quando o perfil
// 'supervisor' existir, é só incluir aqui também.
const PERFIS_SUPERVISOR = ["admin"];

export default function InventarioPage() {
  const { erro: toastErro } = useToast();
  const { usuario } = useAuth();
  const ehSupervisor = usuario ? PERFIS_SUPERVISOR.includes(usuario.perfil) : false;

  const [inventario, setInventario] = useState<InventarioCiclo | null>(null);
  const [ciclo, setCiclo] = useState(() => new Date().toISOString().slice(0, 7));
  const [erro, setErro] = useState<string | null>(null);
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

  const verificarAberto = useCallback(() => {
    setVerificandoAberto(true);
    // Retomada: se já existe um ciclo em andamento (aberto ou em_analise),
    // carrega ele em vez de deixar o usuário perder o progresso e não
    // conseguir nem abrir um novo (backend bloqueia 2 ciclos simultâneos
    // pro mesmo depósito).
    apiFetch<InventarioCiclo | null>("/inventario/aberto")
      .then((inv) => setInventario(inv))
      .catch(() => {})
      .finally(() => setVerificandoAberto(false));
  }, []);

  useEffect(() => { verificarAberto(); }, [verificarAberto]);

  async function abrirInventario() {
    setErro(null);
    setProcessando(true);
    try {
      const inv = await apiFetch<InventarioCiclo>("/inventario", { method: "POST", body: JSON.stringify({ ciclo }) });
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

  function aoConcluirCiclo() {
    setInventario(null);
    carregarPainel();
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

      {verificandoAberto && (
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>Verificando ciclo em andamento...</p>
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
        inventario.status === "em_analise" && ehSupervisor ? (
          <PainelConciliacaoInventario inventarioId={inventario.id} onAprovado={aoConcluirCiclo} />
        ) : (
          <PainelOperadorInventario inventarioId={inventario.id} onEnviadoParaAnalise={verificarAberto} />
        )
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
            {["aberto", "em_analise", "fechado"].map((s) => (
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
    : status === "em_analise"
      ? { color: "#F59E0B", background: "rgba(245,158,11,0.16)" }
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
