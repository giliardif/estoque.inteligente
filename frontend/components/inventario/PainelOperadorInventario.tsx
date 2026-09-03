"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import {
  cancelarCiclo, enviarAnexoItem, enviarParaAnalise, manterDivergencia, obterPainelOperador, registrarContagemItem,
  registrarJustificativa,
} from "@/lib/api-inventario";
import { ItemOperador, LIMITE_TENTATIVAS, MotivoDivergencia, PainelOperador as PainelOperadorTipo } from "@/lib/types";
import { useToast, ConfirmDialog } from "@/components/ui";
import { Paperclip, ScanBarcode, Minus, Plus, Camera, Check } from "lucide-react";
import { ScannerCodigo } from "@/components/scanner/ScannerCodigo";
import { useLeitorFisico } from "@/lib/useLeitorFisico";

const MOTIVOS: { valor: MotivoDivergencia; label: string }[] = [
  { valor: "avaria", label: "Avaria" },
  { valor: "vencimento", label: "Vencimento" },
  { valor: "furto", label: "Furto" },
  { valor: "erro_entrada", label: "Erro de Entrada" },
];

type FiltroStatus = "todos" | "pendente" | "contados" | "divergentes";

// Itens nesse conjunto ainda podem receber uma nova tentativa de contagem.
const STATUS_EDITAVEIS = new Set(["pendente", "aguardando_confirmacao", "recontagem_solicitada"]);

export function PainelOperadorInventario({
  inventarioId,
  onEnviadoParaAnalise,
  onCancelado,
}: {
  inventarioId: string;
  onEnviadoParaAnalise: () => void;
  onCancelado: () => void;
}) {
  const { erro: toastErro, sucesso: toastSucesso } = useToast();
  const [painel, setPainel] = useState<PainelOperadorTipo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroStatus>("todos");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const [itemAguardandoDecisao, setItemAguardandoDecisao] = useState<ItemOperador | null>(null);
  const [processandoDecisao, setProcessandoDecisao] = useState(false);
  const [itemJustificativa, setItemJustificativa] = useState<ItemOperador | null>(null);
  const [confirmandoEnvio, setConfirmandoEnvio] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);
  const [cancelando, setCancelando] = useState(false);
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
      setValores(mapa);
    } catch {
      toastErro("Não foi possível carregar a contagem.");
    } finally {
      setCarregando(false);
    }
  }, [inventarioId, toastErro]);

  useEffect(() => { carregar(); }, [carregar]);

  const editavel = useCallback((item: ItemOperador) => STATUS_EDITAVEIS.has(item.status_item), []);

  function atualizarItem(produtoId: string, patch: Partial<ItemOperador>) {
    setPainel((atual) => {
      if (!atual) return atual;
      const itens = atual.itens.map((i) => (i.produto_id === produtoId ? { ...i, ...patch } : i));
      const contados = itens.filter((i) => i.status_item !== "pendente" && i.status_item !== "aguardando_confirmacao").length;
      const semDivergencia = itens.filter((i) => i.status_item === "contado" || i.status_item === "aprovado").length;
      const comDivergencia = itens.filter((i) => i.status_item === "divergente" || i.status_item === "recontagem_solicitada").length;
      return {
        ...atual,
        itens,
        progresso: { total: itens.length, contados, percentual: itens.length ? Math.round((contados / itens.length) * 1000) / 10 : 0 },
        resumo: { sem_divergencia: semDivergencia, com_divergencia: comDivergencia, pendentes: itens.length - contados - itens.filter((i) => i.status_item === "aguardando_confirmacao").length },
      };
    });
  }

  async function confirmarLinha(item: ItemOperador) {
    const valorStr = valores[item.produto_id] ?? "";
    if (valorStr === "" || Number.isNaN(Number(valorStr))) {
      toastErro("Digite uma quantidade antes de confirmar.");
      return;
    }
    setConfirmandoId(item.produto_id);
    try {
      const resultado = await registrarContagemItem(inventarioId, item.produto_id, Number(valorStr));
      atualizarItem(item.produto_id, { status_item: resultado.status_item, tentativas: resultado.tentativas, qtd_contada: Number(valorStr) });

      if (resultado.status_item === "aguardando_confirmacao") {
        setItemAguardandoDecisao({ ...item, status_item: resultado.status_item, tentativas: resultado.tentativas });
      } else if (resultado.status_item === "divergente" && resultado.limite_atingido) {
        toastErro(`Limite de ${LIMITE_TENTATIVAS} tentativas atingido — divergência registrada para análise da supervisão.`);
        setItemJustificativa({ ...item, status_item: "divergente", tentativas: resultado.tentativas });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível salvar a contagem.";
      toastErro(msg);
    } finally {
      setConfirmandoId(null);
    }
  }

  function ajustarQtd(item: ItemOperador, delta: number) {
    const atual = Number(valores[item.produto_id] ?? item.qtd_contada ?? 0);
    const novo = Math.max(0, atual + delta);
    setValores((v) => ({ ...v, [item.produto_id]: String(novo) }));
  }

  async function recontar() {
    // Recontar não chama a API — só limpa o campo pra uma nova tentativa
    // (a tentativa anterior já ficou registrada no log, independente disso).
    if (itemAguardandoDecisao) {
      setValores((v) => ({ ...v, [itemAguardandoDecisao.produto_id]: "" }));
      setTimeout(() => inputRefs.current[itemAguardandoDecisao.produto_id]?.focus(), 50);
    }
    setItemAguardandoDecisao(null);
  }

  async function manterContagemAtual() {
    if (!itemAguardandoDecisao) return;
    setProcessandoDecisao(true);
    try {
      const resultado = await manterDivergencia(inventarioId, itemAguardandoDecisao.produto_id);
      atualizarItem(itemAguardandoDecisao.produto_id, { status_item: resultado.status_item, tentativas: resultado.tentativas });
      const itemFinalizado = { ...itemAguardandoDecisao, status_item: resultado.status_item as "divergente" };
      setItemAguardandoDecisao(null);
      setItemJustificativa(itemFinalizado);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível registrar a decisão.";
      toastErro(msg);
    } finally {
      setProcessandoDecisao(false);
    }
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

  async function confirmarCancelamento() {
    setCancelando(true);
    try {
      await cancelarCiclo(inventarioId);
      toastSucesso("Ciclo cancelado.");
      setConfirmandoCancelamento(false);
      onCancelado();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Não foi possível cancelar o ciclo.";
      toastErro(msg);
    } finally {
      setCancelando(false);
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
            <div className="flex items-center gap-2">
              {painel.progresso.contados === 0 && (
                <button
                  onClick={() => setConfirmandoCancelamento(true)}
                  className="rounded-md px-3 py-2 font-semibold text-xs border"
                  style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
                >
                  Cancelar ciclo
                </button>
              )}
              <button
                onClick={() => setConfirmandoEnvio(true)}
                className="rounded-md px-3.5 py-2 font-bold text-xs"
                style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
              >
                Concluir Contagem
              </button>
            </div>
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
            editavel={editavel(item)}
            destacada={linhaDestacadaId === item.produto_id}
            valor={valores[item.produto_id] ?? ""}
            confirmando={confirmandoId === item.produto_id}
            inputRef={(el) => { inputRefs.current[item.produto_id] = el; }}
            onChange={(v) => setValores((val) => ({ ...val, [item.produto_id]: v }))}
            onAjustar={(delta) => ajustarQtd(item, delta)}
            onConfirmar={() => confirmarLinha(item)}
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
            atualizarItem(itemJustificativa.produto_id, { motivo, anexo_url: anexoUrl });
            setItemJustificativa(null);
          }}
        />
      )}

      <ConfirmDialog
        aberto={!!itemAguardandoDecisao}
        titulo="Quantidade divergente"
        descricao={
          itemAguardandoDecisao
            ? `A contagem de "${itemAguardandoDecisao.produto_nome}" não bateu (tentativa ${itemAguardandoDecisao.tentativas} de ${LIMITE_TENTATIVAS}). Deseja recontar ou manter essa contagem?`
            : undefined
        }
        labelCancelar="Recontar"
        labelConfirmar="Manter esta contagem"
        confirmando={processandoDecisao}
        onConfirmar={manterContagemAtual}
        onCancelar={recontar}
      />

      <ConfirmDialog
        aberto={confirmandoCancelamento}
        titulo="Cancelar este ciclo?"
        descricao="O ciclo será descartado — como nenhum item foi contado ainda, nada será perdido. Essa ação não pode ser desfeita."
        labelConfirmar="Cancelar ciclo"
        labelCancelar="Voltar"
        perigoso
        confirmando={cancelando}
        onConfirmar={confirmarCancelamento}
        onCancelar={() => setConfirmandoCancelamento(false)}
      />

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
  if (item.status_item === "divergente") {
    // Genérico de propósito — nunca mostra sinal/magnitude pro operador.
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>Divergente</span>;
  }
  if (item.status_item === "aguardando_confirmacao") {
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "#F59E0B", background: "rgba(245,158,11,0.16)" }}>Decidindo...</span>;
  }
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-sucesso)", background: "rgba(16,185,129,0.14)" }}>Batido</span>;
}

function LinhaItemOperador({
  item, editavel, destacada, valor, confirmando, inputRef, onChange, onAjustar, onConfirmar, onAbrirJustificativa,
}: {
  item: ItemOperador; editavel: boolean; destacada: boolean; valor: string; confirmando: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (v: string) => void; onAjustar: (delta: number) => void; onConfirmar: () => void; onAbrirJustificativa: () => void;
}) {
  const podeJustificar = item.status_item === "divergente";
  return (
    <div
      className="flex items-center justify-between gap-2 px-5 py-2.5 transition-colors flex-wrap"
      style={{ borderTop: "1px solid var(--cor-borda)", background: destacada ? "rgba(16,185,129,0.18)" : "transparent" }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{item.produto_nome}</div>
        <div className="flex items-center gap-2">
          {item.codigo_barras && <span className="text-xs font-mono" style={{ color: "var(--cor-texto-muted)" }}>{item.codigo_barras}</span>}
          {item.tentativas > 0 && item.status_item !== "contado" && (
            <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>· tentativa {item.tentativas}/3</span>
          )}
        </div>
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
          placeholder="—"
          className="rounded-md px-2 py-1 text-sm outline-none border w-16 text-center disabled:opacity-60"
          style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
        />
        <button disabled={!editavel} onClick={() => onAjustar(1)} className="w-6 h-6 rounded-md border text-sm disabled:opacity-40" style={{ borderColor: "var(--cor-borda)" }}>
          <Plus size={12} className="mx-auto" />
        </button>
        {editavel && (
          <button
            onClick={onConfirmar}
            disabled={confirmando || valor === ""}
            title="Confirmar contagem"
            className="w-7 h-7 rounded-md flex items-center justify-center disabled:opacity-40"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            <Check size={14} />
          </button>
        )}
      </div>
      <div className="w-28 text-right shrink-0">{confirmando ? <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>Salvando...</span> : <BadgeStatusItem item={item} />}</div>
      <button
        onClick={onAbrirJustificativa}
        className="shrink-0"
        style={{ color: item.motivo ? "var(--cor-acento)" : "var(--cor-texto-muted)", visibility: podeJustificar ? "visible" : "hidden" }}
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
      await registrarJustificativa(inventarioId, item.produto_id, motivo, anexoUrl);
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
          <h2 className="text-sm font-semibold">Este item ficou com divergência</h2>
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
          <button onClick={onFechar} disabled={salvando} className="rounded-md px-3.5 py-2 text-sm font-semibold border disabled:opacity-60" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}>Agora não</button>
          <button onClick={salvar} disabled={salvando} className="rounded-md px-3.5 py-2 text-sm font-bold disabled:opacity-60" style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}>
            {salvando ? "Salvando..." : "Salvar justificativa"}
          </button>
        </div>
      </div>
    </div>
  );
}
