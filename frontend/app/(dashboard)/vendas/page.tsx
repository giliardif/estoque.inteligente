"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { Produto } from "@/lib/types";
import { Minus, Plus, ScanBarcode, Trash2 } from "lucide-react";

type ItemCarrinho = { produto_id: string; nome: string; quantidade: number; preco_unitario: number };

type VendaHistorico = {
  id: string;
  status: string;
  valor_total: number;
  criado_em: string;
  itens: { produto_id: string; quantidade: number; preco_unitario: number }[];
};

export default function VendasPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [busca, setBusca] = useState("");
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [finalizando, setFinalizando] = useState(false);
  const [historico, setHistorico] = useState<VendaHistorico[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(true);

  async function carregarHistorico() {
    setCarregandoHistorico(true);
    try {
      const vendas = await apiFetch<VendaHistorico[]>("/vendas?tamanho=20");
      setHistorico(vendas);
    } catch {
      // histórico é informativo — falha aqui não deve travar o PDV
    } finally {
      setCarregandoHistorico(false);
    }
  }

  useEffect(() => {
    apiFetch<Produto[]>("/produtos").then(setProdutos).catch(() => {});
    carregarHistorico();
  }, []);

  const total = carrinho.reduce((s, i) => s + i.quantidade * i.preco_unitario, 0);

  function adicionarAoCarrinho(produto: Produto) {
    setCarrinho((atual) => {
      const existente = atual.find((i) => i.produto_id === produto.id);
      if (existente) {
        return atual.map((i) => i.produto_id === produto.id ? { ...i, quantidade: i.quantidade + 1 } : i);
      }
      return [...atual, { produto_id: produto.id, nome: produto.nome, quantidade: 1, preco_unitario: produto.custo_medio || 1 }];
    });
  }

  function alterarQtd(produtoId: string, delta: number) {
    setCarrinho((atual) =>
      atual.map((i) => i.produto_id === produtoId ? { ...i, quantidade: Math.max(1, i.quantidade + delta) } : i)
    );
  }

  function remover(produtoId: string) {
    setCarrinho((atual) => atual.filter((i) => i.produto_id !== produtoId));
  }

  async function finalizarVenda() {
    setErro(null);
    setSucesso(null);
    setFinalizando(true);
    try {
      await apiFetch("/vendas", {
        method: "POST",
        body: JSON.stringify({
          itens: carrinho.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco_unitario: i.preco_unitario })),
        }),
      });
      setSucesso("Venda finalizada — estoque baixado automaticamente.");
      setCarrinho([]);
      carregarHistorico();
    } catch (err) {
      // Ex: "Saldo insuficiente para X" — mensagem já vem pronta do backend
      setErro(err instanceof ApiError ? err.message : "Não foi possível finalizar a venda.");
    } finally {
      setFinalizando(false);
    }
  }

  const produtosFiltrados = produtos.filter((p) => p.nome.toLowerCase().includes(busca.toLowerCase()));

  return (
    <div className="max-w-5xl flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Vendas / PDV</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Baixa automática de estoque na venda
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 items-start">
        <div className="rounded-xl border p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <div className="flex items-center gap-2 rounded-md border px-3 py-2 mb-3" style={{ borderColor: "var(--cor-borda)", background: "var(--cor-base)" }}>
            <ScanBarcode size={15} style={{ color: "var(--cor-acento)" }} />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar produto por nome"
              className="bg-transparent outline-none text-sm w-full"
            />
          </div>
          <div className="flex flex-col gap-1 max-h-80 overflow-y-auto">
            {produtosFiltrados.map((p) => (
              <button
                key={p.id}
                onClick={() => adicionarAoCarrinho(p)}
                className="flex items-center justify-between px-3 py-2 rounded-md text-sm text-left hover:bg-white/5"
              >
                <span>{p.nome}</span>
                <span style={{ color: "var(--cor-texto-muted)" }}>R$ {p.custo_medio.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border p-5 flex flex-col gap-3" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
          <h3 className="font-display font-semibold text-sm">Carrinho</h3>

          {erro && (
            <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
              {erro}
            </div>
          )}
          {sucesso && (
            <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }}>
              {sucesso}
            </div>
          )}

          {carrinho.length === 0 && (
            <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>Nenhum item ainda — clique em um produto ao lado.</p>
          )}

          <div className="flex flex-col gap-2">
            {carrinho.map((i) => (
              <div key={i.produto_id} className="flex items-center gap-3 text-sm border-b pb-2" style={{ borderColor: "#221D18" }}>
                <span className="flex-1">{i.nome}</span>
                <div className="flex items-center gap-2 rounded-md border px-2 py-1" style={{ borderColor: "var(--cor-borda)" }}>
                  <button onClick={() => alterarQtd(i.produto_id, -1)}><Minus size={13} /></button>
                  <span>{i.quantidade}</span>
                  <button onClick={() => alterarQtd(i.produto_id, 1)}><Plus size={13} /></button>
                </div>
                <span className="font-semibold w-16 text-right">R$ {(i.quantidade * i.preco_unitario).toFixed(2)}</span>
                <button onClick={() => remover(i.produto_id)} style={{ color: "var(--cor-texto-muted)" }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-between items-center pt-2 text-lg font-bold">
            <span className="text-sm font-normal" style={{ color: "var(--cor-texto-muted)" }}>Total</span>
            <span>R$ {total.toFixed(2)}</span>
          </div>

          <button
            onClick={finalizarVenda}
            disabled={carrinho.length === 0 || finalizando}
            className="rounded-md py-2.5 font-bold text-sm disabled:opacity-60"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            {finalizando ? "Finalizando..." : "Finalizar venda"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-5" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
        <h3 className="font-display font-semibold text-sm mb-3">Histórico recente</h3>

        {carregandoHistorico && (
          <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>Carregando...</p>
        )}
        {!carregandoHistorico && historico.length === 0 && (
          <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>Nenhuma venda registrada ainda.</p>
        )}

        <div className="flex flex-col gap-1">
          {historico.map((v) => (
            <div key={v.id} className="flex items-center justify-between text-sm border-b py-2" style={{ borderColor: "#221D18" }}>
              <span style={{ color: "var(--cor-texto-muted)" }}>
                {new Date(v.criado_em).toLocaleString("pt-BR")}
              </span>
              <span style={{ color: "var(--cor-texto-muted)" }}>{v.itens.length} item(ns)</span>
              <span className="font-semibold">R$ {v.valor_total.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
