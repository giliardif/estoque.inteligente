"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme/useTheme";
import ToggleTema from "@/components/ui/ToggleTema";
import {
  LayoutGrid, Package, Boxes, ArrowLeftRight, ClipboardList, FileText,
  BarChart3, ShoppingCart, ShoppingBag, Bell, LogOut, Menu, X,
} from "lucide-react";

const nav = [
  { href: "/", label: "Painel", icon: LayoutGrid },
  { href: "/vendas", label: "Vendas / PDV", icon: ShoppingCart },
  { href: "/produtos", label: "Produtos", icon: Package },
  { href: "/estoque", label: "Estoque", icon: Boxes },
  { href: "/movimentacao", label: "Movimentação", icon: ArrowLeftRight },
  { href: "/inventario", label: "Inventário", icon: ClipboardList },
  { href: "/notas", label: "Notas Fiscais", icon: FileText },
  { href: "/compras", label: "Compras", icon: ShoppingBag },
  { href: "/alertas", label: "Alertas", icon: Bell },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
];

function LogoBloco({ tema }: { tema: ReturnType<typeof useTheme> }) {
  return (
    <div className="flex items-center gap-2.5 px-1.5">
      {tema.logo_simbolo ? (
        <Image src={tema.logo_simbolo} alt={tema.logo_texto} width={26} height={32} priority />
      ) : null}
      <div className="leading-tight">
        <div className="font-logotype font-bold text-sm tracking-tight">
          <span style={{ color: "var(--cor-texto)" }}>Nex</span>
          <span style={{ color: "var(--cor-acento)" }}>Stock</span>
        </div>
        {tema.logo_tagline ? (
          <div
            className="text-[9px] tracking-wide font-semibold"
            style={{ color: "var(--cor-texto-muted)" }}
          >
            {tema.logo_tagline.toUpperCase()}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NavLista({ pathname, onNavegar }: { pathname: string | null; onNavegar?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {nav.map((item) => {
        const ativo = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavegar}
            className="flex items-center gap-2.5 px-2.5 py-2.5 md:py-2 rounded-lg text-sm font-medium transition-colors"
            style={
              ativo
                ? { color: "var(--cor-acento)", background: "color-mix(in srgb, var(--cor-acento) 12%, transparent)" }
                : { color: "var(--cor-texto-muted)" }
            }
          >
            <item.icon size={16} strokeWidth={1.9} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const tema = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    // Proteção de rota no client: se não há usuário autenticado em memória,
    // volta pro login. A proteção REAL (que importa de verdade) é o backend
    // recusar qualquer chamada sem token válido — isto aqui é só UX.
    if (!usuario) router.replace("/login");
  }, [usuario, router]);

  // Fecha o menu mobile automaticamente ao trocar de rota.
  useEffect(() => {
    setMenuAberto(false);
  }, [pathname]);

  if (!usuario) return null;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Header mobile: hambúrguer + logo. Some acima de md, onde a sidebar fixa assume. */}
      <div
        className="flex md:hidden items-center justify-between px-4 py-3 border-b sticky top-0 z-30"
        style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)" }}
      >
        <button
          onClick={() => setMenuAberto(true)}
          aria-label="Abrir menu"
          className="p-1 -ml-1"
          style={{ color: "var(--cor-texto)" }}
        >
          <Menu size={22} />
        </button>
        <LogoBloco tema={tema} />
        <ToggleTema compacto />
      </div>

      {/* Sidebar fixa — desktop apenas */}
      <aside
        className="hidden md:flex w-60 shrink-0 border-r p-4 flex-col gap-5"
        style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)" }}
      >
        <LogoBloco tema={tema} />
        <NavLista pathname={pathname} />
        <div className="mt-auto flex flex-col gap-2">
          <ToggleTema />
          <button
            onClick={logout}
            className="flex items-center gap-2 text-xs px-2.5 py-2 rounded-lg hover:bg-white/5"
            style={{ color: "var(--cor-texto-muted)" }}
          >
            <LogOut size={14} /> Sair ({usuario.perfil})
          </button>
        </div>
      </aside>

      {/* Gaveta (drawer) — mobile apenas, sobrepõe o conteúdo quando aberta */}
      {menuAberto && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
            className="w-72 max-w-[80vw] h-full p-4 flex flex-col gap-5 shadow-2xl"
            style={{ background: "var(--cor-base)", borderRight: "1px solid var(--cor-borda)" }}
          >
            <div className="flex items-center justify-between">
              <LogoBloco tema={tema} />
              <button
                onClick={() => setMenuAberto(false)}
                aria-label="Fechar menu"
                className="p-1"
                style={{ color: "var(--cor-texto-muted)" }}
              >
                <X size={20} />
              </button>
            </div>
            <NavLista pathname={pathname} onNavegar={() => setMenuAberto(false)} />
            <div className="mt-auto flex flex-col gap-2">
              <ToggleTema />
              <button
                onClick={logout}
                className="flex items-center gap-2 text-xs px-2.5 py-2.5 rounded-lg"
                style={{ color: "var(--cor-texto-muted)" }}
              >
                <LogOut size={14} /> Sair ({usuario.perfil})
              </button>
            </div>
          </div>
          <div
            className="flex-1"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={() => setMenuAberto(false)}
            aria-hidden
          />
        </div>
      )}

      <main className="flex-1 min-w-0">
        <div className="px-4 py-4 md:px-7 md:py-6">{children}</div>
      </main>
    </div>
  );
}
