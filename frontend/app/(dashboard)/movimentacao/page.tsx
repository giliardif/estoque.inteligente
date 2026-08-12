"use client";

import { useEffect, useState, FormEvent, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { Produto } from "@/lib/types";

type Deposito = { id: string; nome: string };

type Movimentacao = {
  id: string;
  produto_id: string;
  tipo: "entrada" | "saida" | "ajuste" | "transferencia";
  quantidade: number;
  origem: string | null;
  grupo_transferencia_id: string | null;
  criado_em: string;
};

const TIPOS = [
  { valor: "entrada", label: "Entrada" },
  { valor: "saida", label: "Saída" },
  { valor: "transferencia", label: "Transferência" },
  { valor: "ajuste", label: "Ajuste" },
] as const;

function tipoValido(v: string | null): (typeof TIPOS)[number]["valor"] | null {
  return TIPOS.some((t) => t.valor === v) ? (v as (typeof TIPOS)[number]["valor"]) : null;
}

export default function MovimentacaoPage() {
  // useSearchParams exige um limite de Suspense no App Router — as "ações
  // rápidas" da tela de Estoque linkam pra cá com ?tipo=entrada&produto_id=X
  // pra pré-preencher o formulário sem o usuário reescolher tudo de novo.
  return (
    <Suspense fallback={null}>
      <MovimentacaoConteudo />
    </Suspense>
  );
}

function MovimentacaoConteudo() {
  const searchParams = useSearchParams();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [depositos, setDepositos] = useState<Deposito[]>([]);
  const [historico, setHistorico] = useState<Movimentacao[]>([]);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]["valor"]>(tipoValido(searchParams.get("tipo")) ?? "saida");
  const [produtoId, setProdutoId] = useState(searchParams.get("produto_id") ?? "");
  const [quantidade, setQuantidade] = useState("");
  const [direcao, setDirecao] = useState<"positivo" | "negativo">("positivo");
  const [depositoOrigemId, setDepositoOrigemId] = useState("");
  const [depositoDestinoId, setDepositoDestinoId] = useState("");
  const [origem, setOrigem] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function carregarTudo() {
    const [prods, deps, hist] = await Promise.all([
      apiFetch<Produto[]>("/produtos"),
      apiFetch<Deposito[]>("/depositos"),
      apiFetch<Movimentacao[]>("/estoque/movimentacoes"),
    ]);
    setProdutos(prods);
    setDepositos(deps);
    setHistorico(hist);
  }

  useEffect(() => {
    carregarTudo().catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    setSalvando(true);
    try {
      const payload: Record<string, unknown> = {
        produto_id: produtoId,
        tipo,
        quantidade: Number(quantidade),
        origem: origem || undefined,
      };
      if (tipo === "ajuste") payload.direcao = direcao;
      if (tipo === "transferencia") {
        payload.deposito_origem_id = depositoOrigemId;
        payload.deposito_destino_id = depositoDestinoId;
      }

      await apiFetch("/estoque/movimentacoes", { method: "POST", body: JSON.stringify(payload) });
      setSucesso("Movimentação registrada com sucesso.");
      setQuantidade("");
      setOrigem("");
      setDepositoOrigemId("");
      setDepositoDestinoId("");
      await carregarTudo();
    } catch (err) {
      // Erros de negócio (ex: saldo insuficiente) chegam prontos do backend — o
      // frontend não reimplementa a regra, só exibe a mensagem que o backend deu.
      setErro(err instanceof ApiError ? err.message : "Não foi possível registrar a movimentação.");
    } finally {
      setSalvando(false);
    }
  }

  function nomeProduto(id: string) {
    return produtos.find((p) => p.id === id)?.nome ?? id;
  }

  return (
    <div className="max-w-5xl flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Movimentação</h1>
        <p className="text-sm" style={{ color: "var(--cor-texto-muted)" }}>
          Entradas, saídas e ajustes
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 items-start">
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border p-5 flex flex-col gap-3"
          style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
        >
          <h3 className="font-display font-semibold text-sm">Registrar movimentação</h3>

          <div className="flex gap-1.5">
            {TIPOS.map((t) => (
              <button
                type="button"
                key={t.valor}
                onClick={() => setTipo(t.valor)}
                className="flex-1 rounded-md py-2 text-xs font-semibold border"
                style={
                  tipo === t.valor
                    ? { background: "rgba(16,185,129,0.14)", borderColor: "var(--cor-acento)", color: "var(--cor-acento)" }
                    : { background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto-muted)" }
                }
              >
                {t.label}
              </button>
            ))}
          </div>

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

          <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            Produto
            <select
              required
              value={produtoId}
              onChange={(e) => setProdutoId(e.target.value)}
              className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            >
              <option value="">Selecione um produto</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            Quantidade
            <input
              type="number" required min="0.01" step="0.01"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            />
          </label>

          {tipo === "transferencia" && (
            depositos.length < 2 ? (
              <p className="text-xs rounded-md px-3 py-2" style={{ color: "var(--cor-texto-muted)", background: "var(--cor-base)" }}>
                É preciso ter pelo menos 2 depósitos cadastrados para transferir entre eles.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
                  De (origem)
                  <select
                    required
                    value={depositoOrigemId}
                    onChange={(e) => setDepositoOrigemId(e.target.value)}
                    className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
                    style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                  >
                    <option value="">Selecione</option>
                    {depositos.map((d) => (
                      <option key={d.id} value={d.id} disabled={d.id === depositoDestinoId}>{d.nome}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
                  Para (destino)
                  <select
                    required
                    value={depositoDestinoId}
                    onChange={(e) => setDepositoDestinoId(e.target.value)}
                    className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
                    style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
                  >
                    <option value="">Selecione</option>
                    {depositos.map((d) => (
                      <option key={d.id} value={d.id} disabled={d.id === depositoOrigemId}>{d.nome}</option>
                    ))}
                  </select>
                </label>
              </div>
            )
          )}

          {tipo === "ajuste" && (
            <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
              Direção do ajuste
              <select
                value={direcao}
                onChange={(e) => setDirecao(e.target.value as "positivo" | "negativo")}
                className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
                style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
              >
                <option value="positivo">Positivo (soma ao estoque)</option>
                <option value="negativo">Negativo (quebra, perda, avaria)</option>
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--cor-texto-muted)" }}>
            Origem / motivo
            <input
              value={origem}
              onChange={(e) => setOrigem(e.target.value)}
              placeholder={tipo === "ajuste" ? "Ex: quebra, avaria" : "Ex: venda balcão, NF-e"}
              className="rounded-md px-3 py-2 text-sm outline-none border font-normal"
              style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)", color: "var(--cor-texto)" }}
            />
          </label>

          <button
            type="submit"
            disabled={salvando}
            className="rounded-md py-2.5 font-bold text-sm mt-1 disabled:opacity-60"
            style={{ background: "var(--cor-acento)", color: "var(--cor-base)" }}
          >
            {salvando ? "Registrando..." : `Confirmar ${tipo}`}
          </button>
        </form>

        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--cor-borda)" }}>
          <div className="px-5 py-3.5 border-b" style={{ borderColor: "var(--cor-borda)" }}>
            <h3 className="font-display font-semibold text-sm">Histórico recente</h3>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {historico.length === 0 && (
                <tr><td className="px-5 py-6 text-center" style={{ color: "var(--cor-texto-muted)" }}>Nenhuma movimentação ainda.</td></tr>
              )}
              {historico.map((m) => (
                <tr key={m.id} style={{ borderBottom: "1px solid var(--cor-borda)" }}>
                  <td className="px-5 py-2.5">{nomeProduto(m.produto_id)}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className="text-xs font-semibold px-2 py-0.5 rounded-md"
                      style={
                        m.tipo === "entrada"
                          ? { color: "var(--cor-sucesso)", background: "rgba(91,140,99,0.14)" }
                          : m.tipo === "saida"
                          ? { color: "var(--cor-alerta)", background: "rgba(162,59,59,0.14)" }
                          : { color: "var(--cor-texto-muted)", background: "rgba(138,127,115,0.14)" }
                      }
                    >
                      {m.tipo}
                    </span>
                    {m.grupo_transferencia_id && (
                      <span className="ml-1 text-xs" style={{ color: "var(--cor-texto-muted)" }} title="Parte de uma transferência entre depósitos">
                        🔁
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right pr-5">{m.quantidade}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
