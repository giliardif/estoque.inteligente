"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError, obterAccessToken } from "@/lib/api";
import { Upload, FileText, Clock } from "lucide-react";

type ItemNota = {
  id: string;
  descricao_xml: string;
  produto_id: string | null;
  quantidade: number;
  valor_unitario: number;
  status_match: "reconhecido" | "pendente_cadastro" | "ignorado";
};

type NotaResumo = {
  id: string;
  numero: string;
  status: string;
  criado_em: string;
  fornecedor_nome: string | null;
  itens_pendentes: number;
};

export default function NotasPage() {
  const [itens, setItens] = useState<ItemNota[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [historico, setHistorico] = useState<NotaResumo[]>([]);
  const [notaSelecionadaId, setNotaSelecionadaId] = useState<string | null>(null);

  async function carregarHistorico() {
    try {
      const notas = await apiFetch<NotaResumo[]>("/notas-fiscais?tamanho=20");
      setHistorico(notas);
    } catch {
      // histórico é informativo — falha aqui não deve travar a importação
    }
  }

  useEffect(() => {
    carregarHistorico();
  }, []);

  async function verItensDaNota(nota: NotaResumo) {
    setErro(null);
    try {
      const listaItens = await apiFetch<ItemNota[]>(`/notas-fiscais/${nota.id}/itens`);
      setItens(listaItens);
      setNotaSelecionadaId(nota.id);
      setNomeArquivo(`Nota ${nota.numero}`);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível carregar os itens da nota.");
    }
  }

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

  async function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setNomeArquivo(arquivo.name);
    setErro(null);
    setEnviando(true);
    try {
      // Upload multipart não passa pelo apiFetch (que sempre seta Content-Type
      // json) — chamada direta aqui, mas ainda com o mesmo access token em memória.
      const formData = new FormData();
      formData.append("arquivo", arquivo);
      const token = obterAccessToken();
      const resp = await fetch(`${API_URL}/notas-fiscais/importar`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        body: formData,
      });
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.detail || "Não foi possível importar o XML.");
      }
      const nota = await resp.json();
      const listaItens = await apiFetch<ItemNota[]>(`/notas-fiscais/${nota.id}/itens`);
      setItens(listaItens);
      setNotaSelecionadaId(nota.id);
      carregarHistorico();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível importar o XML.");
    } finally {
      setEnviando(false);
    }
  }

  async function ignorarItem(itemId: string) {
    await apiFetch(`/notas-fiscais/itens/${itemId}/confirmar`, {
      method: "POST",
      body: JSON.stringify({ ignorar: true }),
    }).catch(() => {});
    setItens((atual) => atual.map((i) => i.id === itemId ? { ...i, status_match: "ignorado" } : i));
    carregarHistorico();
  }

  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Notas Fiscais</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Importação automática via XML de NF-e
        </p>
      </div>

      <label
        className="rounded-xl border p-8 flex flex-col items-center gap-2 text-center cursor-pointer"
        style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
      >
        <Upload size={22} style={{ color: "var(--cor-acento)" }} />
        <span className="font-display font-semibold text-sm">
          {enviando ? "Processando XML..." : "Clique para selecionar o XML da NF-e"}
        </span>
        {nomeArquivo && <span className="text-xs" style={{ color: "var(--cor-texto-muted)" }}>{nomeArquivo}</span>}
        <input type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={handleArquivo} disabled={enviando} />
      </label>

      {erro && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
          {erro}
        </div>
      )}

      {itens.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
          <div className="px-5 py-3.5 border-b flex items-center gap-2" style={{ borderColor: "var(--cor-borda)" }}>
            <FileText size={15} />
            <h3 className="font-display font-semibold text-sm">Itens da nota</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                {["Descrição no XML", "Qtd", "Valor un.", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-5 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id} style={{ borderTop: "1px solid #221D18" }}>
                  <td className="px-5 py-2.5">{i.descricao_xml}</td>
                  <td className="px-3 py-2.5">{i.quantidade}</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--cor-texto-muted)" }}>R$ {i.valor_unitario.toFixed(2)}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-md"
                      style={
                        i.status_match === "reconhecido"
                          ? { color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }
                          : i.status_match === "ignorado"
                          ? { color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }
                          : { color: "var(--cor-acento)", background: "rgba(201,134,43,0.14)" }
                      }
                    >
                      {i.status_match === "reconhecido" ? "Reconhecido" : i.status_match === "ignorado" ? "Ignorado" : "Aguardando cadastro"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {i.status_match === "pendente_cadastro" && (
                      <button onClick={() => ignorarItem(i.id)} className="text-xs underline" style={{ color: "var(--cor-texto-muted)" }}>
                        Ignorar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
        <div className="px-5 py-3.5 border-b flex items-center gap-2" style={{ borderColor: "var(--cor-borda)" }}>
          <Clock size={15} />
          <h3 className="font-display font-semibold text-sm">Notas importadas</h3>
        </div>

        {historico.length === 0 && (
          <p className="text-sm px-5 py-4" style={{ color: "var(--cor-texto-muted)" }}>Nenhuma nota importada ainda.</p>
        )}

        {historico.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr>
                {["Número", "Fornecedor", "Data", "Pendentes", ""].map((h) => (
                  <th key={h} className="text-left px-5 py-2 text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {historico.map((n) => (
                <tr key={n.id} style={{ borderTop: "1px solid #221D18" }}>
                  <td className="px-5 py-2.5">{n.numero}</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--cor-texto-muted)" }}>{n.fornecedor_nome ?? "—"}</td>
                  <td className="px-3 py-2.5" style={{ color: "var(--cor-texto-muted)" }}>
                    {new Date(n.criado_em).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-3 py-2.5">
                    {n.itens_pendentes > 0 ? (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-acento)", background: "rgba(201,134,43,0.14)" }}>
                        {n.itens_pendentes} pendente(s)
                      </span>
                    ) : (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }}>
                        Concluída
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => verItensDaNota(n)} className="text-xs underline" style={{ color: n.id === notaSelecionadaId ? "var(--cor-acento)" : "var(--cor-texto-muted)" }}>
                      Ver itens
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
