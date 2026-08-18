"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { PainelGeral, ProdutoGiro, ProdutoCritico, MovimentacaoRecente } from "@/lib/types";
import { TableSkeletonRows } from "@/components/ui";
import {
  Package, Layers, TrendingDown, TrendingUp, Wallet, AlertTriangle, Clock, Truck,
  CalendarClock, ArrowRight, X, ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, RefreshCw,
} from "lucide-react";

const OPCOES_DIAS = [7, 30, 60, 90];

const CORES_CATEGORIA = ["var(--cor-acento)", "var(--cor-acento-soft)", "var(--cor-grafico-extra-1)", "var(--cor-aviso)", "var(--cor-grafico-neutro)", "var(--cor-grafico-extra-2)"];

export default function PainelPage() {
  const router = useRouter();
  const [dias, setDias] = useState(7);
  const [painel, setPainel] = useState<PainelGeral | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setCarregando(true);
    apiFetch<PainelGeral>(`/painel?dias=${dias}`)
      .then((p) => { setPainel(p); setErro(null); })
      .catch(() => setErro("Não foi possível carregar o painel."))
      .finally(() => setCarregando(false));
  }, [dias]);

  const saudacao = useMemo(() => saudacaoPorHorario(), []);
  const dataExtenso = useMemo(() => new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  }), []);

  const [detalhe, setDetalhe] = useState<DetalhePainel | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Painel</h1>
        <p className="text-sm mt-1.5" style={{ color: "var(--cor-texto-muted)" }}>
          <span className="font-semibold" style={{ color: "var(--cor-texto)" }}>{saudacao}.</span>
          <br />
          Aqui está o resumo da operação do seu estoque hoje.
        </p>
        <p className="text-xs mt-1 capitalize" style={{ color: "var(--cor-texto-muted)" }}>{dataExtenso}</p>
      </div>

      {erro && (
        <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--cor-alerta)", color: "var(--cor-alerta)" }}>
          {erro}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3 lg:grid-cols-5">
        <CartaoKpi icone={Package} titulo="Valor do Estoque" valor={painel ? formatarMoeda(painel.kpis.valor_total_estoque) : "—"} />
        <CartaoKpi
          icone={Layers} titulo="Produtos Cadastrados"
          valor={painel ? `${painel.kpis.produtos_cadastrados.valor}` : "—"} unidade="produtos"
          variacao={painel?.kpis.produtos_cadastrados.variacao_percentual ?? null}
        />
        <CartaoKpi
          icone={TrendingUp} titulo="Entradas (Mês)"
          valor={painel ? formatarNumero(painel.kpis.entradas_mes.valor) : "—"} unidade="un"
          variacao={painel?.kpis.entradas_mes.variacao_percentual ?? null}
        />
        <CartaoKpi
          icone={TrendingDown} titulo="Saídas (Mês)"
          valor={painel ? formatarNumero(painel.kpis.saidas_mes.valor) : "—"} unidade="un"
          variacao={painel?.kpis.saidas_mes.variacao_percentual ?? null}
        />
        <CartaoKpi
          icone={Wallet} titulo="Faturamento (Mês)"
          valor={painel ? formatarMoeda(painel.kpis.faturamento_mes.valor) : "—"}
          variacao={painel?.kpis.faturamento_mes.variacao_percentual ?? null}
        />
      </div>

      {/* Gráfico + Giro de estoque */}
      <div className="grid grid-cols-1 gap-4 items-start md:grid-cols-[1.6fr_1fr]">
        <div className="rounded-xl border p-4 md:p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-sm">Movimentações no período</h3>
            <select
              value={dias}
              onChange={(e) => setDias(Number(e.target.value))}
              className="text-xs rounded-md px-2.5 py-1.5 border"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            >
              {OPCOES_DIAS.map((d) => <option key={d} value={d}>Últimos {d} dias</option>)}
            </select>
          </div>
          {carregando || !painel ? (
            <div className="h-[210px] animate-pulse rounded-lg" style={{ background: "var(--cor-base)" }} />
          ) : (
            <GraficoMovimentacoes pontos={painel.movimentacoes_periodo} />
          )}
        </div>

        <div className="rounded-xl border p-4 md:p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-sm">Giro de Estoque (Top 5)</h3>
            <button onClick={() => router.push("/estoque")} className="text-xs font-semibold" style={{ color: "var(--cor-acento-soft)" }}>
              Ver todos
            </button>
          </div>
          {carregando || !painel ? (
            <SkeletonLista linhas={5} />
          ) : painel.giro_estoque_top5.length === 0 ? (
            <p className="text-sm py-4" style={{ color: "var(--cor-texto-muted)" }}>
              Nenhum produto com saída registrada nos últimos 30 dias.
            </p>
          ) : (
            <div className="flex flex-col">
              {painel.giro_estoque_top5.map((p) => (
                <LinhaGiro key={p.produto_id} produto={p} onClick={() => setDetalhe(detalheProdutoGiro(p))} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Alertas / Categoria / Últimas movimentações */}
      <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-3">
        <div className="rounded-xl border p-4 md:p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-sm">Alertas e Pendências</h3>
            <button onClick={() => router.push("/alertas")} className="text-xs font-semibold" style={{ color: "var(--cor-acento-soft)" }}>
              Ver todos
            </button>
          </div>
          {carregando || !painel ? (
            <SkeletonLista linhas={4} />
          ) : (
            <div className="flex flex-col">
              <LinhaAlerta icone={AlertTriangle} cor="var(--cor-alerta)" titulo="Estoque baixo"
                sub={`${painel.alertas.estoque_baixo} produto(s) com estoque abaixo do mínimo`}
                onClick={() => router.push("/alertas")} />
              <LinhaAlerta icone={Clock} cor="var(--cor-texto-muted)" titulo="Produto parado"
                sub={`${painel.alertas.produto_parado} produto(s) sem saída recente`}
                onClick={() => router.push("/alertas")} />
              <LinhaAlerta icone={Truck} cor="var(--cor-acento-soft)" titulo="Pedidos em aberto"
                sub={`${painel.alertas.pedidos_em_aberto} pedido(s) aguardando recebimento`}
                onClick={() => router.push("/compras")} />
              <LinhaAlerta icone={CalendarClock} cor="var(--cor-aviso)" titulo="Validade próxima"
                sub={`${painel.alertas.validade} produto(s) vencendo em breve`}
                onClick={() => router.push("/alertas")} />
            </div>
          )}
        </div>

        <div className="rounded-xl border p-4 md:p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <h3 className="font-display font-semibold text-sm mb-3">Estoque por Categoria</h3>
          {carregando || !painel ? (
            <div className="h-[150px] animate-pulse rounded-lg" style={{ background: "var(--cor-base)" }} />
          ) : painel.estoque_por_categoria.length === 0 ? (
            <p className="text-sm py-4" style={{ color: "var(--cor-texto-muted)" }}>Nenhum produto cadastrado ainda.</p>
          ) : (
            <DonutCategoria categorias={painel.estoque_por_categoria} totalProdutos={painel.kpis.produtos_cadastrados.valor} />
          )}
        </div>

        <div className="rounded-xl border p-4 md:p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display font-semibold text-sm">Últimas Movimentações</h3>
            <button onClick={() => router.push("/movimentacao")} className="text-xs font-semibold" style={{ color: "var(--cor-acento-soft)" }}>
              Ver todas
            </button>
          </div>
          {carregando || !painel ? (
            <SkeletonLista linhas={4} />
          ) : painel.ultimas_movimentacoes.length === 0 ? (
            <p className="text-sm py-4" style={{ color: "var(--cor-texto-muted)" }}>Nenhuma movimentação registrada ainda.</p>
          ) : (
            <div className="flex flex-col">
              {painel.ultimas_movimentacoes.map((m) => (
                <LinhaMovimentacao key={m.id} mov={m} onClick={() => setDetalhe(detalheMovimentacao(m))} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Estoque crítico */}
      <div className="rounded-xl border p-4 md:p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
        <div className="flex items-center gap-2 justify-between mb-3">
          <h3 className="font-display font-semibold text-sm flex items-center gap-2">
            Produtos com Estoque Crítico
            {painel && painel.estoque_critico.length > 0 && (
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(239,68,68,0.15)", color: "var(--cor-alerta)" }}
              >
                {painel.estoque_critico.length} {painel.estoque_critico.length === 1 ? "item" : "itens"}
              </span>
            )}
          </h3>
          <button onClick={() => router.push("/estoque")} className="text-xs font-semibold" style={{ color: "var(--cor-acento-soft)" }}>
            Ver todos
          </button>
        </div>
        {carregando || !painel ? (
          <table className="w-full text-sm"><tbody><TableSkeletonRows linhas={5} colunas={5} /></tbody></table>
        ) : painel.estoque_critico.length === 0 ? (
          <p className="text-sm py-4" style={{ color: "var(--cor-texto-muted)" }}>
            Nenhum produto abaixo do estoque mínimo no momento.
          </p>
        ) : (
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: "var(--cor-texto-muted)" }}>
                  <th className="font-semibold text-xs uppercase tracking-wide pb-2">Produto</th>
                  <th className="font-semibold text-xs uppercase tracking-wide pb-2">Categoria</th>
                  <th className="font-semibold text-xs uppercase tracking-wide pb-2">Atual / Mínimo</th>
                  <th className="font-semibold text-xs uppercase tracking-wide pb-2">Nível</th>
                  <th className="font-semibold text-xs uppercase tracking-wide pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {painel.estoque_critico.map((p) => (
                  <LinhaCritica key={p.produto_id} produto={p} onClick={() => setDetalhe(detalheProdutoCritico(p))} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!carregando && painel && painel.estoque_critico.length > 0 && (
          <div className="md:hidden flex flex-col gap-2 mt-1">
            {painel.estoque_critico.map((p) => (
              <button
                key={p.produto_id}
                onClick={() => setDetalhe(detalheProdutoCritico(p))}
                className="text-left rounded-lg p-3 flex items-center justify-between"
                style={{ background: "var(--cor-base)" }}
              >
                <div>
                  <div className="text-sm font-medium">{p.nome}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--cor-texto-muted)" }}>
                    {formatarNumero(p.saldo_atual)} / {formatarNumero(p.estoque_minimo)} un
                  </div>
                </div>
                <BadgeNivel nivel={p.nivel} />
              </button>
            ))}
          </div>
        )}
      </div>

      {detalhe && <DialogoDetalhe detalhe={detalhe} onFechar={() => setDetalhe(null)} onNavegar={(rota) => { setDetalhe(null); router.push(rota); }} />}
    </div>
  );
}

// --- Sub-componentes ---------------------------------------------------------

function SkeletonLista({ linhas = 4 }: { linhas?: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="h-10 rounded-lg animate-pulse" style={{ background: "var(--cor-base)", animationDelay: `${(i * 0.06).toFixed(2)}s` }} />
      ))}
    </div>
  );
}

function saudacaoPorHorario(): string {
  const hora = new Date().getHours();
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

function formatarMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarNumero(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function CartaoKpi({
  icone: Icone, titulo, valor, unidade, variacao,
}: { icone: typeof Package; titulo: string; valor: string; unidade?: string; variacao?: number | null }) {
  return (
    <div className="rounded-xl border p-3.5 md:p-4 flex gap-3" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "var(--cor-acento-soft)", color: "var(--cor-base)" }}
      >
        <Icone size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase leading-tight" style={{ color: "var(--cor-texto-muted)" }}>{titulo}</div>
        <div className="text-lg font-display font-semibold mt-0.5 truncate">
          {valor}
          {unidade && <span className="text-xs font-corpo font-semibold ml-1" style={{ color: "var(--cor-texto-muted)" }}>{unidade}</span>}
        </div>
        {variacao !== undefined && variacao !== null && (
          <div
            className="text-[11px] font-semibold mt-0.5 flex items-center gap-0.5"
            style={{ color: variacao >= 0 ? "var(--cor-acento-soft)" : "var(--cor-alerta)" }}
          >
            {variacao >= 0 ? "▲" : "▼"} {Math.abs(variacao).toFixed(1)}% vs mês anterior
          </div>
        )}
      </div>
    </div>
  );
}

function LinhaGiro({ produto, onClick }: { produto: ProdutoGiro; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-0.5 py-2.5 border-b text-left last:border-b-0 hover:opacity-80"
      style={{ borderColor: "var(--cor-borda)" }}
    >
      <span className="text-sm font-medium truncate">{produto.nome}</span>
      <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>
        {produto.giro_dias?.toFixed(1)} dias de giro · {formatarNumero(produto.saldo_atual)} un em estoque
      </span>
    </button>
  );
}

function LinhaAlerta({
  icone: Icone, cor, titulo, sub, onClick,
}: { icone: typeof Package; cor: string; titulo: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex gap-3 py-2.5 border-b last:border-b-0 text-left hover:opacity-80" style={{ borderColor: "var(--cor-borda)" }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--cor-base)", color: cor }}>
        <Icone size={15} />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{titulo}</div>
        <div className="text-xs mt-0.5" style={{ color: "var(--cor-texto-muted)" }}>{sub}</div>
      </div>
    </button>
  );
}

function iconeMovimentacao(tipo: string): { Icone: typeof Package; cor: string } {
  if (tipo === "entrada") return { Icone: ArrowDownCircle, cor: "var(--cor-acento-soft)" };
  if (tipo === "saida") return { Icone: ArrowUpCircle, cor: "var(--cor-alerta)" };
  if (tipo === "transferencia") return { Icone: ArrowLeftRight, cor: "var(--cor-texto-muted)" };
  // ajuste: sinal já vem resolvido no valor — ícone/cor seguem o sinal, não o tipo
  return { Icone: RefreshCw, cor: "var(--cor-aviso)" };
}

function formatarQuantidadeMovimentacao(mov: MovimentacaoRecente): string {
  // entrada/saida/transferencia sempre chegam como magnitude positiva do
  // backend (direção vem do `tipo`); só "ajuste" carrega o próprio sinal —
  // por isso não dá pra aplicar um prefixo fixo de "-" pra tudo que não é
  // entrada, senão um ajuste já negativo vira "--18" (bug real, reportado
  // pelo Giliardi).
  if (mov.tipo === "entrada") return `+${formatarNumero(mov.quantidade)} un`;
  if (mov.tipo === "saida") return `-${formatarNumero(mov.quantidade)} un`;
  if (mov.tipo === "ajuste") {
    const sinal = mov.quantidade > 0 ? "+" : mov.quantidade < 0 ? "-" : "";
    return `${sinal}${formatarNumero(Math.abs(mov.quantidade))} un`;
  }
  return `${formatarNumero(mov.quantidade)} un`; // transferência: magnitude só, sem sinal forçado
}

function LinhaMovimentacao({ mov, onClick }: { mov: MovimentacaoRecente; onClick: () => void }) {
  const { Icone, cor } = iconeMovimentacao(mov.tipo);
  return (
    <button onClick={onClick} className="flex items-center gap-3 py-2.5 border-b last:border-b-0 text-left hover:opacity-80" style={{ borderColor: "var(--cor-borda)" }}>
      <Icone size={22} style={{ color: cor }} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold truncate">{mov.produto_nome}</div>
        <div className="text-xs mt-0.5 truncate" style={{ color: "var(--cor-texto-muted)" }}>{mov.origem || rotuloTipo(mov.tipo)}</div>
      </div>
      <div className="text-xs font-bold shrink-0" style={{ color: cor }}>
        {formatarQuantidadeMovimentacao(mov)}
      </div>
    </button>
  );
}

function rotuloTipo(tipo: string): string {
  return { entrada: "Entrada", saida: "Saída", ajuste: "Ajuste", transferencia: "Transferência" }[tipo] ?? tipo;
}

function BadgeNivel({ nivel }: { nivel: "critico" | "baixo" }) {
  const critico = nivel === "critico";
  return (
    <span
      className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0"
      style={critico ? { background: "rgba(239,68,68,0.15)", color: "var(--cor-alerta)" } : { background: "rgba(245,158,11,0.15)", color: "var(--cor-aviso)" }}
    >
      {critico ? "Crítico" : "Baixo"}
    </span>
  );
}

function LinhaCritica({ produto, onClick }: { produto: ProdutoCritico; onClick: () => void }) {
  const percentual = produto.estoque_minimo > 0 ? Math.min(100, (produto.saldo_atual / produto.estoque_minimo) * 100) : 0;
  return (
    <tr onClick={onClick} className="cursor-pointer hover:opacity-80" style={{ borderTop: "1px solid var(--cor-borda)" }}>
      <td className="py-2.5 text-sm font-medium">{produto.nome}</td>
      <td className="py-2.5 text-sm" style={{ color: "var(--cor-texto-muted)" }}>{produto.categoria_nome || "Sem categoria"}</td>
      <td className="py-2.5 text-sm" style={{ color: "var(--cor-texto-muted)" }}>
        {formatarNumero(produto.saldo_atual)} un / {formatarNumero(produto.estoque_minimo)} un
      </td>
      <td className="py-2.5">
        <div className="w-[90px] h-1.5 rounded-full overflow-hidden" style={{ background: "var(--cor-base)" }}>
          <div className="h-full rounded-full" style={{ width: `${percentual}%`, background: produto.nivel === "critico" ? "var(--cor-alerta)" : "var(--cor-aviso)" }} />
        </div>
      </td>
      <td className="py-2.5"><BadgeNivel nivel={produto.nivel} /></td>
    </tr>
  );
}

function DonutCategoria({ categorias, totalProdutos }: { categorias: { categoria_id: string | null; nome: string; produtos: number; percentual: number }[]; totalProdutos: number }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  let acumulado = 0;
  const raio = 15.9;
  const centro = ativo !== null ? categorias[ativo] : null;

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-[130px] h-[130px] shrink-0">
        <svg viewBox="0 0 36 36" className="w-full h-full">
          <circle cx="18" cy="18" r={raio} fill="none" stroke="var(--cor-base)" strokeWidth="4" />
          {categorias.map((c, i) => {
            const offset = -acumulado;
            acumulado += c.percentual;
            return (
              <circle
                key={c.categoria_id ?? c.nome}
                cx="18" cy="18" r={raio} fill="none"
                stroke={CORES_CATEGORIA[i % CORES_CATEGORIA.length]}
                strokeWidth="4"
                strokeDasharray={`${c.percentual} ${100 - c.percentual}`}
                strokeDashoffset={offset + 25}
                transform="rotate(-90 18 18)"
                style={{ cursor: "pointer", opacity: ativo === null || ativo === i ? 1 : 0.35, transition: "opacity .15s" }}
                onMouseEnter={() => setAtivo(i)}
                onMouseLeave={() => setAtivo(null)}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-lg font-display font-semibold">{centro ? centro.produtos : totalProdutos}</div>
          <div className="text-[10px]" style={{ color: "var(--cor-texto-muted)" }}>{centro ? centro.nome : "produtos"}</div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 text-xs flex-1 min-w-0">
        {categorias.map((c, i) => (
          <div
            key={c.categoria_id ?? c.nome}
            className="flex items-center justify-between gap-2 cursor-pointer rounded px-1 py-0.5"
            onMouseEnter={() => setAtivo(i)}
            onMouseLeave={() => setAtivo(null)}
            style={{ background: ativo === i ? "var(--cor-base)" : "transparent" }}
          >
            <span className="flex items-center gap-1.5 truncate" style={{ color: "var(--cor-texto-muted)" }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CORES_CATEGORIA[i % CORES_CATEGORIA.length] }} />
              <span className="truncate">{c.nome}</span>
            </span>
            <span className="font-semibold shrink-0">{c.percentual.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GraficoMovimentacoes({ pontos }: { pontos: { data: string; entradas: number; saidas: number }[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const n = pontos.length;
  const maxVal = Math.max(1, ...pontos.map((p) => Math.max(p.entradas, p.saidas)));
  const x0 = 30, x1 = 580, y0 = 180, y1 = 10;

  function xAt(i: number) { return n <= 1 ? x0 : x0 + ((x1 - x0) * i) / (n - 1); }
  function yAt(v: number) { return y0 - ((v / maxVal) * (y0 - y1)); }

  const pontosEntradas = pontos.map((p, i) => `${xAt(i)},${yAt(p.entradas)}`).join(" ");
  const pontosSaidas = pontos.map((p, i) => `${xAt(i)},${yAt(p.saidas)}`).join(" ");
  const areaEntradas = `${pontosEntradas} ${xAt(n - 1)},${y0} ${xAt(0)},${y0}`;

  const passoLabel = Math.max(1, Math.ceil(n / 7));

  function formatarDataCurta(iso: string): string {
    const [, m, d] = iso.split("-");
    return `${d}/${m}`;
  }

  function aoMoverMouse(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const xRelativo = ((e.clientX - rect.left) / rect.width) * 600;
    const passo = n <= 1 ? 1 : (x1 - x0) / (n - 1);
    const idx = Math.round((xRelativo - x0) / passo);
    setHoverIdx(Math.min(n - 1, Math.max(0, idx)));
  }

  const ponto = hoverIdx !== null ? pontos[hoverIdx] : null;

  return (
    <div className="relative">
      <div className="flex items-center gap-4 text-xs mb-2" style={{ color: "var(--cor-texto-muted)" }}>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "var(--cor-acento-soft)" }} />Entradas</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "var(--cor-grafico-neutro)" }} />Saídas</span>
      </div>
      <svg viewBox="0 0 600 210" width="100%" height="210" onMouseMove={aoMoverMouse} onMouseLeave={() => setHoverIdx(null)}>
        <defs>
          <linearGradient id="gradEntradasPainel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--cor-acento-soft)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--cor-acento-soft)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={x0} y1={y1} x2={x0} y2={y0} stroke="var(--cor-borda)" />
        <line x1={x0} y1={y0} x2={x1} y2={y0} stroke="var(--cor-borda)" />
        <polygon points={areaEntradas} fill="url(#gradEntradasPainel)" />
        <polyline points={pontosEntradas} fill="none" stroke="var(--cor-acento-soft)" strokeWidth="2.5" />
        <polyline points={pontosSaidas} fill="none" stroke="var(--cor-grafico-neutro)" strokeWidth="2.5" />
        {hoverIdx !== null && (
          <line x1={xAt(hoverIdx)} y1={y1} x2={xAt(hoverIdx)} y2={y0} stroke="rgba(243,244,246,0.15)" />
        )}
        {pontos.map((p, i) => (
          i % passoLabel === 0 && (
            <text key={p.data} x={xAt(i)} y="197" fontSize="10" fill="var(--cor-texto-muted)" textAnchor="middle">
              {formatarDataCurta(p.data)}
            </text>
          )
        ))}
      </svg>
      {ponto && hoverIdx !== null && (
        <div
          className="absolute pointer-events-none rounded-lg border px-3 py-2 text-xs whitespace-nowrap"
          style={{
            background: "var(--cor-base)", borderColor: "var(--cor-borda)",
            left: `${(xAt(hoverIdx) / 600) * 100}%`, top: `${(Math.min(yAt(ponto.entradas), yAt(ponto.saidas)) / 210) * 100}%`,
            transform: "translate(-50%, -115%)",
          }}
        >
          <div className="font-bold mb-1">{formatarDataCurta(ponto.data)}</div>
          <div style={{ color: "var(--cor-acento-soft)" }}>Entradas: {formatarNumero(ponto.entradas)} un</div>
          <div style={{ color: "var(--cor-grafico-neutro)" }}>Saídas: {formatarNumero(ponto.saidas)} un</div>
        </div>
      )}
    </div>
  );
}

// --- Popup de detalhe rápido (prévia + link pra tela completa) --------------

type DetalhePainel = { titulo: string; linhas: [string, string][]; rota: string; labelBotao: string };

function detalheProdutoGiro(p: ProdutoGiro): DetalhePainel {
  return {
    titulo: p.nome, rota: "/estoque", labelBotao: "Ver na tela de Estoque",
    linhas: [
      ["Saldo atual", `${formatarNumero(p.saldo_atual)} un`],
      ["Giro médio", p.giro_dias !== null ? `${p.giro_dias.toFixed(1)} dias` : "—"],
    ],
  };
}

function detalheProdutoCritico(p: ProdutoCritico): DetalhePainel {
  return {
    titulo: p.nome, rota: "/compras", labelBotao: "Gerar pedido de compra",
    linhas: [
      ["Categoria", p.categoria_nome || "Sem categoria"],
      ["Estoque atual", `${formatarNumero(p.saldo_atual)} un`],
      ["Estoque mínimo", `${formatarNumero(p.estoque_minimo)} un`],
      ["Nível", p.nivel === "critico" ? "Crítico" : "Baixo"],
    ],
  };
}

function detalheMovimentacao(m: MovimentacaoRecente): DetalhePainel {
  return {
    titulo: rotuloTipo(m.tipo), rota: "/movimentacao", labelBotao: "Ver movimentação completa",
    linhas: [
      ["Produto", m.produto_nome],
      ["Quantidade", formatarQuantidadeMovimentacao(m)],
      ["Origem", m.origem || "—"],
      ["Data", new Date(m.criado_em).toLocaleString("pt-BR")],
    ],
  };
}

function DialogoDetalhe({
  detalhe, onFechar, onNavegar,
}: { detalhe: DetalhePainel; onFechar: () => void; onNavegar: (rota: string) => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") onFechar(); }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4" style={{ background: "rgba(5,10,20,0.6)" }} onClick={onFechar}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border p-5 flex flex-col gap-3 shadow-xl"
        style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold font-display">{detalhe.titulo}</h2>
          <button onClick={onFechar} style={{ color: "var(--cor-texto-muted)" }}><X size={18} /></button>
        </div>
        <div className="flex flex-col text-sm">
          {detalhe.linhas.map(([k, v]) => (
            <div key={k} className="flex justify-between py-2 border-b last:border-b-0" style={{ borderColor: "var(--cor-borda)" }}>
              <span style={{ color: "var(--cor-texto-muted)" }}>{k}</span>
              <span className="font-semibold">{v}</span>
            </div>
          ))}
        </div>
        <button
          onClick={() => onNavegar(detalhe.rota)}
          className="mt-1 rounded-md px-3.5 py-2.5 text-sm font-bold flex items-center justify-center gap-2"
          style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
        >
          {detalhe.labelBotao} <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
