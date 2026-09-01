"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import {
  enviarAnexoItem, enviarParaAnalise, obterPainelOperador, registrarContagemItem,
} from "@/lib/api-inventario";
import { ItemOperador, MotivoDivergencia, PainelOperador as PainelOperadorTipo } from "@/lib/types";
import { useToast, ConfirmDialog } from "@/components/ui";
import { Paperclip, ScanBarcode, Minus, Plus, Camera } from "lucide-react";
import { ScannerCodigo } from "@/components/scanner/ScannerCodigo";
import { useLeitorFisico } from "@/lib/useLeitorFisico";

const MOTIVOS: { valor: MotivoDivergencia; label: string }[] = [
  { valor: "avaria", label: "Avaria" },
  { valor: "vencimento", label: "Vencimento" },
  { valor: "furto", label: "Furto" },
  { valor: "erro_entrada", label: "Erro de Entrada" },
];

type FiltroStatus = "todos" | "pendente" | "contados" | "divergentes";

export function PainelOperadorInventario({
  inventarioId,
  onEnviadoParaAnalise,
}: {
  inventarioId: string;
  onEnviadoParaAnalise: () => void;
}) {
  const { erro: toastErro, sucesso: toastSucesso } = useToast();
  const [painel, setPainel] = useState<PainelOperadorTipo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroStatus>("todos");
  const [contagemLocal, setContagemLocal] = useState<Record<string, string>>({});
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const [itemJustificativa, setItemJustificativa] = useState<ItemOperador | null>(null);
  const [confirmandoEnvio, setConfirmandoEnvio] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [scannerAberto, setScannerAberto] = useState(false);
  const [linhaDestacadaId, setLinhaDestacadaId] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const dados = await obterPainelOperador(inventarioId);
      setPainel(dados);
      const mapa: Record<string, string> = {};
      dados.itens.forEach((i) => { if (i.qtd_contada !== null) mapa[i.produto_id] = String(i.qtd_contada); });
      setContagemLocal(mapa);
    } catch {
      toastErro("Não foi possível carregar a contagem.");
    } finally {
      setCarregando(false);
    }
  }, [inventarioId, toastErro]);

  useEffect(() => { carregar(); }, [carregar]);

  const podeContarItem = useCallback(
    (item: ItemOperador) => {
      if (!painel) return false;
      if (painel.inventario.status === "aberto") return true;
      return painel.inventario.status === "em_analise" && item.status_item === "recontagem_solicitada";
    },
    [painel]
  );

  async function salvarContagem(item: ItemOperador, qtdStr: string) {
    if (qtdStr === "" || Number.isNaN(Number(qtdStr))) return;
    setSalvandoId(item.produto_id);
    try {
      const resultado = await registrarContagemItem(inventarioId, item.produto_id, { qtd_contada: Number(qtdStr) });
      setPainel((atual) => {
        if (!atual) return atual;
        const itens = atual.itens.map((i) =>
          i.produto_id === item.produto_id
            ? { ...i, qtd_contada: resultado.qtd_contada, divergencia: resultado.divergencia, status_item: resultado.status_item }
            : i
        );
        const contados = itens.filter((i) => i.status_item !== "pendente").length;
        const semDivergencia = itens.filter((i) => i.status_item === "contado" || i.status_item === "aprovado").length;
        const comDivergencia = itens.filter((i) => i.status_item === "divergente" || i.status_item === "recontagem_solicitada").length;
        return {
          ...atual,
          itens,
          progresso: { total: itens.length, contados, percentual: itens.length ? Math.round((contados / itens.length) * 1000) / 10 : 0 },
          resumo: { sem_divergencia: semDivergencia, com_divergencia: comDivergencia, pendentes: itens.length - contados },
        };
      });
      if (resultado.status_item === "divergente" && !item.motivo) {
        setItemJustificativa({ ...item, qtd_contada: resultado.qtd_contada, divergencia: resultado.divergencia, status_item: resultado.status_item });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível salvar a contagem.";
      toastErro(msg);
    } finally {
      setSalvandoId(null);
    }
  }

  function ajustarQtd(item: ItemOperador, delta: number) {
    const atual = Number(contagemLocal[item.produto_id] ?? item.qtd_contada ?? 0);
    const novo = Math.max(0, atual + delta);
    setContagemLocal((c) => ({ ...c, [item.produto_id]: String(novo) }));
    salvarContagem(item, String(novo));
  }

  function localizarProduto(produtoId: string) {
    setLinhaDestacadaId(produtoId);
    setTimeout(() => {
      inputRefs.current[produtoId]?.scrollIntoView({ behavior: "smooth", block: "center" });
      inputRefs.current[produtoId]?.focus();
    }, 50);
    setTimeout(() => setLinhaDestacadaId((a) => (a === produtoId ? null : a)), 900);
  }

  const buscarELocalizar = useCallback(async (codigo: string) => {
    const item = painel?.itens.find((i) => i.codigo_barras === codigo);
    if (item) localizarProduto(item.produto_id);
    else toastErro("Nenhum item deste ciclo encontrado para esse código.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painel, toastErro]);

  useLeitorFisico(buscarELocalizar);

  const itensFiltrados = useMemo(() => {
    if (!painel) return [];
    let lista = painel.itens;
    if (filtro === "pendente") lista = lista.filter((i) => i.status_item === "pendente");
    else if (filtro === "contados") lista = lista.filter((i) => i.status_item === "contado" || i.status_item === "aprovado");
    else if (filtro === "divergentes") lista = lista.filter((i) => i.status_item === "divergente" || i.status_item === "recontagem_solicitada");
    if (busca.trim()) {
      const termo = busca.trim().toLowerCase();
      lista = lista.filter(
        (i) => i.produto_nome.toLowerCase().includes(termo)
          || (i.codigo_barras ?? "").toLowerCase().includes(termo)
          || (i.categoria_nome ?? "").toLowerCase().includes(termo)
      );
    }
    return lista;
  }, [painel, filtro, busca]);

  const qtdDivergentes = painel?.itens.filter((i) => i.status_item === "divergente" || i.status_item === "recontagem_solicitada").length ?? 0;

  async function confirmarEnvioParaAnalise() {
    setEnviando(true);
    try {
      await enviarParaAnalise(inventarioId);
      toastSucesso("Contagem enviada para análise da supervisão.");
      setConfirmandoEnvio(false);
      onEnviadoParaAnalise();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível enviar para análise.";
      toastErro(msg);
    } finally {
      setEnviando(false);
    }
  }

  if (carregando && !painel) {
    return <div className="rounded-xl border p-8 text-center text-sm" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}>Carregando contagem...</div>;
  }
  if (!painel) return null;

  const emAnalise = painel.inventario.status === "em_analise";

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
      <div className="px-5 py-3.5 border-b" style={{ borderColor: "var(--cor-borda)" }}>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="font-display font-semibold text-sm">
            Inventário — Ciclo {painel.inventario.ciclo} {emAnalise && <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "#F59E0B", background: "rgba(245,158,11,0.16)" }}>Aguardando aprovação</span>}
          </h3>
          {!emAnalise && (
            <button
              onClick={() => setConfirmandoEnvio(true)}
              className="rounded-md px-3.5 py-2 font-bold text-xs"
              style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
            >
              Concluir Contagem
            </button>
          )}
        </div>
        <div className="flex justify-between text-xs font-semibold mb-1.5">
          <span>Progresso da contagem</span>
          <span>{painel.progresso.contados} / {painel.progresso.total} itens — {painel.progresso.percentual}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div className="h-full rounded-full" style={{ width: `${painel.progresso.percentual}%`, background: "linear-gradient(90deg, var(--cor-acento-soft, var(--cor-acento)), var(--cor-acento))" }} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5 p-3.5">
        <ResumoCard cor="var(--cor-sucesso)" bg="rgba(16,185,129,0.14)" numero={painel.resumo.sem_divergencia} label="Sem divergência" />
        <ResumoCard cor="var(--cor-alerta)" bg="rgba(162,59,59,0.14)" numero={painel.resumo.com_divergencia} label="Com divergência" />
        <ResumoCard cor="var(--cor-texto-muted)" bg="rgba(138,127,115,0.14)" numero={painel.resumo.pendentes} label="Pendentes" />
      </div>

      <div className="px-3.5 pb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 overflow-x-auto">
          {(["todos", "pendente", "contados", "divergentes"] as FiltroStatus[]).map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className="rounded-md px-3 py-1.5 text-xs font-semibold border whitespace-nowrap relative"
              style={filtro === f
                ? { background: "rgba(16,185,129,0.14)", borderColor: "var(--cor-acento)", color: "var(--cor-acento)" }
                : { background: "transparent", borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
            >
              {{ todos: "Todos", pendente: "Pendente", contados: "Contados", divergentes: "Divergentes" }[f]}
              {f === "divergentes" && qtdDivergentes > 0 && (
                <span className="absolute -top-1.5 -right-1.5 text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center" style={{ background: "var(--cor-alerta)", color: "#fff" }}>
                  {qtdDivergentes}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => setScannerAberto(true)}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold"
          style={{ background: "var(--cor-acento)", color: "#06231a" }}
        >
          <ScanBarcode size={13} /> Escanear
        </button>
      </div>

      <div className="mx-3.5 mb-3 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)" }}>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, EAN ou categoria..."
          className="bg-transparent outline-none text-sm w-full"
        />
      </div>

      <div className="flex flex-col">
        {itensFiltrados.length === 0 && (
          <div className="text-center text-sm py-8" style={{ color: "var(--cor-texto-muted)" }}>Nenhum item encontrado.</div>
        )}
        {itensFiltrados.map((item) => (
          <LinhaItemOperador
            key={item.produto_id}
            item={item}
            editavel={podeContarItem(item)}
            destacada={linhaDestacadaId === item.produto_id}
            valor={contagemLocal[item.produto_id] ?? ""}
            salvando={salvandoId === item.produto_id}
            inputRef={(el) => { inputRefs.current[item.produto_id] = el; }}
            onChange={(v) => setContagemLocal((c) => ({ ...c, [item.produto_id]: v }))}
            onBlurSalvar={() => salvarContagem(item, contagemLocal[item.produto_id] ?? "")}
            onAjustar={(delta) => ajustarQtd(item, delta)}
            onAbrirJustificativa={() => setItemJustificativa(item)}
          />
        ))}
      </div>

      <ScannerCodigo
        aberto={scannerAberto}
        onFechar={() => setScannerAberto(false)}
        onProdutoEncontrado={(p) => { setScannerAberto(false); localizarProduto(p.id); }}
      />

      {itemJustificativa && (
        <ModalJustificativa
          item={itemJustificativa}
          inventarioId={inventarioId}
          onFechar={() => setItemJustificativa(null)}
          onSalvo={(motivo, anexoUrl) => {
            setPainel((atual) => atual ? { ...atual, itens: atual.itens.map((i) => i.produto_id === itemJustificativa.produto_id ? { ...i, motivo, anexo_url: anexoUrl } : i) } : atual);
            setItemJustificativa(null);
          }}
        />
      )}

      <ConfirmDialog
        aberto={confirmandoEnvio}
        titulo="Concluir contagem?"
        descricao={`Você tem certeza que deseja finalizar a contagem deste ciclo? ${painel.progresso.total - painel.progresso.contados} item(ns) ainda estão pendentes. Os dados serão enviados para análise da supervisão.`}
        labelConfirmar="Confirmar e enviar"
        confirmando={enviando}
        onConfirmar={confirmarEnvioParaAnalise}
        onCancelar={() => setConfirmandoEnvio(false)}
      />
    </div>
  );
}

function ResumoCard({ cor, bg, numero, label }: { cor: string; bg: string; numero: number; label: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: bg }}>
      <div className="text-xl font-display font-bold" style={{ color: cor }}>{numero}</div>
      <div className="text-xs" style={{ color: cor }}>{label}</div>
    </div>
  );
}

function BadgeStatusItem({ item }: { item: ItemOperador }) {
  if (item.status_item === "pendente") {
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }}>Pendente</span>;
  }
  if (item.status_item === "recontagem_solicitada") {
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "#F59E0B", background: "rgba(245,158,11,0.16)" }}>Recontar</span>;
  }
  if (item.status_item === "aprovado") {
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-sucesso)", background: "rgba(16,185,129,0.14)" }}>Ajuste aprovado</span>;
  }
  const div = item.divergencia ?? 0;
  if (div === 0) {
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-sucesso)", background: "rgba(16,185,129,0.14)" }}>Batido</span>;
  }
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
      {div > 0 ? `Sobra +${div}` : `Perda ${div}`}
    </span>
  );
}

function LinhaItemOperador({
  item, editavel, destacada, valor, salvando, inputRef, onChange, onBlurSalvar, onAjustar, onAbrirJustificativa,
}: {
  item: ItemOperador; editavel: boolean; destacada: boolean; valor: string; salvando: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (v: string) => void; onBlurSalvar: () => void; onAjustar: (delta: number) => void; onAbrirJustificativa: () => void;
}) {
  const temJustificativa = item.status_item === "divergente" || item.status_item === "recontagem_solicitada" || item.status_item === "aprovado";
  return (
    <div
      className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors"
      style={{ borderTop: "1px solid var(--cor-borda)", background: destacada ? "rgba(16,185,129,0.18)" : "transparent" }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{item.produto_nome}</div>
        {item.codigo_barras && <div className="text-xs font-mono" style={{ color: "var(--cor-texto-muted)" }}>{item.codigo_barras}</div>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button disabled={!editavel} onClick={() => onAjustar(-1)} className="w-6 h-6 rounded-md border text-sm disabled:opacity-40" style={{ borderColor: "var(--cor-borda)" }}>
          <Minus size={12} className="mx-auto" />
        </button>
        <input
          ref={inputRef}
          type="number" min="0" step="0.01"
          disabled={!editavel}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlurSalvar}
          placeholder="—"
          className="rounded-md px-2 py-1 text-sm outline-none border w-16 text-center disabled:opacity-60"
          style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
        />
        <button disabled={!editavel} onClick={() => onAjustar(1)} className="w-6 h-6 rounded-md border text-sm disabled:opacity-40" style={{ borderColor: "var(--cor-borda)" }}>
          <Plus size={12} className="mx-auto" />
        </button>
      </div>
      <div className="w-28 text-right shrink-0">{salvando ? <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>Salvando...</span> : <BadgeStatusItem item={item} />}</div>
      <button
        onClick={onAbrirJustificativa}
        className="shrink-0"
        style={{ color: item.motivo ? "var(--cor-acento)" : "var(--cor-texto-muted)", visibility: temJustificativa || item.status_item === "divergente" ? "visible" : "hidden" }}
        title={item.motivo ? "Justificativa registrada" : "Justificar divergência"}
      >
        <Paperclip size={15} />
      </button>
    </div>
  );
}

function ModalJustificativa({
  item, inventarioId, onFechar, onSalvo,
}: {
  item: ItemOperador; inventarioId: string; onFechar: () => void;
  onSalvo: (motivo: MotivoDivergencia | null, anexoUrl: string | null) => void;
}) {
  const { erro: toastErro } = useToast();
  const [motivo, setMotivo] = useState<MotivoDivergencia>(item.motivo ?? "erro_entrada");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      let anexoUrl: string | null = item.anexo_url;
      if (arquivo) anexoUrl = await enviarAnexoItem(inventarioId, item.produto_id, arquivo);
      await registrarContagemItem(inventarioId, item.produto_id, {
        qtd_contada: item.qtd_contada ?? 0, motivo, anexo_url: anexoUrl,
      });
      onSalvo(motivo, anexoUrl);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível salvar a justificativa.";
      toastErro(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4" style={{ background: "rgba(10,8,6,0.55)" }} onClick={onFechar}>
      <div className="w-full max-w-sm rounded-xl border p-5 flex flex-col gap-3" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }} onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-sm font-semibold">Justificar divergência</h2>
          <p className="text-sm mt-1" style={{ color: "var(--cor-texto-muted)" }}>{item.produto_nome}</p>
        </div>
        <label className="text-xs font-semibold flex flex-col gap-1" style={{ color: "var(--cor-texto-muted)" }}>
          Motivo
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value as MotivoDivergencia)}
            className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
          >
            {MOTIVOS.map((m) => <option key={m.valor} value={m.valor}>{m.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold flex flex-col gap-1" style={{ color: "var(--cor-texto-muted)" }}>
          Foto do item / prateleira (opcional)
          <div className="rounded-md border border-dashed px-3 py-4 flex items-center justify-center gap-2 text-sm cursor-pointer relative" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}>
            <Camera size={15} />
            {arquivo ? arquivo.name : "Tirar foto ou anexar imagem"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
          </div>
        </label>
        <div className="flex justify-end gap-2 mt-1">
          <button onClick={onFechar} disabled={salvando} className="rounded-md px-3.5 py-2 text-sm font-semibold border disabled:opacity-60" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="rounded-md px-3.5 py-2 text-sm font-bold disabled:opacity-60" style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}>
            {salvando ? "Salvando..." : "Salvar justificativa"}
          </button>
        </div>
      </div>
    </div>
  );
}
