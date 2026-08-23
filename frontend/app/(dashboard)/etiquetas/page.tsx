"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { EtiquetaConfig, EtiquetaModelo, Produto } from "@/lib/types";
import { useToast } from "@/components/ui";
import { EtiquetaLabel } from "@/components/etiquetas/EtiquetaLabel";
import { Search, X, Save, Printer, FileDown, ScanBarcode, Download } from "lucide-react";
import { ScannerCodigo } from "@/components/scanner/ScannerCodigo";
import { useQzTray } from "@/lib/useQzTray";
import { EnviarParaEstacaoBotao } from "@/components/estacoes/EnviarParaEstacaoBotao";

const CONFIG_PADRAO: EtiquetaConfig = {
  elementos: { nome: true, sku: true, preco: true, marca: false },
  tipoCodigo: "barras",
  tamanho: "40x30",
  colunas: 3,
  margemMm: 2,
  espacamentoMm: 3,
  modoImpressao: "navegador",
  impressora: "",
};

type ItemSelecionado = { produto: Produto; quantidade: number };

export default function EtiquetasPage() {
  const { sucesso, erro: toastErro } = useToast();

  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [selecionados, setSelecionados] = useState<ItemSelecionado[]>([]);
  const [buscaAdicionar, setBuscaAdicionar] = useState("");
  const [scannerAberto, setScannerAberto] = useState(false);
  const [mostrarEnvioEstacao, setMostrarEnvioEstacao] = useState(false);

  const [config, setConfig] = useState<EtiquetaConfig>(CONFIG_PADRAO);
  const { status: statusQzTray, impressoras: impressorasQzTray, conectar: reconectarQzTray, imprimirHtml } = useQzTray();
  const gradeImpressaoRef = useRef<HTMLDivElement>(null);
  const [imprimindo, setImprimindo] = useState(false);

  const [modelos, setModelos] = useState<EtiquetaModelo[]>([]);
  const [modeloSelecionadoId, setModeloSelecionadoId] = useState<string>("");
  const [nomeNovoModelo, setNomeNovoModelo] = useState("");
  const [salvandoModelo, setSalvandoModelo] = useState(false);

  useEffect(() => {
    apiFetch<Produto[]>("/produtos").then(setProdutos).catch(() => {});
    apiFetch<EtiquetaModelo[]>("/etiquetas/modelos").then(setModelos).catch(() => {});
  }, []);

  const sugestoes = useMemo(() => {
    if (!buscaAdicionar.trim()) return [];
    const termo = buscaAdicionar.toLowerCase();
    return produtos
      .filter((p) => !selecionados.some((s) => s.produto.id === p.id))
      .filter((p) => p.nome.toLowerCase().includes(termo) || (p.sku ?? "").toLowerCase().includes(termo))
      .slice(0, 6);
  }, [buscaAdicionar, produtos, selecionados]);

  function adicionarProduto(produto: Produto) {
    setSelecionados((atual) => [...atual, { produto, quantidade: 1 }]);
    setBuscaAdicionar("");
  }

  function removerProduto(produtoId: string) {
    setSelecionados((atual) => atual.filter((s) => s.produto.id !== produtoId));
  }

  function alterarQuantidade(produtoId: string, quantidade: number) {
    setSelecionados((atual) =>
      atual.map((s) => (s.produto.id === produtoId ? { ...s, quantidade: Math.max(1, quantidade) } : s))
    );
  }

  function alternarElemento(chave: keyof EtiquetaConfig["elementos"]) {
    setConfig((c) => ({ ...c, elementos: { ...c.elementos, [chave]: !c.elementos[chave] } }));
  }

  const totalEtiquetas = selecionados.reduce((soma, s) => soma + s.quantidade, 0);

  // Grade de impressão: cada item aparece `quantidade` vezes, repetindo o
  // mesmo produto — é isso que gera a etiqueta unitária correta, não uma
  // etiqueta "por produto distinto".
  const grade = useMemo(() => {
    const lista: Produto[] = [];
    for (const item of selecionados) {
      for (let i = 0; i < item.quantidade; i++) lista.push(item.produto);
    }
    return lista;
  }, [selecionados]);

  function aplicarModelo(modeloId: string) {
    setModeloSelecionadoId(modeloId);
    const modelo = modelos.find((m) => m.id === modeloId);
    if (modelo) setConfig({ ...CONFIG_PADRAO, ...modelo.config_json });
  }

  async function salvarModelo() {
    if (!nomeNovoModelo.trim()) {
      toastErro("Dê um nome pro modelo antes de salvar.");
      return;
    }
    setSalvandoModelo(true);
    try {
      const criado = await apiFetch<EtiquetaModelo>("/etiquetas/modelos", {
        method: "POST",
        body: JSON.stringify({ nome: nomeNovoModelo.trim(), config_json: config }),
      });
      setModelos((atual) => [criado, ...atual]);
      setModeloSelecionadoId(criado.id);
      setNomeNovoModelo("");
      sucesso("Modelo salvo. Já aparece na lista pra reusar depois.");
    } catch (err) {
      toastErro(err instanceof ApiError ? err.message : "Não foi possível salvar o modelo.");
    } finally {
      setSalvandoModelo(false);
    }
  }

  function imprimir() {
    if (config.modoImpressao === "qztray") {
      if (statusQzTray !== "conectado") {
        toastErro("QZ Tray não está conectado — imprimindo pelo navegador.");
        window.print();
        return;
      }
      if (!config.impressora) {
        toastErro("Escolha uma impressora antes de imprimir.");
        return;
      }
      setImprimindo(true);
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        body{margin:0;font-family:Manrope,Arial,sans-serif;}
        .grade{display:grid;grid-template-columns:repeat(${config.colunas},1fr);gap:${config.espacamentoMm}mm;padding:${config.margemMm}mm;}
      </style></head><body><div class="grade">${gradeImpressaoRef.current?.innerHTML ?? ""}</div></body></html>`;
      imprimirHtml(html, config.impressora)
        .then(() => sucesso("Enviado pra impressora."))
        .catch(() => toastErro("Não foi possível imprimir via QZ Tray. Confirme se o agente está aberto."))
        .finally(() => setImprimindo(false));
      return;
    }
    window.print();
  }

  return (
    <div className="flex flex-col gap-5">
      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          #grade-impressao, #grade-impressao * { visibility: visible; }
          #grade-impressao {
            position: absolute; left: 0; top: 0; width: 100%;
            padding: ${config.margemMm}mm;
          }
        }
      `}</style>

      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div>
          <h1 className="text-xl font-semibold">Etiquetas</h1>
          <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>Geração em lote</p>
        </div>
        <select
          value={modeloSelecionadoId}
          onChange={(e) => (e.target.value ? aplicarModelo(e.target.value) : setModeloSelecionadoId(""))}
          className="rounded-md border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
        >
          <option value="">Modelo: personalizado</option>
          {modelos.map((m) => <option key={m.id} value={m.id}>Modelo: {m.nome}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_300px_1fr] gap-4 items-start print:hidden">

        {/* Coluna 1 — produtos selecionados */}
        <div className="rounded-xl border p-4" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <h3 className="text-sm font-bold mb-3">Produtos selecionados</h3>

          <div className="relative mb-3">
            <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-base)" }}>
              <Search size={13} style={{ color: "var(--cor-texto-muted)" }} />
              <input
                value={buscaAdicionar}
                onChange={(e) => setBuscaAdicionar(e.target.value)}
                placeholder="Adicionar produto..."
                className="bg-transparent outline-none text-xs w-full"
              />
            </div>
            {sugestoes.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border shadow-lg overflow-hidden" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
                {sugestoes.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => adicionarProduto(p)}
                    className="w-full text-left px-2.5 py-2 text-xs hover:opacity-80"
                    style={{ borderBottom: "1px solid var(--cor-borda)" }}
                  >
                    <div className="font-medium">{p.nome}</div>
                    <div className="font-mono" style={{ color: "var(--cor-texto-muted)" }}>{p.sku || "sem SKU"}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setScannerAberto(true)}
            className="w-full flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold mb-3"
            style={{ background: "var(--cor-acento)", color: "#06231a" }}
          >
            <ScanBarcode size={13} /> Escanear pra adicionar
          </button>

          <div className="flex flex-col gap-2">
            {selecionados.length === 0 && (
              <p className="text-xs text-center py-4" style={{ color: "var(--cor-texto-muted)" }}>
                Nenhum produto selecionado ainda.
              </p>
            )}
            {selecionados.map((s) => (
              <div key={s.produto.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-base)" }}>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold truncate">{s.produto.nome}</div>
                  <div className="text-[10px] font-mono" style={{ color: "var(--cor-texto-muted)" }}>{s.produto.sku || "—"}</div>
                </div>
                <input
                  type="number" min={1} value={s.quantidade}
                  onChange={(e) => alterarQuantidade(s.produto.id, Number(e.target.value) || 1)}
                  className="w-11 rounded-md border px-1 py-1 text-xs text-center outline-none"
                  style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                />
                <button onClick={() => removerProduto(s.produto.id)} className="opacity-60 hover:opacity-100">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs mt-3" style={{ color: "var(--cor-texto-muted)" }}>Total: {totalEtiquetas} etiqueta(s)</p>
        </div>

        {/* Coluna 2 — configuração */}
        <div className="rounded-xl border p-4" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <h3 className="text-sm font-bold mb-3">Configuração do modelo</h3>

          <div className="mb-3">
            <label className="text-xs font-semibold block mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>Elementos na etiqueta</label>
            <div className="flex flex-col gap-1.5">
              {([["nome", "Nome do produto"], ["sku", "SKU"], ["preco", "Preço"], ["marca", "Marca"]] as const).map(([chave, label]) => (
                <label key={chave} className="flex items-center gap-2 text-xs font-medium">
                  <input type="checkbox" checked={config.elementos[chave]} onChange={() => alternarElemento(chave)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="mb-3">
            <label className="text-xs font-semibold block mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>Tipo de código</label>
            <div className="flex gap-1.5">
              {(["barras", "qr"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setConfig((c) => ({ ...c, tipoCodigo: t }))}
                  className="flex-1 rounded-md border py-1.5 text-xs font-semibold"
                  style={config.tipoCodigo === t
                    ? { background: "rgba(16,185,129,0.14)", borderColor: "var(--cor-acento)", color: "var(--cor-acento)" }
                    : { borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
                >
                  {t === "barras" ? "Barras" : "QR"}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 mb-3">
            <div>
              <label className="text-xs font-semibold block mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>Tamanho</label>
              <select
                value={config.tamanho}
                onChange={(e) => setConfig((c) => ({ ...c, tamanho: e.target.value as EtiquetaConfig["tamanho"] }))}
                className="w-full rounded-md border px-2 py-1.5 text-xs outline-none"
                style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
              >
                <option value="30x20">30×20mm</option>
                <option value="40x30">40×30mm</option>
                <option value="50x40">50×40mm</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>Colunas/página</label>
              <select
                value={config.colunas}
                onChange={(e) => setConfig((c) => ({ ...c, colunas: Number(e.target.value) }))}
                className="w-full rounded-md border px-2 py-1.5 text-xs outline-none"
                style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
              >
                {[2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 mb-3">
            <div>
              <label className="text-xs font-semibold block mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>Margem (mm)</label>
              <input
                type="number" min={0} value={config.margemMm}
                onChange={(e) => setConfig((c) => ({ ...c, margemMm: Number(e.target.value) || 0 }))}
                className="w-full rounded-md border px-2 py-1.5 text-xs outline-none"
                style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
              />
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>Espaçamento (mm)</label>
              <input
                type="number" min={0} value={config.espacamentoMm}
                onChange={(e) => setConfig((c) => ({ ...c, espacamentoMm: Number(e.target.value) || 0 }))}
                className="w-full rounded-md border px-2 py-1.5 text-xs outline-none"
                style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
              />
            </div>
          </div>

          <div className="mb-2">
            <label className="text-xs font-semibold block mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>Modo de impressão</label>
            <div className="flex gap-1.5">
              {(["navegador", "qztray"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setConfig((c) => ({ ...c, modoImpressao: m }))}
                  className="flex-1 rounded-md border py-1.5 text-xs font-semibold"
                  style={config.modoImpressao === m
                    ? { background: "rgba(16,185,129,0.14)", borderColor: "var(--cor-acento)", color: "var(--cor-acento)" }
                    : { borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}
                >
                  {m === "navegador" ? "Navegador" : "QZ Tray"}
                </button>
              ))}
            </div>

            {config.modoImpressao === "navegador" && (
              <p className="text-[10.5px] mt-1.5" style={{ color: "var(--cor-texto-muted)" }}>
                Abre o diálogo de impressão padrão do sistema — funciona sem instalar nada.
              </p>
            )}

            {config.modoImpressao === "qztray" && (
              <div className="mt-2 rounded-md border p-2.5" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-base)" }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      background: statusQzTray === "conectado" ? "var(--cor-acento)"
                        : statusQzTray === "conectando" ? "#F59E0B" : "var(--cor-alerta)",
                    }}
                  />
                  <span className="text-xs font-semibold">
                    {statusQzTray === "conectado" && "QZ Tray conectado"}
                    {statusQzTray === "conectando" && "Conectando..."}
                    {statusQzTray === "desconectado" && "QZ Tray desconectado"}
                    {statusQzTray === "indisponivel" && "QZ Tray não encontrado"}
                  </span>
                </div>

                {statusQzTray === "conectado" ? (
                  <p className="text-[10.5px]" style={{ color: "var(--cor-texto-muted)" }}>
                    Imprime direto na impressora, sem abrir diálogo nenhum.
                  </p>
                ) : (
                  <>
                    <p className="text-[10.5px] mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>
                      Requer instalar o agente local uma vez neste computador.
                    </p>
                    <div className="flex gap-1.5">
                      <button
                        onClick={reconectarQzTray}
                        className="flex-1 rounded-md border py-1.5 text-[10.5px] font-semibold"
                        style={{ borderColor: "var(--cor-borda)" }}
                      >
                        Tentar conectar de novo
                      </button>
                      <a
                        href="https://qz.io/download/"
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-[10.5px] font-semibold"
                        style={{ background: "var(--cor-acento)", color: "#06231a" }}
                      >
                        <Download size={11} /> Baixar QZ Tray
                      </a>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {config.modoImpressao === "qztray" && statusQzTray === "conectado" && (
            <div className="mb-3">
              <label className="text-xs font-semibold block mb-1.5" style={{ color: "var(--cor-texto-muted)" }}>Impressora</label>
              <select
                value={config.impressora}
                onChange={(e) => setConfig((c) => ({ ...c, impressora: e.target.value }))}
                className="w-full rounded-md border px-2 py-1.5 text-xs outline-none"
                style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
              >
                <option value="">Selecione...</option>
                {impressorasQzTray.map((nome) => <option key={nome} value={nome}>{nome}</option>)}
              </select>
            </div>
          )}

          <div className="flex gap-1.5 mt-4">
            <input
              value={nomeNovoModelo}
              onChange={(e) => setNomeNovoModelo(e.target.value)}
              placeholder="Nome do modelo"
              className="flex-1 rounded-md border px-2.5 py-1.5 text-xs outline-none"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            />
            <button
              onClick={salvarModelo}
              disabled={salvandoModelo}
              className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-60"
              style={{ borderColor: "var(--cor-borda)" }}
            >
              <Save size={12} /> Salvar
            </button>
          </div>
        </div>

        {/* Coluna 3 — preview */}
        <div className="rounded-xl border p-4" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold">Visualização</h3>
            <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-full" style={{ background: "rgba(130,145,168,0.15)", color: "var(--cor-texto-muted)" }}>
              {totalEtiquetas} etiqueta(s)
            </span>
          </div>

          {grade.length === 0 ? (
            <p className="text-xs text-center py-10" style={{ color: "var(--cor-texto-muted)" }}>
              Selecione ao menos um produto pra ver o preview.
            </p>
          ) : (
            <div
              className="grid gap-2.5 max-h-[440px] overflow-auto p-1"
              style={{ gridTemplateColumns: `repeat(${config.colunas}, 1fr)` }}
            >
              {grade.slice(0, 60).map((produto, i) => (
                <EtiquetaLabel key={`${produto.id}-${i}`} produto={produto} config={config} />
              ))}
              {grade.length > 60 && (
                <p className="col-span-full text-center text-[10.5px] py-2" style={{ color: "var(--cor-texto-muted)" }}>
                  Preview limitado às primeiras 60 — a impressão sai com todas as {grade.length}.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 mt-4">
            <button
              disabled={grade.length === 0}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-md border py-2 text-xs font-semibold disabled:opacity-50"
              style={{ borderColor: "var(--cor-borda)" }}
              onClick={() => toastErro("Exportação em PDF ainda não disponível — use Imprimir e escolha \"Salvar como PDF\" no diálogo do navegador.")}
            >
              <FileDown size={13} /> Gerar PDF
            </button>
            <button
              disabled={grade.length === 0 || imprimindo}
              onClick={imprimir}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-xs font-bold disabled:opacity-50"
              style={{ background: "var(--cor-acento)", color: "#06231a" }}
            >
              <Printer size={13} /> {imprimindo ? "Imprimindo..." : "Imprimir etiquetas"}
            </button>
          </div>

          <button
            disabled={grade.length === 0}
            onClick={() => setMostrarEnvioEstacao((v) => !v)}
            className="mt-2 w-full text-center text-[11px] underline underline-offset-2 disabled:opacity-40"
            style={{ color: "var(--cor-texto-muted)" }}
          >
            {mostrarEnvioEstacao ? "Ocultar envio pra estação" : "Ou enviar pra uma estação de impressão"}
          </button>

          {mostrarEnvioEstacao && grade.length > 0 && (
            <div className="mt-2.5">
              <EnviarParaEstacaoBotao
                titulo={selecionados.length === 1 ? selecionados[0].produto.nome : `Lote de ${selecionados.length} produtos`}
                quantidade={totalEtiquetas}
                produtoId={selecionados.length === 1 ? selecionados[0].produto.id : null}
                obterHtml={() =>
                  `<!doctype html><html><head><meta charset="utf-8"><style>
                    body{margin:0;font-family:Manrope,Arial,sans-serif;}
                    .grade{display:grid;grid-template-columns:repeat(${config.colunas},1fr);gap:${config.espacamentoMm}mm;padding:${config.margemMm}mm;}
                  </style></head><body><div class="grade">${gradeImpressaoRef.current?.innerHTML ?? ""}</div></body></html>`
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Grade real de impressão — só visível no @media print (ver <style> acima) */}
      <div
        id="grade-impressao"
        ref={gradeImpressaoRef}
        className="hidden print:grid gap-2"
        style={{ gridTemplateColumns: `repeat(${config.colunas}, 1fr)`, gap: `${config.espacamentoMm}mm` }}
      >
        {grade.map((produto, i) => (
          <EtiquetaLabel key={`print-${produto.id}-${i}`} produto={produto} config={config} />
        ))}
      </div>

      <ScannerCodigo
        aberto={scannerAberto}
        onFechar={() => setScannerAberto(false)}
        onProdutoEncontrado={(produto) => {
          if (selecionados.some((s) => s.produto.id === produto.id)) {
            toastErro(`${produto.nome} já está na lista.`);
          } else {
            adicionarProduto(produto);
            sucesso(`${produto.nome} adicionado.`);
          }
        }}
      />
    </div>
  );
}
