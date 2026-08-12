"use client";

// Primitivos compartilhados por todas as telas de lista (Estoque, Produtos,
// Vendas, Notas, Compras, Inventário, Alertas): cabeçalho com ordenação e
// linha com hover consistentes, pra não reimplementar isso em cada tela.

import { ReactNode, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";

export type Direcao = "asc" | "desc";

// Hook de ordenação client-side. Passe uma função de comparação por campo;
// o hook cuida de alternar asc/desc e de qual coluna está ativa.
export function useOrdenacao<T>(itens: T[], comparadores: Record<string, (a: T, b: T) => number>) {
  const [campo, setCampo] = useState<string | null>(null);
  const [direcao, setDirecao] = useState<Direcao>("asc");

  function alternar(campoClicado: string) {
    if (campo !== campoClicado) {
      setCampo(campoClicado);
      setDirecao("asc");
    } else if (direcao === "asc") {
      setDirecao("desc");
    } else {
      // terceiro clique remove a ordenação, volta pro estado natural
      setCampo(null);
    }
  }

  const itensOrdenados = useMemo(() => {
    if (!campo || !comparadores[campo]) return itens;
    const ordenado = [...itens].sort(comparadores[campo]);
    return direcao === "asc" ? ordenado : ordenado.reverse();
  }, [itens, campo, direcao, comparadores]);

  return { itensOrdenados, campoAtivo: campo, direcao, alternar };
}

export function ThOrdenavel({
  label, campo, campoAtivo, direcao, onClick,
}: {
  label: string;
  campo: string;
  campoAtivo: string | null;
  direcao: Direcao;
  onClick: (campo: string) => void;
}) {
  const ativo = campoAtivo === campo;
  return (
    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wide select-none"
      style={{ color: ativo ? "var(--cor-texto)" : "var(--cor-texto-muted)" }}>
      <button
        onClick={() => onClick(campo)}
        className="flex items-center gap-1 hover:opacity-80"
      >
        {label}
        {ativo ? (
          direcao === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        ) : (
          <ChevronsUpDown size={12} style={{ opacity: 0.4 }} />
        )}
      </button>
    </th>
  );
}

export function TrHover({
  children, selecionada = false, onClick,
}: { children: ReactNode; selecionada?: boolean; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className="transition-colors"
      style={{
        borderBottom: "1px solid var(--cor-borda)",
        background: selecionada ? "rgba(16,185,129,0.08)" : "transparent",
        cursor: onClick ? "pointer" : undefined,
      }}
      onMouseEnter={(e) => {
        if (!selecionada) e.currentTarget.style.background = "rgba(255,255,255,0.025)";
      }}
      onMouseLeave={(e) => {
        if (!selecionada) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </tr>
  );
}
