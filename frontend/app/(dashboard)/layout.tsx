"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme/useTheme";
import {
  LayoutGrid, Package, Boxes, ArrowLeftRight, ClipboardList, FileText,
  BarChart3, ShoppingCart, ShoppingBag, Bell, Store, LogOut,
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

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const tema = useTheme();
  const router = useRouter();

  useEffect(() => {
    // Proteção de rota no client: se não há usuário autenticado em memória,
    // volta pro login. A proteção REAL (que importa de verdade) é o backend
    // recusar qualquer chamada sem token válido — isto aqui é só UX.
    if (!usuario) router.replace("/login");
  }, [usuario, router]);

  if (!usuario) return null;

  return (
    <div className="flex min-h-screen">
      <aside
        className="w-60 shrink-0 border-r p-4 flex flex-col gap-5"
        style={{ background: "var(--cor-base)", borderColor: "var(--cor-borda)" }}
      >
        <div className="flex items-center gap-2 px-1.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: `linear-gradient(150deg, ${tema.cor_acento}, #A2631A)` }}
          >
            <Store size={16} color={tema.cor_base} />
          </div>
          <div className="leading-tight">
            <div className="font-display font-semibold text-sm">{tema.logo_texto}</div>
            <div className="text-[10px] tracking-wide" style={{ color: "var(--cor-texto-muted)" }}>
              ESTOQUE INTELIGENTE
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium hover:bg-white/5"
              style={{ color: "var(--cor-texto-muted)" }}
            >
              <item.icon size={16} strokeWidth={1.9} />
              {item.label}
            </Link>
          ))}
        </nav>

        <button
          onClick={logout}
          className="mt-auto flex items-center gap-2 text-xs px-2.5 py-2 rounded-lg hover:bg-white/5"
          style={{ color: "var(--cor-texto-muted)" }}
        >
          <LogOut size={14} /> Sair ({usuario.perfil})
        </button>
      </aside>

      <main className="flex-1 min-w-0">
        <div className="px-7 py-6">{children}</div>
      </main>
    </div>
  );
}
