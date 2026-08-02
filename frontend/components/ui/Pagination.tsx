"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationProps = {
  pagina: number;
  tamanhoPagina: number;
  total: number;
  onPaginaChange: (pagina: number) => void;
};

export function Pagination({ pagina, tamanhoPagina, total, onPaginaChange }: PaginationProps) {
  const totalPaginas = Math.max(1, Math.ceil(total / tamanhoPagina));
  if (total === 0) return null;

  const inicio = (pagina - 1) * tamanhoPagina + 1;
  const fim = Math.min(pagina * tamanhoPagina, total);

  return (
    <div className="flex items-center justify-between px-5 py-3 text-sm" style={{ color: "var(--cor-texto-muted)" }}>
      <span>
        {inicio}–{fim} de {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPaginaChange(pagina - 1)}
          disabled={pagina <= 1}
          aria-label="Página anterior"
          className="rounded-md p-1.5 border disabled:opacity-40"
          style={{ borderColor: "var(--cor-borda)" }}
        >
          <ChevronLeft size={15} />
        </button>
        <span className="text-xs font-semibold px-2" style={{ color: "var(--cor-texto)" }}>
          {pagina} / {totalPaginas}
        </span>
        <button
          onClick={() => onPaginaChange(pagina + 1)}
          disabled={pagina >= totalPaginas}
          aria-label="Próxima página"
          className="rounded-md p-1.5 border disabled:opacity-40"
          style={{ borderColor: "var(--cor-borda)" }}
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
