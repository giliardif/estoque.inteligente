"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { Produto } from "@/lib/types";
import { Plus } from "lucide-react";

type PedidoItem = { id: string; produto_id: string; quantidade: number; custo_unitario: number; quantidade_recebida: number };
type Pedido = { id: string; status: string; itens: PedidoItem[] };
type Sugestao = { produto_id: string; produto_nome: string; quantidade_sugerida: number };

export default function ComprasPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [produtoId, setProdutoId] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [custo, setCusto] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    const [prods, peds, sugs] = await Promise.all([
      apiFetch<Produto[]>("/produtos"),
      apiFetch<Pedido[]>("/compras/pedidos"),
      apiFetch<Sugestao[]>("/compras/sugestao-reposicao"),
    ]);
    setProdutos(prods);
    setPedidos(peds);
    setSugestoes(sugs);
  }

  useEffect(() => {
    carregar().catch(() => {});
  }, []);

  function nomeProduto(id: string) {
    return produtos.find((p) => p.id === id)?.nome ?? id;
  }

  async function criarPedido() {
    setErro(null);
    try {
      await apiFetch("/compras/pedidos", {
        method: "POST",
        body: JSON.stringify({ itens: [{ produto_id: produtoId, quantidade: Number(quantidade), custo_unitario: Number(custo) }] }),
      });
      setProdutoId(""); setQuantidade(""); setCusto("");
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível criar o pedido.");
    }
  }

  async function receber(pedidoId: string, itemId: string, faltante: number) {
    try {
      await apiFetch(`/compras/pedidos/${pedidoId}/receber`, {
        method: "POST",
        body: JSON.stringify({ item_id: itemId, quantidade_recebida: faltante }),
      });
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível registrar o recebimento.");
    }
  }

  return (
    <div className="max-w-4xl flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Compras</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Pedidos e sugestão de reposição
        </p>
      </div>

      {erro && (
        <div className="text-sm rounded-md px-3 py-2" style={{ color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }}>
          {erro}
        </div>
      )}

      {sugestoes.length > 0 && (
        <div className="rounded-xl border p-4" style={{ background: "rgba(16,185,129,0.08)", borderColor: "var(--cor-acento)" }}>
          <p className="text-xs font-semibold mb-1" style={{ color: "var(--cor-acento)" }}>Sugestão de reposição</p>
          {sugestoes.map((s) => (
            <p key={s.produto_id} className="text-sm">{s.produto_nome} — repor {s.quantidade_sugerida}</p>
          ))}
        </div>
      )}

      <div className="rounded-xl border p-5 flex items-end gap-3 flex-wrap" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
        <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          Produto
          <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)}
            className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}>
            <option value="">Selecione</option>
            {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          Quantidade
          <input type="number" value={quantidade} onChange={(e) => setQuantidade(e.target.value)}
            className="rounded-md px-3 py-2 text-sm outline-none border w-28"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
          Custo unitário
          <input type="number" value={custo} onChange={(e) => setCusto(e.target.value)}
            className="rounded-md px-3 py-2 text-sm outline-none border w-28"
            style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }} />
        </label>
        <button onClick={criarPedido} className="flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-bold"
          style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}>
          <Plus size={15} /> Criar pedido
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {pedidos.map((pedido) => (
          <div key={pedido.id} className="rounded-xl border p-4" style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase" style={{ color: "var(--cor-texto-muted)" }}>Pedido {pedido.id.slice(0, 8)}</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ color: "var(--cor-acento)", background: "rgba(16,185,129,0.14)" }}>{pedido.status}</span>
            </div>
            {pedido.itens.map((item) => {
              const faltante = item.quantidade - item.quantidade_recebida;
              return (
                <div key={item.id} className="flex items-center justify-between text-sm py-1.5">
                  <span>{nomeProduto(item.produto_id)} — {item.quantidade_recebida}/{item.quantidade}</span>
                  {faltante > 0 && (
                    <button onClick={() => receber(pedido.id, item.id, faltante)} className="text-xs underline" style={{ color: "var(--cor-sucesso)" }}>
                      Receber {faltante}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
