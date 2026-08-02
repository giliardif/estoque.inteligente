"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";

export type ItemRowMenu = {
  label: string;
  icon?: ReactNode;
  perigoso?: boolean;
  onClick: () => void;
};

export function RowMenu({ itens }: { itens: ItemRowMenu[] }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function onClickFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", onClickFora);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickFora);
      document.removeEventListener("keydown", onEsc);
    };
  }, [aberto]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setAberto((v) => !v); }}
        aria-label="Mais ações"
        aria-haspopup="menu"
        aria-expanded={aberto}
        className="rounded-md p-1.5 hover:opacity-100"
        style={{ color: "var(--cor-texto-muted)" }}
      >
        <MoreVertical size={16} />
      </button>
      {aberto && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 z-20 mt-1 w-44 rounded-lg border py-1 shadow-lg"
          style={{ background: "var(--cor-superficie)", borderColor: "var(--cor-borda)" }}
        >
          {itens.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => { setAberto(false); item.onClick(); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-black/20"
              style={{ color: item.perigoso ? "var(--cor-alerta)" : "var(--cor-texto)" }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
