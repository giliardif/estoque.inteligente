"use client";

import { useCallback, useEffect, useRef, useState, FormEvent, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { MovimentacaoListaItem, PainelMovimentacao, Produto } from "@/lib/types";
import {
  useToast, TableSkeletonRows, Pagination, ThOrdenavel, TrHover, useDebouncedValue, useKeyboardShortcuts,
} from "@/components/ui";
import { Search, Repeat } from "lucide-react";

const TAMANHO_PAGINA = 25;

type Deposito = { id: string; nome: string };

const TIPOS = [
  { valor: "entrada", label: "Entrada" },
  { valor: "saida", label: "Saída" },
  { valor: "transferencia", label: "Transferência" },
  { valor: "ajuste", label: "Ajuste" },
] as const;

const TIPO_LABEL: Record<string, string> = { entrada: "Entrada", saida: "Saída", ajuste: "Ajuste", transferencia: "Transferência" };

function tipoValido(v: string | null): (typeof TIPOS)[number]["valor"] | null {
  return TIPOS.some((t) => t.valor === v) ? (v as (typeof TIPOS)[number]["valor"]) : null;
}

export default function MovimentacaoPage() {
  // useSearchParams exige um limite de Suspense no App Router — as "ações
  // rápidas" da tela de Estoque linkam pra cá com ?tipo=entrada&produto_id=X
  // pra pré-preencher o formulário sem o usuário reescolher tudo de novo.
  return (
    <Suspense fallback={null}>
      <MovimentacaoConteudo />
    </Suspense>
  );
}

function MovimentacaoConteudo() {
  const searchParams = useSearchParams();
  const { erro: toastErro } = useToast();

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]["valor"]>(tipoValido(searchParams.get("tipo")) ?? "saida");
  const [produtoId, setProdutoId] = useState(searchParams.get("produto_id") ?? "");
  const [quantidade, setQuantidade] = useState("");
  const [direcao, setDirecao] = useState<"positivo" | "negativo">("positivo");
  const [depositoOrigemId, setDepositoOrigemId] = useState("");
  const [depositoDestinoId, setDepositoDestinoId] = useState("");
  const [origem, setOrigem] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [painel, setPainel] = useState<PainelMovimentacao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const buscaDebounced = useDebouncedValue(busca, 300);
  const [tipoFiltro, setTipoFiltro] = useState("");
  const [produtoFiltroId, setProdutoFiltroId] = useState("");
  const [pagina, setPagina] = useState(1);
  const [ordenarPor, setOrdenarPor] = useState("criado_em");
  const [direcaoOrdenacao, setDirecaoOrdenacao] = useState<"asc" | "desc">("desc");

  const buscaRef = useRef<HTMLInputElement>(null);

  const carregarPainel = useCallback(async () => {
    setCarregando(true);
    try {
      const params = new URLSearchParams();
      if (buscaDebounced) params.set("busca", buscaDebounced);
      if (tipoFiltro) params.set("tipo", tipoFiltro);
      if (produtoFiltroId) params.set("produto_id", produtoFiltroId);
      params.set("ordenar_por", ordenarPor);
      params.set("direcao", direcaoOrdenacao);
      params.set("pagina", String(pagina));
      params.set("tamanho", String(TAMANHO_PAGINA));
      const dados = await apiFetch<PainelMovimentacao>(`/estoque/movimentacoes/painel?${params.toString()}`);
      setPainel(dados);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível carregar o histórico.");
    } finally {
      setCarregando(false);
    }
  }, [buscaDebounced, tipoFiltro, produtoFiltroId, ordenarPor, direcaoOrdenacao, pagina]);

  useEffect(() => { carregarPainel(); }, [carregarPainel]);
  useEffect(() => { setPagina(1); }, [buscaDebounced, tipoFiltro, produtoFiltroId]);

  useEffect(() => {
    apiFetch<Produto[]>("/produtos").then(setProdutos).catch(() => {});
    apiFetch<Deposito[]>("/depositos").then(setDepositos).catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    setSalvando(true);
    try {
      const payload: Record<string, unknown> = {
        produto_id: produtoId,
        tipo,
        quantidade: Number(quantidade),
        origem: origem || undefined,
      };
      if (tipo === "ajuste") payload.direcao = direcao;
      if (tipo === "transferencia") {
        payload.deposito_origem_id = depositoOrigemId;
        payload.deposito_destino_id = depositoDestinoId;
      }

      await apiFetch("/estoque/movimentacoes", { method: "POST", body: JSON.stringify(payload) });
      setSucesso("Movimentação registrada com sucesso.");
      setQuantidade("");
      setOrigem("");
      setDepositoOrigemId("");
      setDepositoDestinoId("");
      await carregarPainel();
    } catch (err) {
      // Erros de negócio (ex: saldo insuficiente) chegam prontos do backend — o
      // frontend não reimplementa a regra, só exibe a mensagem que o backend deu.
      const msg = err instanceof ApiError ? err.message : "Não foi possível registrar a movimentação.";
      setErro(msg);
      toastErro(msg);
    } finally {
      setSalvando(false);
    }
  }

  function alternarOrdenacao(campo: string) {
    if (ordenarPor !== campo) { setOrdenarPor(campo); setDirecaoOrdenacao("asc"); }
    else { setDirecaoOrdenacao((d) => (d === "asc" ? "desc" : "asc")); }
  }

  useKeyboardShortcuts({ onFocusBusca: () => buscaRef.current?.focus() });

  const itensLista = painel?.itens ?? [];
  const kpis = painel?.kpis;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Movimentação</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Entradas, saídas, transferências e ajustes
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        <CartaoKpi titulo="Movimentações" valor={kpis ? String(kpis.total_movimentacoes) : "—"} />
        <CartaoKpi titulo="Entradas" valor={kpis ? String(kpis.entradas) : "—"} />
        <CartaoKpi titulo="Saídas" valor={kpis ? String(kpis.saidas) : "—"} />
        <CartaoKpi titulo="Ajustes" valor={kpis ? String(kpis.ajustes) : "—"} />
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

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border p-5 flex flex-col gap-3"
        style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
      >
        <h3 className="font-display font-semibold text-sm">Registrar movimentação</h3>

        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {TIPOS.map((t) => (
            <button
              type="button"
              key={t.valor}
              onClick={() => setTipo(t.valor)}
              className="flex-1 rounded-md py-2 px-3 text-xs font-semibold border whitespace-nowrap"
              style={
                tipo === t.valor
                  ? { background: "rgba(16,185,129,0.14)", borderColor: "var(--cor-acento)", color: "var(--cor-acento)" }
                  : { background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          Produto
          <select
            required
            value={produtoId}
            onChange={(e) => setProdutoId(e.target.value)}
            className="rounded-md px-3 py-2 text-sm outline-none border font-normal w-full md:w-auto"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          >
            <option value="">Selecione um produto</option>
            {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          Quantidade
          <input
            type="number" required min="0.01" step="0.01"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            className="rounded-md px-3 py-2 text-sm outline-none border font-normal w-full md:w-40"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          />
        </label>

        {tipo === "transferencia" && (
          depositos.length < 2 ? (
            <p className="text-xs rounded-md px-3 py-2" style={{ color: "var(--cor-texto-muted)", background: "var(--cor-base)" }}>
              É preciso ter pelo menos 2 depósitos cadastrados para transferir entre eles.
            </p>
          ) : (
            <div className="flex flex-col gap-3 md:flex-row">
              <label className="flex flex-col gap-1 text-xs font-semibold flex-1" style={{ color: "var(--cor-texto-muted)" }}>
                De (origem)
                <select
                  required
                  value={depositoOrigemId}
                  onChange={(e) => setDepositoOrigemId(e.target.value)}
                  className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
                  style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                >
                  <option value="">Selecione</option>
                  {depositos.map((d) => <option key={d.id} value={d.id} disabled={d.id === depositoDestinoId}>{d.nome}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold flex-1" style={{ color: "var(--cor-texto-muted)" }}>
                Para (destino)
                <select
                  required
                  value={depositoDestinoId}
                  onChange={(e) => setDepositoDestinoId(e.target.value)}
                  className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
                  style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                >
                  <option value="">Selecione</option>
                  {depositos.map((d) => <option key={d.id} value={d.id} disabled={d.id === depositoOrigemId}>{d.nome}</option>)}
                </select>
              </label>
            </div>
          )
        )}

        {tipo === "ajuste" && (
          <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            Direção do ajuste
            <select
              value={direcao}
              onChange={(e) => setDirecao(e.target.value as "positivo" | "negativo")}
              className="rounded-md px-3 py-2 text-sm outline-none border font-normal w-full md:w-auto"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            >
              <option value="positivo">Positivo (soma ao estoque)</option>
              <option value="negativo">Negativo (quebra, perda, avaria)</option>
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          Origem / motivo
          <input
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
            placeholder={tipo === "ajuste" ? "Ex: quebra, avaria" : "Ex: venda balcão, NF-e"}
            className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          />
        </label>

        <button
          type="submit"
          disabled={salvando}
          className="rounded-md py-2.5 font-bold text-sm mt-1 disabled:opacity-60 w-full md:w-auto md:self-start md:px-6"
          style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
        >
          {salvando ? "Registrando..." : `Confirmar ${TIPO_LABEL[tipo].toLowerCase()}`}
        </button>
      </form>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3 md:flex-wrap">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:flex-wrap md:flex-1 md:min-w-[280px]">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 w-full md:w-72"
            style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
            <Search size={15} style={{ color: "var(--cor-texto-muted)" }} />
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por produto ou motivo  (/)"
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 md:contents">
            {TIPOS.map((t) => (
              <ChipFiltro key={t.valor} label={t.label} ativo={tipoFiltro === t.valor}
                onClick={() => setTipoFiltro((a) => (a === t.valor ? "" : t.valor))} />
            ))}

            {(painel?.filtros.produtos.length ?? 0) > 0 && (
              <select
                value={produtoFiltroId}
                onChange={(e) => setProdutoFiltroId(e.target.value)}
                className="rounded-md px-2.5 py-2 text-xs font-semibold border outline-none shrink-0"
                style={{
                  background: produtoFiltroId ? "rgba(16,185,129,0.14)" : "var(--cor-superficie)",
                  borderColor: produtoFiltroId ? "var(--cor-acento)" : "var(--cor-borda)",
                  color: produtoFiltroId ? "var(--cor-acento)" : "var(--cor-texto-muted)",
                }}
              >
                <option value="">Produto</option>
                {painel?.filtros.produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Lista de cards — mobile apenas */}
      <div className="flex flex-col gap-2 md:hidden">
        {carregando && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-3.5 h-16 animate-pulse" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-superficie)" }} />
        ))}
        {!carregando && itensLista.length === 0 && (
          <div className="rounded-xl border px-5 py-8 text-center text-sm" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}>
            {painel && painel.total === 0 && !buscaDebounced && !tipoFiltro
              ? "Nenhuma movimentação ainda."
              : "Nenhuma movimentação encontrada com esses filtros."}
          </div>
        )}
        {!carregando && itensLista.map((m) => <CardMovimentacao key={m.id} m={m} />)}
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
              <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Produto</th>
              <ThOrdenavel label="Tipo" campo="tipo" campoAtivo={ordenarPor} direcao={direcaoOrdenacao} onClick={alternarOrdenacao} />
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Depósito</th>
              <ThOrdenavel label="Quantidade" campo="quantidade" campoAtivo={ordenarPor} direcao={direcaoOrdenacao} onClick={alternarOrdenacao} />
              <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>Motivo</th>
              <ThOrdenavel label="Data" campo="criado_em" campoAtivo={ordenarPor} direcao={direcaoOrdenacao} onClick={alternarOrdenacao} />
            </tr>
          </thead>
          <tbody>
            {carregando && <TableSkeletonRows colunas={6} linhas={8} />}
            {!carregando && itensLista.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm" style={{ color: "var(--cor-texto-muted)" }}>
                  {painel && painel.total === 0 && !buscaDebounced && !tipoFiltro
                    ? "Nenhuma movimentação ainda."
                    : "Nenhuma movimentação encontrada com esses filtros."}
                </td>
              </tr>
            )}
            {!carregando && itensLista.map((m) => (
              <TrHover key={m.id}>
                <td className="px-5 py-3 font-medium">{m.produto_nome ?? "—"}</td>
                <td className="px-3 py-3">
                  <TipoBadge tipo={m.tipo} />
                  {m.grupo_transferencia_id && (
                    <Repeat size={11} className="inline ml-1 align-middle" style={{ color: "var(--cor-texto-muted)" }} />
                  )}
                </td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{m.deposito_nome ?? "—"}</td>
                <td className="px-3 py-3">{m.quantidade}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>{m.origem ?? "—"}</td>
                <td className="px-3 py-3" style={{ color: "var(--cor-texto-muted)" }}>
                  {new Date(m.criado_em).toLocaleString("pt-BR")}
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

function CardMovimentacao({ m }: { m: MovimentacaoListaItem }) {
  return (
    <div className="rounded-xl border p-3.5 flex flex-col gap-2" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium truncate">{m.produto_nome ?? "—"}</span>
        <div className="flex items-center gap-1 shrink-0">
          <TipoBadge tipo={m.tipo} />
          {m.grupo_transferencia_id && <Repeat size={11} style={{ color: "var(--cor-texto-muted)" }} />}
        </div>
      </div>
      <div className="flex items-center justify-between text-xs" style={{ color: "var(--cor-texto-muted)" }}>
        <span>{m.origem ?? "Sem motivo informado"}</span>
        <span>{new Date(m.criado_em).toLocaleDateString("pt-BR")}</span>
      </div>
      <div className="text-sm font-semibold">{m.quantidade} un.</div>
    </div>
  );
}

function CartaoKpi({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-xl border p-4 text-left flex flex-col gap-1" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>{titulo}</span>
      <span className="text-xl font-display font-semibold">{valor}</span>
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

function TipoBadge({ tipo }: { tipo: string }) {
  const estilo =
    tipo === "entrada"
      ? { color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }
      : tipo === "saida"
      ? { color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }
      : { color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" };
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={estilo}>{TIPO_LABEL[tipo] ?? tipo}</span>;
}
