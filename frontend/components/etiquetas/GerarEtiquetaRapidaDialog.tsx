"use client";

import { useMemo, useRef, useState } from "react";
import { X, Printer } from "lucide-react";
import { EtiquetaConfig, ItemProdutoLista } from "@/lib/types";
import { EtiquetaLabel } from "./EtiquetaLabel";
import { EnviarParaEstacaoBotao } from "@/components/estacoes/EnviarParaEstacaoBotao";
import { useQzTray } from "@/lib/useQzTray";

type Props = {
  produto: ItemProdutoLista;
  onFechar: () => void;
};

const CONFIG_RAPIDA: EtiquetaConfig = {
  elementos: { nome: true, sku: true, preco: true, marca: false },
  tipoCodigo: "barras",
  tamanho: "40x30",
  colunas: 1,
  margemMm: 2,
  espacamentoMm: 2,
  modoImpressao: "navegador",
  impressora: "",
};

/**
 * Caso de uso de 1 produto só, sem precisar ir pra tela Etiquetas em
 * lote — reaproveita o mesmo EtiquetaLabel, só que com um formulário
 * mínimo (tipo de código + cópias) em vez do configurador completo.
 *
 * Duas formas de imprimir: "Neste dispositivo" (diálogo de impressão do
 * navegador, como sempre foi) ou "Enviar pra uma estação" (fila mediada
 * pelo backend — o caminho pra celular ou qualquer PC sem impressora
 * conectada, Etapa 36). O padrão inicial segue o que o QZ Tray detecta
 * nesta máquina: se detectado, provavelmente é um PC de balcão com
 * impressora local; senão, é mais provável que seja mobile.
 */
export function GerarEtiquetaRapidaDialog({ produto, onFechar }: Props) {
  const [tipoCodigo, setTipoCodigo] = useState<EtiquetaConfig["tipoCodigo"]>("barras");
  const [copias, setCopias] = useState(1);
  const gradeRef = useRef<HTMLDivElement>(null);
  const { status: statusQzTray } = useQzTray();
  const [destino, setDestino] = useState<"dispositivo" | "estacao">("dispositivo");

  const config = useMemo<EtiquetaConfig>(() => ({ ...CONFIG_RAPIDA, tipoCodigo }), [tipoCodigo]);

  // Ajusta o padrão uma vez, assim que soubermos se este dispositivo tem
  // QZ Tray local — não sobrescreve se a pessoa já trocou manualmente.
  const [destinoAjustado, setDestinoAjustado] = useState(false);
  if (!destinoAjustado && statusQzTray === "indisponivel") {
    setDestino("estacao");
    setDestinoAjustado(true);
  } else if (!destinoAjustado && statusQzTray === "conectado") {
    setDestinoAjustado(true);
  }

  function imprimir() {
    window.print();
  }

  function montarHtmlParaFila(): string {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;font-family:Inter,Arial,sans-serif;}
      .grade{display:grid;grid-template-columns:repeat(2,1fr);gap:2mm;padding:4mm;}
    </style></head><body><div class="grade">${gradeRef.current?.innerHTML ?? ""}</div></body></html>`;
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-4 print:hidden"
      style={{ background: "rgba(4,8,16,0.7)" }}
      onClick={onFechar}
    >
      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          #grade-etiqueta-rapida, #grade-etiqueta-rapida * { visibility: visible; }
          #grade-etiqueta-rapida {
            display: grid !important;
            position: absolute; left: 0; top: 0; width: 100%; padding: 4mm;
            grid-template-columns: repeat(2, 1fr); gap: 2mm;
          }
        }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border overflow-hidden shadow-xl"
        style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--cor-borda)" }}>
          <h3 className="text-sm font-semibold">Gerar etiqueta</h3>
          <button onClick={onFechar} aria-label="Fechar" className="opacity-70 hover:opacity-100">
            <X size={16} />
          </button>
        </div>

        <div className="p-4">
          <div className="flex justify-center mb-4">
            <div className="w-40">
              <EtiquetaLabel produto={produto} config={config} />
            </div>
          </div>

          <div className="mb-3">
            <label className="text-xs font-semibold block mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>Tipo de código</label>
            <div className="flex gap-1.5">
              {(["barras", "qr"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTipoCodigo(t)}
                  className="flex-1 rounded-md border py-1.5 text-xs font-semibold"
                  style={tipoCodigo === t
                    ? { background: "rgba(16,185,129,0.14)", borderColor: "var(--cor-acento)", color: "var(--cor-acento)" }
                    : { borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
                >
                  {t === "barras" ? "Código de barras" : "QR Code"}
                </button>
              ))}
            </div>
            {!produto.codigo_barras && tipoCodigo === "barras" && (
              <p className="text-[10.5px] mt-1.5" style={{ color: "var(--cor-alerta)" }}>
                Este produto não tem código de barras cadastrado — a etiqueta sai com QR (usando o ID do produto) mesmo com essa opção selecionada.
              </p>
            )}
          </div>

          <div className="mb-4">
            <label className="text-xs font-semibold block mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>Cópias</label>
            <input
              type="number" min={1} value={copias}
              onChange={(e) => setCopias(Math.max(1, Number(e.target.value) || 1))}
              className="w-full rounded-md border px-2.5 py-1.5 text-sm outline-none"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            />
          </div>

          <div className="mb-3 flex gap-1.5">
            {(["dispositivo", "estacao"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDestino(d)}
                className="flex-1 rounded-md border py-1.5 text-xs font-semibold"
                style={
                  destino === d
                    ? { background: "rgba(16,185,129,0.14)", borderColor: "var(--cor-acento)", color: "var(--cor-acento)" }
                    : { borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }
                }
              >
                {d === "dispositivo" ? "Neste dispositivo" : "Enviar pra estação"}
              </button>
            ))}
          </div>

          {destino === "dispositivo" ? (
            <button
              onClick={imprimir}
              className="w-full flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-bold"
              style={{ background: "var(--cor-acento)", color: "#06231a" }}
            >
              <Printer size={14} /> Imprimir
            </button>
          ) : (
            <EnviarParaEstacaoBotao
              titulo={produto.nome}
              quantidade={copias}
              produtoId={produto.id}
              obterHtml={montarHtmlParaFila}
            />
          )}
        </div>
      </div>

      {/* Grade real de impressão (fora da visibilidade normal, some no @media print) */}
      <div id="grade-etiqueta-rapida" ref={gradeRef} className="hidden">
        {Array.from({ length: copias }).map((_, i) => (
          <EtiquetaLabel key={i} produto={produto} config={config} />
        ))}
      </div>
    </div>
  );
}
