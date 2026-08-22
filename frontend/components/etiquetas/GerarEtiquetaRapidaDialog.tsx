"use client";

import { useMemo, useRef, useState } from "react";
import { X, Printer } from "lucide-react";
import { EtiquetaConfig, ItemProdutoLista } from "@/lib/types";
import { EtiquetaLabel } from "./EtiquetaLabel";

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
 */
export function GerarEtiquetaRapidaDialog({ produto, onFechar }: Props) {
  const [tipoCodigo, setTipoCodigo] = useState<EtiquetaConfig["tipoCodigo"]>("barras");
  const [copias, setCopias] = useState(1);
  const gradeRef = useRef<HTMLDivElement>(null);

  const config = useMemo<EtiquetaConfig>(() => ({ ...CONFIG_RAPIDA, tipoCodigo }), [tipoCodigo]);

  function imprimir() {
    window.print();
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

          <button
            onClick={imprimir}
            className="w-full flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-bold"
            style={{ background: "var(--cor-acento)", color: "#06231a" }}
          >
            <Printer size={14} /> Imprimir
          </button>
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
