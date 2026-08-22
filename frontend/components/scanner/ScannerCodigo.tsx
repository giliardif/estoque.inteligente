"use client";

import { useEffect, useRef, useState } from "react";
import { X, Camera, Keyboard } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { Produto } from "@/lib/types";

type ScannerCodigoProps = {
  aberto: boolean;
  onFechar: () => void;
  onProdutoEncontrado: (produto: Produto) => void;
};

/**
 * Modal de leitura de código de barras/QR via câmera, reutilizado em
 * Vendas, Estoque e Inventário. A leitura por leitor físico (HID) NÃO
 * passa por aqui — ela acontece direto no campo de busca de cada tela via
 * useLeitorFisico(), sem precisar abrir modal nenhum.
 *
 * getUserMedia só funciona em contexto seguro (HTTPS ou localhost) — em
 * produção (Vercel) isso já é garantido. Se a câmera falhar por qualquer
 * motivo (permissão negada, sem câmera, contexto inseguro), o fallback de
 * digitação manual sempre fica disponível, sem bloquear o fluxo.
 */
export function ScannerCodigo({ aberto, onFechar, onProdutoEncontrado }: ScannerCodigoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [modoManual, setModoManual] = useState(false);
  const [codigoManual, setCodigoManual] = useState("");
  const [erroCamera, setErroCamera] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const processandoRef = useRef(false);

  useEffect(() => {
    if (!aberto || modoManual) return;

    let cancelado = false;
    processandoRef.current = false;
    setErroCamera(null);

    async function iniciar() {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          videoRef.current!,
          (result) => {
            if (result && !processandoRef.current && !cancelado) {
              processandoRef.current = true;
              buscarCodigo(result.getText());
            }
          }
        );
        if (cancelado) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      } catch {
        if (!cancelado) {
          setErroCamera("Não foi possível acessar a câmera. Verifique a permissão do navegador ou use a digitação manual.");
        }
      }
    }
    iniciar();

    return () => {
      cancelado = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [aberto, modoManual]);

  async function buscarCodigo(codigo: string) {
    setBuscando(true);
    setErroBusca(null);
    try {
      const produto = await apiFetch<Produto>(`/produtos/buscar-codigo?codigo=${encodeURIComponent(codigo)}`);
      onProdutoEncontrado(produto);
      fechar();
    } catch (err) {
      const msg = err instanceof ApiError && err.status === 404
        ? "Nenhum produto encontrado para esse código."
        : "Não foi possível buscar o produto.";
      setErroBusca(msg);
      processandoRef.current = false; // permite tentar de novo sem fechar o modal
    } finally {
      setBuscando(false);
    }
  }

  function fechar() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setModoManual(false);
    setCodigoManual("");
    setErroBusca(null);
    setErroCamera(null);
    onFechar();
  }

  if (!aberto) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center px-4"
      style={{ background: "rgba(4,8,16,0.7)" }}
      onClick={fechar}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border overflow-hidden shadow-xl"
        style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--cor-borda)" }}>
          <h3 className="text-sm font-semibold">Escanear código</h3>
          <button onClick={fechar} aria-label="Fechar" className="opacity-70 hover:opacity-100">
            <X size={16} />
          </button>
        </div>

        <div className="p-4">
          {!modoManual ? (
            <>
              <div
                className="relative rounded-xl overflow-hidden mb-3"
                style={{ aspectRatio: "4/3", background: "#000" }}
              >
                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                <div
                  className="absolute inset-0 flex items-center justify-center pointer-events-none"
                  style={{ boxShadow: "inset 0 0 0 9999px rgba(0,0,0,0)" }}
                >
                  <div
                    className="w-2/3 h-2/5 rounded-lg"
                    style={{ border: "2px solid var(--cor-acento-soft, var(--cor-acento))", boxShadow: "0 0 0 999px rgba(0,0,0,0.45)" }}
                  />
                </div>
                {buscando && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ background: "rgba(0,0,0,0.5)", color: "#fff" }}>
                    Buscando produto...
                  </div>
                )}
              </div>
              {erroCamera && (
                <p className="text-xs mb-2" style={{ color: "var(--cor-alerta)" }}>{erroCamera}</p>
              )}
              <button
                onClick={() => setModoManual(true)}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-medium py-2"
                style={{ color: "var(--cor-acento)" }}
              >
                <Keyboard size={13} /> Câmera indisponível? Digitar manualmente
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (codigoManual.trim()) buscarCodigo(codigoManual.trim());
              }}
            >
              <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>
                Código de barras ou SKU
              </label>
              <input
                autoFocus
                value={codigoManual}
                onChange={(e) => setCodigoManual(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm bg-transparent outline-none mb-3"
                style={{ borderColor: "var(--cor-borda)" }}
                placeholder="Ex: 7891234567890"
              />
              <button
                type="submit"
                disabled={buscando || !codigoManual.trim()}
                className="w-full rounded-md py-2 text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--cor-acento)", color: "#06231a" }}
              >
                {buscando ? "Buscando..." : "Buscar"}
              </button>
              <button
                type="button"
                onClick={() => setModoManual(false)}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-medium py-2 mt-1"
                style={{ color: "var(--cor-texto-muted)" }}
              >
                <Camera size={13} /> Voltar pra câmera
              </button>
            </form>
          )}
          {erroBusca && (
            <p className="text-xs mt-2" style={{ color: "var(--cor-alerta)" }}>{erroBusca}</p>
          )}
        </div>
      </div>
    </div>
  );
}
