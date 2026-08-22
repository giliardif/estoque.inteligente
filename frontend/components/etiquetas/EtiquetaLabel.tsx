"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { EtiquetaConfig, Produto } from "@/lib/types";

type EtiquetaLabelProps = {
  produto: Produto;
  config: EtiquetaConfig;
};

/**
 * Etiqueta em papel branco (fundo fixo #fff, texto escuro) independente
 * do tema claro/escuro do app — impressora térmica imprime em papel
 * branco, então o preview precisa refletir isso, não os tokens de tema.
 *
 * Produto sem codigo_barras preenchido cai automaticamente pro QR usando
 * o `id` (UUID) como fallback, já que um código de barras EAN precisa de
 * um valor numérico real — decisão fechada no design da Etapa 29/32.
 */
export function EtiquetaLabel({ produto, config }: EtiquetaLabelProps) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const semCodigoDeBarras = !produto.codigo_barras;
  const usaQr = config.tipoCodigo === "qr" || semCodigoDeBarras;
  const valorCodigo = produto.codigo_barras || produto.sku || produto.id;

  useEffect(() => {
    if (usaQr) {
      if (qrCanvasRef.current) {
        QRCode.toCanvas(qrCanvasRef.current, valorCodigo, { width: 64, margin: 0 }).catch(() => {});
      }
      return;
    }
    if (barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, valorCodigo, {
          height: 28, width: 1.3, fontSize: 9, margin: 2, displayValue: false,
        });
      } catch {
        // Código com formato inválido pro EAN — deixa o SVG vazio em vez
        // de quebrar o preview inteiro (produto individual fica sem
        // código visível, mas o resto da grade continua renderizando).
      }
    }
  }, [usaQr, valorCodigo]);

  return (
    <div className="bg-white rounded-md p-2.5 text-center text-black flex flex-col items-center gap-0.5 overflow-hidden">
      {config.elementos.nome && (
        <div className="text-[9.5px] font-bold leading-tight w-full truncate">{produto.nome}</div>
      )}
      {config.elementos.marca && produto.marca && (
        <div className="text-[8px] text-gray-600 leading-tight">{produto.marca}</div>
      )}
      {config.elementos.sku && produto.sku && (
        <div className="text-[7.5px] text-gray-500 font-mono leading-tight">SKU: {produto.sku}</div>
      )}
      {usaQr ? (
        <canvas ref={qrCanvasRef} width={44} height={44} className="my-0.5" />
      ) : (
        <svg ref={barcodeRef} className="w-full my-0.5" />
      )}
      {config.elementos.preco && produto.preco_venda != null && (
        <div className="text-xs font-extrabold mt-0.5">
          {produto.preco_venda.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </div>
      )}
    </div>
  );
}
