"use client";

// Fluxo em 3 passos: upload (escolhe o arquivo) -> preview (mostra linha a
// linha o que vai acontecer, sem gravar nada) -> resultado (confirma e
// mostra o que foi criado/rejeitado). Decisões de negócio (confirmadas com
// Giliardi): SKU já existente é rejeitado (não atualiza), categoria nova é
// criada automaticamente, e sempre passa pelo preview antes de gravar.

import { useRef, useState } from "react";
import { X, Download, FileSpreadsheet, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { apiFetch, ApiError, obterAccessToken } from "@/lib/api";
import { ProdutoImportItem, ProdutoImportPreview, ProdutoImportResultado } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

const CABECALHO_MODELO = "nome,sku,categoria,codigo_barras,unidade_medida,custo_medio,preco_venda,marca,ncm,estoque_minimo,estoque_maximo";
const LINHA_EXEMPLO_MODELO = "Bombom Trufado,BOM-001,Doces,,un,2.50,5.00,,,10,";

type Passo = "upload" | "preview" | "resultado";

type ImportarProdutosDialogProps = {
  onFechar: () => void;
  onConcluido: () => void;
};

export function ImportarProdutosDialog({ onFechar, onConcluido }: ImportarProdutosDialogProps) {
  const [passo, setPasso] = useState<Passo>("upload");
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProdutoImportPreview | null>(null);
  const [resultado, setResultado] = useState<ProdutoImportResultado | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function baixarModelo() {
    const conteudo = `${CABECALHO_MODELO}\n${LINHA_EXEMPLO_MODELO}\n`;
    const blob = new Blob([`\uFEFF${conteudo}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "modelo_import_produtos.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setNomeArquivo(arquivo.name);
    setErro(null);
    setEnviando(true);
    try {
      // Upload multipart não passa pelo apiFetch (que sempre seta
      // Content-Type json) — mesmo padrão já usado no import de XML de NF-e
      // e no upload de imagem de produto.
      const formData = new FormData();
      formData.append("arquivo", arquivo);
      const token = obterAccessToken();
      const resp = await fetch(`${API_URL}/produtos/importar/preview`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        body: formData,
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.detail || "Não foi possível analisar a planilha.");
      }
      const dados: ProdutoImportPreview = await resp.json();
      setPreview(dados);
      setPasso("preview");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível analisar a planilha.");
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function confirmarImportacao() {
    if (!preview) return;
    const linhasValidas = preview.itens.filter((i) => i.status === "ok" && i.dados).map((i) => i.dados);
    setEnviando(true);
    setErro(null);
    try {
      const dados = await apiFetch<ProdutoImportResultado>("/produtos/importar/confirmar", {
        method: "POST",
        body: JSON.stringify({ linhas: linhasValidas }),
      });
      setResultado(dados);
      setPasso("resultado");
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível concluir a importação.");
    } finally {
      setEnviando(false);
    }
  }

  function voltarParaUpload() {
    setPreview(null);
    setErro(null);
    setNomeArquivo(null);
    setPasso("upload");
  }

  function fecharEAtualizar() {
    onConcluido();
    onFechar();
  }

  const totalValidas = preview?.total_validas ?? 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4" style={{ background: "rgba(10,8,6,0.55)" }}>
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${passo === "preview" ? "max-w-3xl" : "max-w-lg"} rounded-xl border p-5 md:p-6 flex flex-col gap-4 shadow-xl max-h-[90vh]`}
        style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
      >
        {/* --- PASSO 1: UPLOAD --- */}
        {passo === "upload" && (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold">Importar produtos em massa</h2>
                <p className="text-sm mt-0.5" style={{ color: "var(--cor-texto-muted)" }}>
                  Envie uma planilha .xlsx ou .csv para cadastrar vários produtos de uma vez.
                </p>
              </div>
              <button onClick={onFechar} aria-label="Fechar" style={{ color: "var(--cor-texto-muted)" }}>
                <X size={18} />
              </button>
            </div>

            <button
              onClick={baixarModelo}
              className="text-sm font-semibold flex items-center gap-1.5 w-fit"
              style={{ color: "var(--cor-acento)" }}
            >
              <Download size={14} /> Baixar planilha modelo (.csv)
            </button>

            <label
              className="rounded-lg border-2 border-dashed p-8 flex flex-col items-center gap-2 text-center cursor-pointer"
              style={{ borderColor: "var(--cor-borda)" }}
            >
              <FileSpreadsheet size={28} style={{ color: "var(--cor-texto-muted)" }} />
              <span className="text-sm font-semibold">
                {enviando ? "Analisando..." : nomeArquivo || "Clique para selecionar o arquivo"}
              </span>
              <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>
                .xlsx ou .csv — até 5MB, até 1000 linhas
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                disabled={enviando}
                onChange={handleArquivo}
              />
            </label>

            <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: "rgba(16,185,129,0.10)", color: "var(--cor-texto-muted)" }}>
              Colunas aceitas: <strong style={{ color: "var(--cor-texto)" }}>nome*</strong>, sku, categoria, codigo_barras,
              unidade_medida, custo_medio, preco_venda, marca, ncm, estoque_minimo, estoque_maximo. Só{" "}
              <strong style={{ color: "var(--cor-texto)" }}>nome</strong> é obrigatório.
            </div>

            {erro && (
              <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
                {erro}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={onFechar}
                className="rounded-md px-3.5 py-2 text-sm font-semibold border"
                style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
              >
                Cancelar
              </button>
            </div>
          </>
        )}

        {/* --- PASSO 2: PREVIEW --- */}
        {passo === "preview" && preview && (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold">Revisar antes de importar</h2>
                <p className="text-sm mt-0.5" style={{ color: "var(--cor-texto-muted)" }}>
                  {nomeArquivo} — {preview.total_linhas} linha(s) encontrada(s)
                </p>
              </div>
              <button onClick={onFechar} aria-label="Fechar" style={{ color: "var(--cor-texto-muted)" }}>
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="px-2.5 py-1 rounded-full" style={{ background: "rgba(16,185,129,0.14)", color: "var(--cor-acento-soft, var(--cor-acento))" }}>
                {preview.total_validas} pronta(s) para importar
              </span>
              {preview.total_com_erro > 0 && (
                <span className="px-2.5 py-1 rounded-full" style={{ background: "rgba(162,59,59,0.14)", color: "var(--cor-alerta)" }}>
                  {preview.total_com_erro} com erro
                </span>
              )}
              {preview.categorias_novas.length > 0 && (
                <span className="px-2.5 py-1 rounded-full border" style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }}>
                  {preview.categorias_novas.length} categoria(s) nova(s): {preview.categorias_novas.join(", ")}
                </span>
              )}
            </div>

            <div className="overflow-auto rounded-lg border flex-1" style={{ borderColor: "var(--cor-borda)" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Linha</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Nome</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>SKU</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Categoria</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.itens.map((item: ProdutoImportItem) => (
                    <tr
                      key={item.linha}
                      className="border-t"
                      style={{
                        borderColor: "var(--cor-borda)",
                        background: item.status === "erro" ? "rgba(162,59,59,0.10)" : undefined,
                      }}
                    >
                      <td className="px-3 py-2" style={{ color: "var(--cor-texto-muted)" }}>{item.linha}</td>
                      <td className="px-3 py-2">{item.dados?.nome || "—"}</td>
                      <td className="px-3 py-2">{item.dados?.sku || "—"}</td>
                      <td className="px-3 py-2">
                        {item.dados?.categoria || "—"}
                        {item.categoria_sera_criada && (
                          <span className="text-xs ml-1" style={{ color: "var(--cor-acento)" }}>(nova)</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {item.status === "ok" ? (
                          <span className="text-xs font-semibold flex items-center gap-1" style={{ color: "var(--cor-acento)" }}>
                            <CheckCircle2 size={13} /> Ok
                          </span>
                        ) : (
                          <span className="text-xs font-semibold flex items-center gap-1" style={{ color: "var(--cor-alerta)" }}>
                            <XCircle size={13} /> {item.erro}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {erro && (
              <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
                {erro}
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-between md:items-center mt-1">
              <button
                onClick={voltarParaUpload}
                className="text-sm font-semibold flex items-center gap-1 justify-center md:justify-start"
                style={{ color: "var(--cor-texto-muted)" }}
              >
                <ArrowLeft size={14} /> Trocar arquivo
              </button>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={onFechar}
                  className="rounded-md px-3.5 py-2 text-sm font-semibold border"
                  style={{ borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmarImportacao}
                  disabled={enviando || totalValidas === 0}
                  className="rounded-md px-3.5 py-2 text-sm font-bold disabled:opacity-60"
                  style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
                >
                  {enviando ? "Importando..." : `Importar ${totalValidas} produto(s) válido(s)`}
                </button>
              </div>
            </div>
          </>
        )}

        {/* --- PASSO 3: RESULTADO --- */}
        {passo === "resultado" && resultado && (
          <>
            <div className="flex flex-col items-center text-center gap-2 py-2">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: "rgba(16,185,129,0.14)", color: "var(--cor-acento)" }}
              >
                <CheckCircle2 size={24} />
              </div>
              <h2 className="text-base font-semibold">Importação concluída</h2>
              <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
                {resultado.criados} produto(s) criado(s)
                {resultado.rejeitados > 0 && ` · ${resultado.rejeitados} rejeitado(s)`}
                {resultado.categorias_criadas.length > 0 &&
                  ` · ${resultado.categorias_criadas.length} categoria(s) nova(s)`}
              </p>
            </div>

            {resultado.rejeitados > 0 && (
              <div className="rounded-lg border px-3 py-2.5 text-xs flex flex-col gap-1 max-h-40 overflow-auto" style={{ borderColor: "var(--cor-borda)" }}>
                {resultado.itens
                  .filter((i) => i.status === "erro")
                  .map((i) => (
                    <div key={i.linha} className="flex justify-between gap-3">
                      <span style={{ color: "var(--cor-texto-muted)" }}>Linha {i.linha}</span>
                      <span style={{ color: "var(--cor-alerta)" }}>{i.erro}</span>
                    </div>
                  ))}
              </div>
            )}

            <button
              onClick={fecharEAtualizar}
              className="rounded-md px-3.5 py-2.5 text-sm font-bold"
              style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
            >
              Fechar e atualizar lista
            </button>
          </>
        )}
      </div>
    </div>
  );
}
